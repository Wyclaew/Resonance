// Ses motoru. rodio + symphonia, kendi adanmış thread'inde çalışır
// (OutputStream !Send olduğu için). Komutlar bir kanaldan gelir;
// pozisyon/durum atomik snapshot'la paylaşılır ve frontend'e olaylarla
// (playback-tick / track-ended) bildirilir.

use std::fs::File;
use std::io::BufReader;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rodio::cpal::traits::{DeviceTrait, HostTrait};
use rodio::cpal::{self, SupportedStreamConfig};
use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink};
use tauri::{AppHandle, Emitter};

/// Müzik için kabul edilebilir en düşük örnekleme hızı.
const MIN_MUSIC_RATE: u32 = 44100;

/// ⭐⭐ ÇIKIŞI MÜZİK KALİTESİNDE AÇ (v1.8.8 — "ses kalitesi rezil" bug'ının
/// KÖK NEDENİ).
///
/// ÖLÇÜLDÜ (SteelSeries Arctis Nova 5): cihaz iki yapılandırma sunuyor —
/// **16 kHz** ve 44.1 kHz. Oyuncu kulaklıkları mikrofon/sohbet kanalı açıkken
/// 16 kHz moduna düşüyor ve o an işletim sisteminin VARSAYILAN çıkış
/// yapılandırması da 16 kHz oluyor. rodio `try_default()` tam olarak bu
/// varsayılanı alıyor → uygulama o oturum boyunca müziği TELEFON KALİTESİNDE
/// çalıyor. Uygulamayı başka bir anda açınca düzelmesi ("bir terminalden
/// açınca iyi, diğerinden kötü") bu yüzdendi; kod değil, cihazın o andaki
/// modu belirliyordu.
///
/// Çözüm: varsayılan yapılandırma müziğe uygun değilse cihazın desteklediği
/// listeden 48/44.1 kHz olanı SEÇİP onunla açıyoruz.
fn music_config(dev: &cpal::Device) -> Option<SupportedStreamConfig> {
    let def = dev.default_output_config().ok();
    if let Some(c) = &def {
        if c.sample_rate().0 >= MIN_MUSIC_RATE {
            return def;
        }
    }
    let better = dev
        .supported_output_configs()
        .ok()?
        .filter(|r| r.channels() >= 2)
        .filter_map(|r| {
            let (min, max) = (r.min_sample_rate().0, r.max_sample_rate().0);
            let want = if min <= 48000 && 48000 <= max {
                48000
            } else if min <= 44100 && 44100 <= max {
                44100
            } else if min >= MIN_MUSIC_RATE {
                min
            } else {
                return None;
            };
            Some(r.with_sample_rate(cpal::SampleRate(want)))
        })
        .max_by_key(|c| c.sample_rate().0);
    if let Some(c) = &better {
        log::warn!(
            "cihazın varsayılanı düşük ({} Hz) — {} Hz ile açılıyor",
            def.as_ref().map(|d| d.sample_rate().0).unwrap_or(0),
            c.sample_rate().0
        );
    }
    better.or(def)
}

/// Çıkış akışını açar; seçilen örnekleme hızını ve kanal sayısını da döndürür.
fn open_output() -> Option<(OutputStream, OutputStreamHandle, u32, u16)> {
    let dev = cpal::default_host().default_output_device()?;
    let name = dev.name().unwrap_or_else(|_| "?".into());
    if let Some(cfg) = music_config(&dev) {
        let rate = cfg.sample_rate().0;
        let ch = cfg.channels();
        match OutputStream::try_from_device_config(&dev, cfg) {
            Ok((s, h)) => {
                log::info!("ses çıkışı: {name} @ {rate} Hz, {ch} kanal");
                return Some((s, h, rate, ch));
            }
            Err(e) => log::warn!("{rate} Hz ile açılamadı ({e}) — varsayılana dönülüyor"),
        }
    }
    match OutputStream::try_default() {
        Ok((s, h)) => {
            let cfg = cpal::default_host()
                .default_output_device()
                .and_then(|d| d.default_output_config().ok());
            let rate = cfg.as_ref().map(|c| c.sample_rate().0).unwrap_or(0);
            let ch = cfg.as_ref().map(|c| c.channels()).unwrap_or(2);
            log::info!("ses çıkışı (varsayılan): {name} @ {rate} Hz, {ch} kanal");
            Some((s, h, rate, ch))
        }
        Err(e) => {
            log::warn!("ses çıkışı açılamadı: {e}");
            None
        }
    }
}

