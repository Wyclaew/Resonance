// Ekolayzer: 5 bantlı parametrik EQ (RBJ cookbook biquad'ları, harici crate yok).
//
// Tasarım:
//  • Ayarlar `EqShared` içinde (Arc) durur; UI komutu yazar, her ses kaynağı
//    (`EqSource`) bir NESİL sayacını okur. Sayaç değişmediyse kilit/hesap YOK
//    → akış başına maliyet bir atomik okuma. Katsayılar yalnız ayar değişince
//    ve (nadiren) örnekleme hızı değişince yeniden hesaplanır.
//  • ⭐ TAM BYPASS: kapalıysa ya da tüm kazançlar 0 ise örnekler olduğu gibi
//    geçer (biquad çalışmaz, sıfır DSP).
//  • ⭐ HEADROOM: bant toplamının tepe kazancı (+dB) ölçülüp preamp'tan
//    DÜŞÜLÜR → bas artırınca kırpılmaz. Üstüne son güvence olarak yumuşak
//    sınırlayıcı (yalnız ±0.95 üstünde devreye girer).
//  • Örnekleme hızı kaynaktan okunur (44.1/48 kHz değişir); hız değişirse
//    katsayılar yeniden hesaplanır. Seek'te filtre durumu sıfırlanır (tık yok).

use std::f64::consts::PI;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rodio::source::SeekError;
use rodio::Source;

pub const BANDS: usize = 5;
/// Bant merkez/köşe frekansları: alçak raf, 3 tepe, yüksek raf.
pub const FREQS: [f64; BANDS] = [60.0, 230.0, 910.0, 3600.0, 14000.0];
const PEAK_Q: f64 = 1.0;
/// Kazanç/preamp sınırı (dB).
pub const MAX_DB: f32 = 12.0;
/// Bu değerin altındaki kazanç "0" sayılır (bant atlanır).
const EPS_DB: f64 = 0.01;
/// En fazla desteklenen kanal sayısı (filtre durumu kanal başına).
const MAX_CH: usize = 8;
/// Nesil/hız kontrolü her bu kadar örnekte bir yapılır (~10-20 ms).
const CHECK_EVERY: u32 = 1024;
/// Yumuşak sınırlayıcının diz noktası.
const LIMIT_KNEE: f64 = 0.95;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EqParams {
    pub enabled: bool,
    pub preamp_db: f32,
    pub gains_db: [f32; BANDS],
}

impl Default for EqParams {
    fn default() -> Self {
        Self { enabled: false, preamp_db: 0.0, gains_db: [0.0; BANDS] }
    }
}

impl EqParams {
    fn sanitized(mut self) -> Self {
        let fix = |v: f32| if v.is_finite() { v.clamp(-MAX_DB, MAX_DB) } else { 0.0 };
        self.preamp_db = fix(self.preamp_db);
        for g in self.gains_db.iter_mut() {
            *g = fix(*g);
        }
        self
    }
}

/// Komut tarafı ile ses kaynakları arasındaki ortak durum.
#[derive(Default)]
pub struct EqShared {
    gen: AtomicU64,
    params: Mutex<EqParams>,
}

impl EqShared {
    pub fn set(&self, p: EqParams) {
        let p = p.sanitized();
        if let Ok(mut g) = self.params.lock() {
            *g = p;
        }
        self.gen.fetch_add(1, Ordering::Release);
    }
    fn snapshot(&self) -> EqParams {
        self.params.lock().map(|g| *g).unwrap_or_default()
    }
}

/// Normalize edilmiş (a0 = 1) biquad katsayıları.
#[derive(Clone, Copy, Debug)]
pub struct Coefs {
    pub b0: f64,
    pub b1: f64,
    pub b2: f64,
    pub a1: f64,
    pub a2: f64,
}

#[derive(Clone, Copy)]
pub enum Kind {
    LowShelf,
    Peak,
    HighShelf,
}

