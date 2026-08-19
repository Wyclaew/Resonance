import { invoke } from "@tauri-apps/api/core";
import { getDb, isTauri } from "./db";

// ═══════════════════════════════════════════════════════════════════════════
// SES SEVİYESİ EŞİTLEME (ReplayGain mantığı)
//
// PROBLEM: kaynak YouTube olduğu için parçalar arası seviye farkı çok büyük —
// bir şarkı patlıyor, sonraki fısıldıyor. Kullanıcı her şarkıda sesi elle
// oynatmak zorunda kalıyordu.
//
// ÇÖZÜM: dosya BİR KEZ ölçülür (ffmpeg loudnorm → LUFS + tepe), sonuç yerel
// `track_loudness` tablosuna yazılır, çalarken kazanç ses seviyesine ÇARPILIR.
//
// ⛔ SENKRONLANMAZ: ölçüm dosyadan türetilir ve her cihaz kendi indirdiğini
// saniyeler içinde ölçer; buluta taşımanın değeri yok.
//
// ⚠️ KIRPMA (clipping) KORUMASI: yalnız hedefe göre yükseltmek yetmez —
// zaten tepe seviyesi 0 dBFS'e yakın bir parçayı yükseltmek bozulma yaratır.
// Bu yüzden kazanç, ölçülen TEPE değerinin bıraktığı boşlukla sınırlanır.
// ═══════════════════════════════════════════════════════════════════════════

/** Hedef seviye. −14 LUFS akış servislerinin (Spotify/YouTube) fiili standardı. */
const TARGET_LUFS = -14;
const MAX_BOOST_DB = 6;
const MAX_CUT_DB = -12;
/** Tepe için emniyet payı (dB). */
const HEADROOM_DB = 1;

type Measurement = { lufs: number; peakDb: number };

const cache = new Map<string, Measurement | null>();
// Süren ölçümler. Çalma ve prefetch aynı parçayı aynı anda isteyebilir;
// kilit olmadan ffmpeg iki kez çalışırdı.
const inflight = new Map<string, Promise<number>>();

/** Ölçümden çalma kazancı (lineer çarpan). */
export function gainFrom(m: Measurement): number {
  let db = TARGET_LUFS - m.lufs;
  db = Math.max(MAX_CUT_DB, Math.min(MAX_BOOST_DB, db));
  // Kırpma koruması: tepe + kazanç, −1 dBFS'i aşmasın.
  const headroom = -HEADROOM_DB - m.peakDb;
  if (db > headroom) db = headroom;
  const gain = Math.pow(10, db / 20);
  return Math.max(0.25, Math.min(2, gain));
}

async function readStored(trackId: string): Promise<Measurement | null> {
  try {
    const db = await getDb();
    const rows = await db.select<{ lufs: number; peak_db: number }[]>(
      `SELECT lufs, peak_db FROM track_loudness WHERE track_id = $1`,
      [trackId]
    );
    const r = rows[0];
    return r ? { lufs: r.lufs, peakDb: r.peak_db } : null;
  } catch {
    return null;
  }
}

async function store(trackId: string, m: Measurement): Promise<void> {
  try {
    const db = await getDb();
    await db.execute(
      `INSERT INTO track_loudness (track_id, lufs, peak_db, measured_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT(track_id) DO UPDATE SET
         lufs = excluded.lufs, peak_db = excluded.peak_db,
         measured_at = excluded.measured_at`,
      [trackId, m.lufs, m.peakDb, Date.now()]
    );
  } catch (e) {
    console.error("[resonance] yükseklik ölçümü yazılamadı:", e);
  }
}

/**
 * Parçanın kazancını döndürür; ölçüm yoksa ÖLÇER (ffmpeg, ~1-2 sn).
 * Ölçüm başarısızsa 1 döner — özellik sessizce devre dışı kalır, çalma
 * hiçbir şekilde etkilenmez.
 */
export async function gainForTrack(
  trackId: string,
  sourceId: string
): Promise<number> {
  if (!isTauri()) return 1;
  const hit = cache.get(trackId);
  if (hit !== undefined) return hit ? gainFrom(hit) : 1;
  const pending = inflight.get(trackId);
  if (pending) return pending;

  const task = (async () => {
    const stored = await readStored(trackId);
    if (stored) {
      cache.set(trackId, stored);
      return gainFrom(stored);
    }
    try {
      const res = await invoke<{ lufs: number; peakDb: number }>(
        "measure_loudness",
        { sourceId }
      );
      const m = { lufs: res.lufs, peakDb: res.peakDb };
      cache.set(trackId, m);
      await store(trackId, m);
      return gainFrom(m);
    } catch (e) {
      // Dosya henüz inmemiş olabilir → ölçümü kalıcı olarak "yok" İŞARETLEME
      // (cache'e null yazma), bir sonraki çalışta yeniden denensin.
      console.warn("[resonance] yükseklik ölçülemedi:", e);
      return 1;
    }
  })();

  inflight.set(trackId, task);
  try {
    return await task;
  } finally {
    inflight.delete(trackId);
  }
}

/**
 * Sıradaki parçayı önceden ölç (prefetch ile birlikte). Böylece şarkı
 * başlarken kazanç HAZIRDIR; aksi hâlde ilk 1-2 saniye düzeltmesiz çalıp
 * ölçüm bitince seviye gözle görülür şekilde sıçrıyordu.
 */
export async function premeasure(trackId: string, sourceId: string): Promise<void> {
  try {
    await gainForTrack(trackId, sourceId);
  } catch {
    /* sessiz — sadece bir hazırlık */
  }
}

/** Ölçüm kaydı olmayan parçalar için (ör. dosya silindiyse) önbelleği boşalt. */
export function forgetLoudness(trackId: string): void {
  cache.delete(trackId);
}