/// ⚠️ ÇIKIŞ MÜZİĞE UYGUN DEĞİLSE KULLANICIYA SÖYLE.
///
/// ÖLÇÜLDÜ: bir oyuncu kulaklığı (Arctis Nova 5) mikrofon/sohbet kanalı
/// açıkken işletim sistemine YALNIZCA "16 kHz mono" sunuyor. O anda açılan
/// her uygulama müziği telefon kalitesinde çalar — kullanıcı bunu "uygulamanın
/// sesi bozuk" diye görüyor ve sebebini bulması imkânsız. Artık söylüyoruz.
fn warn_if_poor_output(app: &AppHandle, rate: u32, channels: u16) {
    if rate >= MIN_MUSIC_RATE && channels >= 2 {
        return;
    }
    log::warn!("ses çıkışı müzik için düşük: {rate} Hz, {channels} kanal");
    let _ = app.emit(
        "audio-output-warning",
        format!("{} Hz · {} kanal", rate, channels),
    );
}

/// Cihaz şu an daha iyi bir hız sunuyor mu? (16 kHz'de açıldıysak ve kulaklık
/// sohbet modundan çıktıysa yeniden açmak İSTERİZ.)
fn better_rate_available(current: u32) -> bool {
    if current >= MIN_MUSIC_RATE {
        return false;
    }
    cpal::default_host()
        .default_output_device()
        .and_then(|d| music_config(&d))
        .map(|c| c.sample_rate().0 > current)
        .unwrap_or(false)
}

pub enum AudioCmd {
    Load {
        path: PathBuf,
        duration_ms: u64,
        track_id: String,
        start_ms: u64, // kaldığın yerden devam için başlangıç pozisyonu (0 = baştan)
        /// ⭐ CROSSFADE: >0 ise yeni parça sessizden açılır ve ÖNCEKİ parça
        /// durdurulmak yerine aynı sürede kısılarak söner (iki sink birlikte).
        fade_ms: u64,
        /// ⚠️ Akış YARIDA KESİLDİ mi? (indirme koptu / 403)
        ///
        /// Bu olmadan eksik dosyanın sonuna gelen motor "şarkı bitti" yayıyor
        /// ve kuyruk ilerliyordu — kullanıcının gördüğü "şarkı 35-40.
        /// saniyede kendiliğinden atlıyor" davranışı buydu. Kopma bir BİTİŞ
        /// değildir: kurtarma tam dosyayı indirip aynı saniyeden devam ettirir.
        stream_failed: Option<Arc<AtomicBool>>,
        /// ⭐ İNDİRİRKEN ÇALMA: dosya hâlâ YAZILIYORSA bu bayrak verilir.
        /// Okuyucu sona geldiğinde EOF sanıp durmaz, bayrak true olana kadar
        /// yeni veriyi bekler (bkz. native_dl::GrowingFile).
        growing: Option<Arc<AtomicBool>>,
    },
    Play,
    Pause,
    Stop,
    SetVolume(f32),
    Seek(u64),
}

#[derive(Default)]
pub struct Shared {
    pub position_ms: AtomicU64,
    pub duration_ms: AtomicU64,
    pub playing: AtomicBool,
    pub track_id: Mutex<Option<String>>,
}

pub struct AudioHandle {
    tx: Mutex<Sender<AudioCmd>>,
    pub shared: Arc<Shared>,
}

impl AudioHandle {
    pub fn send(&self, cmd: AudioCmd) {
        if let Ok(tx) = self.tx.lock() {
            let _ = tx.send(cmd);
        }
    }
}

#[derive(Clone, serde::Serialize)]
struct Tick {
    position_ms: u64,
    duration_ms: u64,
    playing: bool,
}