/// RBJ cookbook katsayıları (shelf'te S = 1).
pub fn design(kind: Kind, freq: f64, gain_db: f64, fs: f64) -> Coefs {
    let a = 10f64.powf(gain_db / 40.0);
    // Nyquist'e çok yakın köşe frekansı kararsızlaşır → sınırla.
    let w0 = 2.0 * PI * freq.min(fs * 0.45) / fs;
    let (sin, cos) = w0.sin_cos();
    let (b0, b1, b2, a0, a1, a2);
    match kind {
        Kind::Peak => {
            let alpha = sin / (2.0 * PEAK_Q);
            b0 = 1.0 + alpha * a;
            b1 = -2.0 * cos;
            b2 = 1.0 - alpha * a;
            a0 = 1.0 + alpha / a;
            a1 = -2.0 * cos;
            a2 = 1.0 - alpha / a;
        }
        Kind::LowShelf => {
            // S = 1 → alpha = sin/2·√2; t = 2·√A·alpha.
            let t = 2.0 * a.sqrt() * (sin / 2.0 * 2f64.sqrt());
            b0 = a * ((a + 1.0) - (a - 1.0) * cos + t);
            b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cos);
            b2 = a * ((a + 1.0) - (a - 1.0) * cos - t);
            a0 = (a + 1.0) + (a - 1.0) * cos + t;
            a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cos);
            a2 = (a + 1.0) + (a - 1.0) * cos - t;
        }
        Kind::HighShelf => {
            // S = 1 → alpha = sin/2·√2; t = 2·√A·alpha.
            let t = 2.0 * a.sqrt() * (sin / 2.0 * 2f64.sqrt());
            b0 = a * ((a + 1.0) + (a - 1.0) * cos + t);
            b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cos);
            b2 = a * ((a + 1.0) + (a - 1.0) * cos - t);
            a0 = (a + 1.0) - (a - 1.0) * cos + t;
            a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cos);
            a2 = (a + 1.0) - (a - 1.0) * cos - t;
        }
    }
    Coefs { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

fn kind_of(i: usize) -> Kind {
    match i {
        0 => Kind::LowShelf,
        i if i == BANDS - 1 => Kind::HighShelf,
        _ => Kind::Peak,
    }
}

/// Bir biquad'ın |H(e^jw)| değeri (dB).
pub fn magnitude_db(c: &Coefs, freq: f64, fs: f64) -> f64 {
    let w = 2.0 * PI * freq / fs;
    let (s1, c1) = w.sin_cos();
    let (s2, c2) = (2.0 * w).sin_cos();
    let nr = c.b0 + c.b1 * c1 + c.b2 * c2;
    let ni = -(c.b1 * s1 + c.b2 * s2);
    let dr = 1.0 + c.a1 * c1 + c.a2 * c2;
    let di = -(c.a1 * s1 + c.a2 * s2);
    10.0 * ((nr * nr + ni * ni) / (dr * dr + di * di)).log10()
}

/// Etkin bantlar (kazancı ~0 olmayanlar) + toplam çıkış kazancı (lineer).
struct Plan {
    bands: Vec<Coefs>,
    gain: f64,
    active: bool,
}

fn plan(p: &EqParams, fs: f64) -> Plan {
    if !p.enabled {
        return Plan { bands: vec![], gain: 1.0, active: false };
    }
    let bands: Vec<Coefs> = (0..BANDS)
        .filter(|&i| (p.gains_db[i] as f64).abs() >= EPS_DB)
        .map(|i| design(kind_of(i), FREQS[i], p.gains_db[i] as f64, fs))
        .collect();
    let pre = p.preamp_db as f64;
    if bands.is_empty() && pre.abs() < EPS_DB {
        return Plan { bands, gain: 1.0, active: false };
    }
    // Headroom: toplam tepe kazancı logaritmik ızgarada ölç, pozitifse düş.
    let mut peak = 0.0f64;
    for k in 0..96 {
        let f = 20.0 * (fs * 0.45 / 20.0).powf(k as f64 / 95.0);
        let db: f64 = bands.iter().map(|c| magnitude_db(c, f, fs)).sum();
        peak = peak.max(db);
    }
    let total_db = pre - peak.max(0.0);
    Plan { bands, gain: 10f64.powf(total_db / 20.0), active: true }
}

#[derive(Clone, Copy, Default)]
struct State {
    z1: f64,
    z2: f64,
}

/// Kaynaktan bağımsız işlemci (test edilebilir çekirdek).
pub struct EqProcessor {
    shared: Arc<EqShared>,
    seen_gen: u64,
    rate: u32,
    channels: usize,
    plan: Plan,
    state: [[State; BANDS]; MAX_CH],
    ch: usize,
    since_check: u32,
}

impl EqProcessor {
    pub fn new(shared: Arc<EqShared>, rate: u32, channels: u16) -> Self {
        let mut p = Self {
            shared,
            seen_gen: u64::MAX,
            rate: 0,
            channels: 1,
            plan: Plan { bands: vec![], gain: 1.0, active: false },
            state: [[State::default(); BANDS]; MAX_CH],
            ch: 0,
            since_check: 0,
        };
        p.refresh(rate, channels, true);
        p
    }

    /// Ayar/hız/kanal değiştiyse katsayıları yenile. Ucuz yol: tek atomik okuma.
    pub fn refresh(&mut self, rate: u32, channels: u16, force: bool) {
        let gen = self.shared.gen.load(Ordering::Acquire);
        let ch = (channels as usize).clamp(1, MAX_CH);
        if !force && gen == self.seen_gen && rate == self.rate && ch == self.channels {
            return;
        }
        if ch != self.channels {
            self.ch = 0;
        }
        self.seen_gen = gen;
        self.rate = rate;
        self.channels = ch;
        self.plan = plan(&self.shared.snapshot(), rate.max(8000) as f64);
        // Katsayı değişince eski durumu tutmak patlama yapabilir → sıfırla
        // (kazanç değişimi seyrek ve kullanıcı eliyle olur).
        self.reset();
    }

    pub fn reset(&mut self) {
        self.state = [[State::default(); BANDS]; MAX_CH];
    }

    #[cfg(test)]
    pub fn is_bypass(&self) -> bool {
        !self.plan.active
    }

    /// Sıradaki örnek (kanal sırası kendi içinde izlenir).
    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        if !self.plan.active {
            return x;
        }
        let st = &mut self.state[self.ch];
        self.ch = (self.ch + 1) % self.channels;
        let mut v = x as f64;
        for (c, s) in self.plan.bands.iter().zip(st.iter_mut()) {
            // Transposed Direct Form II.
            let y = c.b0 * v + s.z1;
            s.z1 = c.b1 * v - c.a1 * y + s.z2;
            s.z2 = c.b2 * v - c.a2 * y;
            v = y;
        }
        v *= self.plan.gain;
        // Yumuşak sınırlayıcı: yalnız diz noktasının üstünde.
        let a = v.abs();
        if a > LIMIT_KNEE {
            let room = 1.0 - LIMIT_KNEE;
            v = v.signum() * (LIMIT_KNEE + room * ((a - LIMIT_KNEE) / room).tanh());
        }
        v as f32
    }
}

