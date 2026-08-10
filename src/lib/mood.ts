// ═══════════════════════════════════════════════════════════════════════════
// OTURUM MODU — "şu an ne dinlemek istiyorum?"
//
// PROBLEM (kullanıcının şikâyeti): Keşfet bir partide yalnız 3-4 sanatçının
// radyosundan besleniyordu → hep aynı tarz. Üstelik kalıcı geçmiş (oylar,
// dinleme) "genel zevki" bilse de "BUGÜN CANIM NE İSTİYOR"u bilmiyordu.
//
// ÇÖZÜM: uygulama açıkken canlı bir mod profili tut.
//  • Bir parçayı sonuna kadar dinledin → o TARZ şu anki modunla uyumlu → besle.
//  • Hemen geçtin → bu tarz şu an tutmuyor → azalt.
//  • Ama moda saplanıp kalmamak için düzenli olarak FARKLI tarzdan bir "prob"
//    (deneme parçası) at ve tepkini ölç → mod değiştiyse yakala.
//
// "Tarz" için vekil (proxy): önerinin geldiği RADYONUN SEED SANATÇISI
// (`Recommendation.seedArtist`). Veritabanında tür/genre alanı yok; seed
// sanatçı pratikte iyi bir tarz kümesi oluşturuyor (aynı radyodan gelenler
// birbirine benzer).
//
// Bu profil KALICI DEĞİLDİR (uygulama kapanınca sıfırlanır) — bilerek: "mod"
// bugüne aittir, kalıcı zevk zaten votes/play_history'de öğreniliyor.
// ═══════════════════════════════════════════════════════════════════════════

type StyleStat = {
  /** Kaç kez dinlendi (bu oturumda). */
  plays: number;
  /** Tamamlanma oranlarının toplamı (0..1). */
  sumRatio: number;
  lastAt: number;
};

const styles = new Map<string, StyleStat>();

// Prob oranı: kullanıcı tercihi "orta — ~5 şarkıda 1".
// UYGULAMA: parti kurulurken ~6 radyodan BİRİ bilerek modu ölçülmemiş bir
// tarzdan seçilir (recommender.ts). Round-robin ile her radyodan sırayla parça
// alındığı için bu, kuyrukta ~5-6 şarkıda 1 prob demektir.
export const PROBE_EVERY = 5;

/** Tamamlanma oranından mod puanı. Kullanıcının davranış eşikleriyle uyumlu. */
function moodScore(ratio: number): number {
  if (ratio >= 0.7) return 1; // sonuna kadar dinledi → bu tarz tam isabet
  if (ratio >= 0.4) return 0.35; // yarısını geçti → fena değil
  if (ratio >= 0.15) return -0.15; // az dinledi → pek tutmadı
  return -0.5; // hemen geçti → bu tarz şu an olmadı
}

/**
 * Bir Keşfet parçası bitti/geçildi — modu güncelle.
 * @param seedArtist Parçayı getiren radyonun seed sanatçısı.
 * @param ratio Dinlenen oran (0..1).
 */
export function noteListen(seedArtist: string | undefined, ratio: number): void {
  if (!seedArtist) return;
  const key = seedArtist.toLowerCase();
  const s = styles.get(key) ?? { plays: 0, sumRatio: 0, lastAt: 0 };
  s.plays += 1;
  s.sumRatio += Math.max(0, Math.min(1, ratio));
  s.lastAt = Date.now();
  styles.set(key, s);
}

/** Bir tarzın mod puanı: −0.5 … +1 arası ortalama. Bilinmiyorsa 0 (nötr). */
export function styleMood(seedArtist: string): number {
  const s = styles.get(seedArtist.toLowerCase());
  if (!s || s.plays === 0) return 0;
  return moodScore(s.sumRatio / s.plays);
}

/**
 * Seed örneklemesi için çarpan. Kalıcı yakınlık puanı bununla ÇARPILIR:
 * modunla uyumlu tarzlar öne çıkar, tutmayanlar geriler — ama hiçbiri
 * tamamen sıfırlanmaz (0.35 taban), yoksa keşif ölür.
 */
export function moodMultiplier(seedArtist: string): number {
  const m = styleMood(seedArtist);
  return Math.max(0.35, 1 + m); // −0.5 → 0.5 ;  +1 → 2.0
}

/** Bu oturumda modla en uyumlu tarzlar (UI'da göstermek için). */
export function topStyles(n = 3): string[] {
  return [...styles.entries()]
    .filter(([, s]) => s.plays > 0)
    .map(([k, s]) => ({ k, score: moodScore(s.sumRatio / s.plays) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.k);
}

/** Modu hiç ölçülmemiş / kötü giden tarzlar — prob adayları. */
export function isProbeCandidate(seedArtist: string): boolean {
  const s = styles.get(seedArtist.toLowerCase());
  return !s || s.plays === 0;
}

export function resetMood(): void {
  styles.clear();
}
