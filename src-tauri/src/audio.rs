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

use rodio::{Decoder, OutputStream, Sink};
use tauri::{AppHandle, Emitter};

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
    let (_stream, handle) = match OutputStream::try_default() {
        Ok(s) => s,
        Err(e) => {
            log::error!("ses çıkışı açılamadı: {e}");
            return;
        }
    };
    let mut sink = Sink::try_new(&handle).expect("sink");
    let mut volume = 0.9f32;
    sink.set_volume(volume);

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
                    let fresh = match Sink::try_new(&handle) {
                        Ok(s) => s,
                        Err(e) => {
                            log::error!("ses çıkışı kurulamadı: {e}");
                            let _ = app.emit(
                                "playback-error",
                                "ses çıkışı kullanılamıyor".to_string(),
                            );
                            ended_emitted = true;
                            continue;
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
