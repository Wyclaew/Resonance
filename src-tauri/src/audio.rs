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
                } => {
                    sink.stop();
                    sink = Sink::try_new(&handle).expect("sink");
                    sink.set_volume(volume);
                    // Çözümlemeyi yakala: bozuk/desteklenmeyen bir dosya
                    // panikleyip tüm ses motorunu öldürmesin.
                    let decoded = std::panic::catch_unwind(std::panic::AssertUnwindSafe(
                        || open_source(&path),
                    ));
                    match decoded {
                        Ok(Ok(src)) => {
                            sink.append(src);
                            // Kaldığın yerden devam: verilen pozisyona atla.
                            if start_ms > 0 {
                                let _ = sink.try_seek(Duration::from_millis(start_ms));
                            }
                            sink.play();
                            shared.duration_ms.store(duration_ms, Ordering::Relaxed);
                            shared.position_ms.store(start_ms, Ordering::Relaxed);
                            *shared.track_id.lock().unwrap() = Some(track_id);
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
                    *shared.track_id.lock().unwrap() = None;
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
        if empty && !ended_emitted && shared.track_id.lock().unwrap().is_some() {
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

        std::thread::sleep(Duration::from_millis(50));
    }
}

fn open_source(path: &PathBuf) -> anyhow::Result<Decoder<BufReader<File>>> {
    let file = File::open(path)?;
    let dec = Decoder::new(BufReader::new(file))?;
    Ok(dec)
}