/// Ses thread'ini başlatır ve kontrol handle'ı döndürür.
pub fn start(app: AppHandle) -> AudioHandle {
    let (tx, rx) = mpsc::channel::<AudioCmd>();
    let shared = Arc::new(Shared::default());
    let shared_t = shared.clone();
    std::thread::Builder::new()
        .name("resonance-audio".into())
        .spawn(move || audio_loop(rx, shared_t, app))
        .expect("ses thread'i başlatılamadı");
    AudioHandle {
        tx: Mutex::new(tx),
        shared,
    }
}

fn audio_loop(rx: Receiver<AudioCmd>, shared: Arc<Shared>, app: AppHandle) {
    // ⚠️ SES ÇIKIŞI AÇILIŞTA OLMAYABİLİR. Eskiden burada `return` vardı: cihaz
    // yoksa ses thread'i ölüyor ve uygulama o oturumda BİR DAHA hiçbir şey
    // çalmıyordu. Windows'ta otomatik başlatma ile açılan uygulama, Bluetooth
    // kulaklık bağlanmadan önce ayağa kalkar → tam olarak bu durum. Artık
    // cihaz gelene kadar bekliyoruz; bu sırada gelen komutlar kanalda birikir
    // ve cihaz gelince en sonuncusu uygulanır.
    let (mut _stream, mut handle, mut out_rate, mut out_ch, mut sink) = loop {
        if let Some((s, h, rate, ch)) = open_output() {
            match Sink::try_new(&h) {
                Ok(sk) => break (s, h, rate, ch, sk),
                Err(e) => log::warn!("sink kurulamadı, bekleniyor: {e}"),
            }
        }
        std::thread::sleep(Duration::from_millis(1500));
    };
    let mut volume = 0.9f32;
    sink.set_volume(volume);
    // ⚠️ Uyarı AÇILIŞTA yayınlanamaz: ses thread'i frontend dinleyicilerinden
    // ÖNCE ayağa kalkıyor, olay boşa giderdi. İlk parça yüklenirken yayınlanır.
    let mut warned_poor = false;

    // Çalan parçanın akışı koptu mu? (yalnız indirirken çalma yolunda dolu)
    let mut stream_failed: Option<Arc<AtomicBool>> = None;
    // Sönmekte olan eski parçalar (crossfade). Genelde 0 ya da 1 eleman.
    let mut fading: Vec<Fading> = Vec::new();
    // Yeni parçanın açılma rampası: (başlangıç, süre).
    let mut fade_in: Option<(Instant, u64)> = None;
    let mut ended_emitted = true; // boştayken yanlış 'bitti' yaymamak için
    let mut last_tick = Instant::now();

    loop {
        while let Ok(cmd) = rx.try_recv() {
            match cmd {
                AudioCmd::Load {
                    path,
                    duration_ms,
                    track_id,
                    start_ms,
                    fade_ms,
                    stream_failed: failed_flag,
                    growing,
                } => {
                    // ⭐ CROSSFADE: eskiyi ÖLDÜRME, söndürme listesine al.
                    // Yeni parça 0 sesten açılır; ikisi birlikte çalarken
                    // aşağıdaki döngü rampaları uygular.
                    // ⚠️ `expect("sink")` PANİKLERDİ: ses cihazı kaybolunca
                    // (Windows'ta Bluetooth kulaklığın kesilmesi yaygın)
                    // tüm ses thread'i ölüyor ve uygulama bir daha hiçbir şey
                    // çalmıyordu. Artık hata bildirilip mevcut sink korunuyor.
                    // ⚠️ Cihaz KAYBOLMUŞ olabilir (Bluetooth kesildi, USB
                    // kart çıkarıldı). Eski `handle` ölü kalır ve o oturumda
                    // hiçbir parça açılmaz → çıkışı YENİDEN kurmayı dene.
                    // ⭐ Cihaz DÜŞÜK HIZDA açıldıysa (kulaklık sohbet modunda
                    // 16 kHz) ve artık daha iyisini sunuyorsa çıkışı yeniden
                    // kur: yoksa o oturum boyunca müzik telefon kalitesinde
                    // çalmaya devam ederdi.
                    if better_rate_available(out_rate) {
                        if let Some((s2, h2, r2, ch2)) = open_output() {
                            log::info!("çıkış {out_rate} Hz → {r2} Hz yeniden kuruldu");
                            fading.clear();
                            _stream = s2;
                            handle = h2;
                            out_rate = r2;
                            out_ch = ch2;
                            warned_poor = false;
                        }
                    }
                    // Çıkış müziğe uygun değilse kullanıcıya BİR KEZ söyle.
                    if !warned_poor {
                        warned_poor = true;
                        warn_if_poor_output(&app, out_rate, out_ch);
                    }
                    let fresh = match Sink::try_new(&handle) {
                        Ok(s) => s,
                        Err(e) => {
                            log::warn!("sink kurulamadı ({e}) — çıkış yeniden kuruluyor");
                            let rebuilt = open_output().and_then(|(s2, h2, r2, ch2)| {
                                Sink::try_new(&h2).ok().map(|sk| (s2, h2, r2, ch2, sk))
                            });
                            match rebuilt {
                                Some((s2, h2, r2, ch2, sk)) => {
                                    out_ch = ch2;
                                    warned_poor = false;
                                    // Eski çıkış düşer; ona bağlı sönme
                                    // sinkleri de artık anlamsız.
                                    fading.clear();
                                    _stream = s2;
                                    handle = h2;
                                    out_rate = r2;
                                    sk
                                }
                                None => {
                                    log::error!("ses çıkışı kullanılamıyor");
                                    let _ = app.emit(
                                        "playback-error",
                                        "ses çıkışı kullanılamıyor".to_string(),
                                    );
                                    ended_emitted = true;
                                    continue;
                                }
                            }
                        }
                    };
                    if fade_ms > 0 && !sink.empty() {
                        let old = std::mem::replace(&mut sink, fresh);
                        fading.push(Fading {
                            sink: old,
                            t0: Instant::now(),
                            dur_ms: fade_ms,
                            from_vol: volume,
                        });
                        fade_in = Some((Instant::now(), fade_ms));
                        sink.set_volume(0.0);
                    } else {
                        sink.stop();
                        sink = fresh;
                        fade_in = None;
                        sink.set_volume(volume);
                    }
                    // Çözümlemeyi yakala: bozuk/desteklenmeyen bir dosya
                    // panikleyip tüm ses motorunu öldürmesin.
                    let decoded = std::panic::catch_unwind(std::panic::AssertUnwindSafe(
                        || -> anyhow::Result<()> {
                            match &growing {
                                // Yazımı süren dosya → bekleyen okuyucu.
                                Some(done) => {
                                    sink.append(open_growing(&path, done.clone())?)
                                }
                                None => sink.append(open_source(&path)?),
                            }
                            Ok(())
                        },
                    ));
                    match decoded {
                        Ok(Ok(())) => {
                            // Kaldığın yerden devam: verilen pozisyona atla.
                            if start_ms > 0 {
                                let _ = sink.try_seek(Duration::from_millis(start_ms));
                            }
                            sink.play();
                            stream_failed = failed_flag.clone();
                            shared.duration_ms.store(duration_ms, Ordering::Relaxed);
                            shared.position_ms.store(start_ms, Ordering::Relaxed);
                            if let Ok(mut g) = shared.track_id.lock() {
                                *g = Some(track_id);
                            }
                            ended_emitted = false;
                        }
                        Ok(Err(e)) => {
                            log::error!("çözümleme hatası {path:?}: {e}");
                            // Boş sink'in sahte 'track-ended' yaymasını önle:
                            // atlamayı frontend zaten playback-error ile yapar.
                            ended_emitted = true;
                            let _ = app.emit("playback-error", e.to_string());
                        }
                        Err(_) => {
                            log::error!("çözümleme paniği {path:?}");
                            ended_emitted = true;
                            let _ = app.emit(
                                "playback-error",
                                "ses çözümlenemedi (desteklenmeyen format)".to_string(),
                            );
                        }
                    }
                }
                AudioCmd::Play => sink.play(),
                AudioCmd::Pause => sink.pause(),
                AudioCmd::Stop => {
                    sink.stop();
                    shared.position_ms.store(0, Ordering::Relaxed);
                    if let Ok(mut g) = shared.track_id.lock() {
                        *g = None;
                    }
                    ended_emitted = true;
                }
                AudioCmd::SetVolume(v) => {
                    volume = v.clamp(0.0, 1.0);
                    sink.set_volume(volume);
                }
                AudioCmd::Seek(ms) => {
                    let _ = sink.try_seek(Duration::from_millis(ms));
                }
            }
        }

        let pos = sink.get_pos().as_millis() as u64;
        let empty = sink.empty();
        let playing = !sink.is_paused() && !empty;
        shared.position_ms.store(pos, Ordering::Relaxed);
        shared.playing.store(playing, Ordering::Relaxed);

        // Şarkı doğal olarak bitti mi?
        //
        // ⚠️ AKIŞ KOPMASI BİTİŞ DEĞİLDİR. Yarım kalan dosyanın sonuna gelmek
        // "şarkı bitti" gibi görünür; bunu yayarsak kuyruk ilerler ve parça
        // haksız yere atlanır (üstelik zevk modeline de yanlış sinyal gider).
        // Bu durumda susuyoruz: kurtarma tam dosyayı indirip aynı saniyeden
        // devam ettirecek, olmazsa `playback-error` gelir ve frontend atlar.
        let stream_broken = stream_failed
            .as_ref()
            .map(|f| f.load(Ordering::Relaxed))
            .unwrap_or(false);
        let has_track = shared
            .track_id
            .lock()
            .map(|g| g.is_some())
            .unwrap_or(false);
        if empty && !ended_emitted && !stream_broken && has_track {
            ended_emitted = true;
            let _ = app.emit("track-ended", ());
        }

        if last_tick.elapsed() >= Duration::from_millis(250) {
            last_tick = Instant::now();
            let _ = app.emit(
                "playback-tick",
                Tick {
                    position_ms: pos,
                    duration_ms: shared.duration_ms.load(Ordering::Relaxed),
                    playing,
                },
            );
        }

        // ── Crossfade rampaları (50 ms'de bir) ────────────────────────────
        // Sönenler: süre dolunca gerçekten durdurulur ve listeden düşer.
        fading.retain_mut(|f| {
            let p = f.t0.elapsed().as_millis() as f32 / f.dur_ms.max(1) as f32;
            if p >= 1.0 {
                f.sink.stop();
                false
            } else {
                f.sink.set_volume(f.from_vol * (1.0 - p));
                true
            }
        });
        // Açılan: hedef ses seviyesine yükselir. `volume` bu sırada kullanıcı
        // tarafından değiştirilebilir; rampa her zaman GÜNCEL değeri kullanır.
        if let Some((t0, dur)) = fade_in {
            let p = t0.elapsed().as_millis() as f32 / dur.max(1) as f32;
            if p >= 1.0 {
                sink.set_volume(volume);
                fade_in = None;
            } else {
                sink.set_volume(volume * p);
            }
        }

        std::thread::sleep(Duration::from_millis(50));
    }
}

/// Crossfade sırasında sönmekte olan parça.
struct Fading {
    sink: Sink,
    t0: Instant,
    dur_ms: u64,
    from_vol: f32,
}

fn open_source(path: &PathBuf) -> anyhow::Result<Decoder<BufReader<File>>> {
    let file = File::open(path)?;
    let dec = Decoder::new(BufReader::new(file))?;
    Ok(dec)
}

/// İndirilmeye devam eden dosyayı çalmak için okuyucu (bkz. native_dl).
fn open_growing(
    path: &PathBuf,
    done: Arc<AtomicBool>,
) -> anyhow::Result<Decoder<BufReader<crate::native_dl::GrowingFile>>> {
    let f = crate::native_dl::GrowingFile::open(path, done)?;
    let dec = Decoder::new(BufReader::new(f))?;
    Ok(dec)
}