/// rodio kaynağını saran EQ. Çıktı f32.
pub struct EqSource<S: Source<Item = i16>> {
    inner: S,
    proc: EqProcessor,
}

impl<S: Source<Item = i16>> EqSource<S> {
    pub fn new(inner: S, shared: Arc<EqShared>) -> Self {
        let proc = EqProcessor::new(shared, inner.sample_rate(), inner.channels());
        Self { inner, proc }
    }
}

impl<S: Source<Item = i16>> Iterator for EqSource<S> {
    type Item = f32;

    #[inline]
    fn next(&mut self) -> Option<f32> {
        let s = self.inner.next()?;
        if self.proc.since_check == 0 {
            self.proc.refresh(self.inner.sample_rate(), self.inner.channels(), false);
            self.proc.since_check = CHECK_EVERY;
        }
        self.proc.since_check -= 1;
        // i16 → [-1, 1) (rodio Sample::to_f32 ile aynı ölçek).
        Some(self.proc.process(s as f32 / 32768.0))
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        self.inner.size_hint()
    }
}

impl<S: Source<Item = i16>> Source for EqSource<S> {
    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len()
    }
    fn channels(&self) -> u16 {
        self.inner.channels()
    }
    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }
    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }
    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        self.inner.try_seek(pos)?;
        // Sıçramadan sonra eski örneklerin kalıntısı tık yapmasın.
        self.proc.reset();
        self.proc.ch = 0;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FS: f64 = 48000.0;

    fn total_db(p: &EqParams, f: f64, fs: f64) -> f64 {
        let pl = plan(p, fs);
        if !pl.active {
            return 0.0;
        }
        let bands: f64 = pl.bands.iter().map(|c| magnitude_db(c, f, fs)).sum();
        bands + 20.0 * pl.gain.log10()
    }

    fn params(g: [f32; BANDS]) -> EqParams {
        EqParams { enabled: true, preamp_db: 0.0, gains_db: g }
    }

    #[test]
    fn peak_gives_requested_gain_at_center_only() {
        let c = design(Kind::Peak, 910.0, 6.0, FS);
        assert!((magnitude_db(&c, 910.0, FS) - 6.0).abs() < 0.05);
        assert!(magnitude_db(&c, 10000.0, FS).abs() < 0.3);
        assert!(magnitude_db(&c, 60.0, FS).abs() < 0.5);
    }

    #[test]
    fn shelves_reach_gain_in_their_band() {
        let lo = design(Kind::LowShelf, 60.0, 9.0, FS);
        assert!((magnitude_db(&lo, 20.0, FS) - 9.0).abs() < 0.5);
        assert!(magnitude_db(&lo, 5000.0, FS).abs() < 0.2);
        let hi = design(Kind::HighShelf, 14000.0, -9.0, 44100.0);
        assert!((magnitude_db(&hi, 20000.0, 44100.0) + 9.0).abs() < 1.0);
        assert!(magnitude_db(&hi, 500.0, 44100.0).abs() < 0.2);
    }

    #[test]
    fn flat_is_bypass() {
        let sh = Arc::new(EqShared::default());
        sh.set(params([0.0; BANDS]));
        let mut p = EqProcessor::new(sh, 48000, 2);
        assert!(p.is_bypass());
        for x in [0.0f32, 0.3, -0.7, 0.999] {
            assert_eq!(p.process(x).to_bits(), x.to_bits());
        }
    }

    #[test]
    fn disabled_is_bypass_even_with_gains() {
        let sh = Arc::new(EqShared::default());
        let mut pr = params([6.0; BANDS]);
        pr.enabled = false;
        sh.set(pr);
        assert!(EqProcessor::new(sh, 44100, 2).is_bypass());
    }

    #[test]
    fn auto_headroom_keeps_boost_below_unity() {
        // +12 dB bas: toplam tepe kazancı preamp ile 0 dB'ye çekilmeli.
        let pr = params([12.0, 0.0, 0.0, 0.0, 0.0]);
        let mut peak = f64::MIN;
        for k in 0..200 {
            peak = peak.max(total_db(&pr, 20.0 * 1000f64.powf(k as f64 / 199.0), FS));
        }
        assert!(peak < 0.1, "peak {peak}");
    }

    fn run_sine(pr: EqParams, freq: f64, rate: u32) -> (f64, bool) {
        let sh = Arc::new(EqShared::default());
        sh.set(pr);
        let mut p = EqProcessor::new(sh, rate, 1);
        let n = rate as usize; // 1 sn
        let mut sum_sq = 0.0f64;
        let mut cnt = 0usize;
        let mut finite = true;
        for i in 0..n {
            let x = 0.25 * (2.0 * PI * freq * i as f64 / rate as f64).sin();
            let y = p.process(x as f32);
            finite &= y.is_finite();
            if i > n / 2 {
                sum_sq += (y as f64) * (y as f64);
                cnt += 1;
            }
        }
        let rms_out = (sum_sq / cnt as f64).sqrt();
        let rms_in = 0.25 / 2f64.sqrt();
        (20.0 * (rms_out / rms_in).log10(), finite)
    }

    #[test]
    fn sine_through_processor_matches_response_and_is_finite() {
        // Headroom düşümü dahil beklenen kazanç = total_db.
        let pr = params([0.0, 0.0, 6.0, 0.0, 0.0]);
        for &(f, rate) in &[(910.0, 48000u32), (10000.0, 44100u32)] {
            let (db, finite) = run_sine(pr, f, rate);
            assert!(finite);
            let want = total_db(&pr, f, rate as f64);
            assert!((db - want).abs() < 0.1, "f={f} got {db} want {want}");
        }
    }

    #[test]
    fn extreme_settings_never_nan_or_clip_hard() {
        let pr = EqParams { enabled: true, preamp_db: 12.0, gains_db: [12.0; BANDS] };
        let sh = Arc::new(EqShared::default());
        sh.set(pr);
        let mut p = EqProcessor::new(sh, 44100, 2);
        for i in 0..44100 {
            let x = (0.99 * (i as f32 * 0.05).sin()).clamp(-1.0, 1.0);
            let y = p.process(x);
            assert!(y.is_finite() && y.abs() <= 1.0 + 1e-6);
        }
    }

    #[test]
    fn settings_change_is_picked_up_via_generation() {
        let sh = Arc::new(EqShared::default());
        let mut p = EqProcessor::new(sh.clone(), 48000, 1);
        assert!(p.is_bypass());
        sh.set(params([0.0, 6.0, 0.0, 0.0, 0.0]));
        p.refresh(48000, 1, false);
        assert!(!p.is_bypass());
    }

    #[test]
    fn nan_input_params_are_sanitized() {
        let sh = EqShared::default();
        sh.set(EqParams { enabled: true, preamp_db: f32::NAN, gains_db: [f32::INFINITY, 99.0, -99.0, 0.0, 0.0] });
        let s = sh.snapshot();
        assert_eq!(s.gains_db, [0.0, 12.0, -12.0, 0.0, 0.0]);
        assert_eq!(s.preamp_db, 0.0);
    }
}
