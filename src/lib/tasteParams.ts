/**
 * ⭐ ZEVK PARAMETRELERİ — saf, veritabanına dokunmayan hesaplar.
 *
 * Genel motor (`recommender.ts`) ve liste profili (`playlistProfile.ts`) aynı
 * eşikleri kullansın diye burada. Hepsi bir ÇARPAN döndürür; hiçbiri bir
 * sanatçıyı ya da parçayı tamamen öldürmez (keşif kapanmasın).
 */

/** Dinlemeden "tamamlandı / atlandı" kararı — motorun eşikleriyle aynı. */
export const COMPLETE_RATIO = 0.7;
export const SKIP_RATIO = 0.15;
export const SKIP_MS = 5000;

/**
 * Zevk sinyalleri önbelleğinin sürümü. Oy, dinleme ya da senkronla gelen veri
 * sinyalleri değiştirdiğinde artırılır → bir sonraki öneri taze hesaplar.
 * (Burada, çünkü bu dosyanın hiç bağımlılığı yok: history/playlists/engine
 * döngüsel import olmadan çağırabilir.)
 */
let tasteEpoch = 0;
export function bumpTasteEpoch(): void {
  tasteEpoch += 1;
}
export function currentTasteEpoch(): number {
  return tasteEpoch;
}

export function listenRatio(msPlayed: number, durationMs: number): number {
  return durationMs > 0 ? Math.min(1, msPlayed / durationMs) : 0;
}

export function isComplete(msPlayed: number, durationMs: number): boolean {
  return listenRatio(msPlayed, durationMs) > COMPLETE_RATIO;
}

export function isSkip(msPlayed: number, durationMs: number): boolean {
  return msPlayed < SKIP_MS || listenRatio(msPlayed, durationMs) < SKIP_RATIO;
}

export interface ArtistHabit {
  plays: number;
  completes: number;
  /** Son 3 günde kaç kez çalındı (bıkkınlık için). */
  recent: number;
}

/**
 * TAMAMLAMA ORANI: "seviyorum" başka, "çıkınca sonuna kadar dinliyorum" başka.
 * Beta yumuşatma (önsel 2/4): 1 dinlemeyle uç değere gitmesin. 0.6..1.4.
 */
export function completionBoost(h: ArtistHabit | undefined): number {
  if (!h || h.plays < 3) return 1;
  const rate = (h.completes + 2) / (h.plays + 4);
  return 0.6 + 0.8 * Math.min(1, Math.max(0, rate));
}

/**
 * BIKKINLIK: son 3 günde çok çalınan sanatçı bir süre tohum olmasın. Yakınlık
 * tam da o sırada en yüksek olduğu için model kendi kendine aynı sanatçıya
 * kilitleniyordu. 6 dinlemeye kadar etkisiz, taban 0.4.
 */
export function fatigueFactor(h: ArtistHabit | undefined): number {
  const n = h?.recent ?? 0;
  return n <= 6 ? 1 : Math.max(0.4, 1 - (n - 6) * 0.06);
}

/**
 * ⭐ SANATÇI ANAHTARI (v1.9.9): `tracks.artist` YouTube KANAL adıdır ve aynı
 * sanatçı birden çok yazımla geliyor (kullanıcı verisinden: "ImagineDragons" /
 * "Imagine Dragons", "League Of Legends" / "League of Legends", sonda boşluklu
 * "UDIENNX ", "Rammstein Official"). Yakınlık bunlara BÖLÜNÜYOR, "parti başına
 * sanatçı başına 1" kuralı da aynı sanatçıyı iki kez geçiriyordu.
 * BİLEREK TEMKİNLİ: yalnız biçim farkı + kanal ekleri atılır; "X & Y" gibi
 * gerçekten farklı olabilecek adlara dokunulmaz (yanlış birleştirme, ikiye
 * bölünmekten kötü).
 */
const CHANNEL_SUFFIX = /(\s*-\s*topic|\s*vevo|\s+official(\s+(channel|music|artist))?|\s+resmi)\s*$/i;
export function artistKey(raw: string): string {
  let s = (raw ?? "").normalize("NFKC").trim();
  for (let i = 0; i < 2; i++) s = s.replace(CHANNEL_SUFFIX, "").trim();
  // Türkçe küçük harf + ı→i: "ILYAS", "İlyas", "Ilyas" aynı anahtara düşsün.
  return s.toLocaleLowerCase("tr").replace(/ı/g, "i").replace(/[\s._-]+/g, "");
}

export type TitleScript = "tr" | "cyrillic" | "arabic" | "cjk" | "latin";

/**
 * Başlığın dili/yazısı için kaba vekil. Veritabanında dil alanı yok; liste
 * profilinde "bu liste Türkçe değil" bilgisini vermeye yeter.
 */
export function titleScript(title: string): TitleScript {
  if (/[Ѐ-ӿ]/.test(title)) return "cyrillic";
  if (/[؀-ۿ]/.test(title)) return "arabic";
  if (/[぀-ヿ㐀-鿿가-힯]/.test(title)) return "cjk";
  if (/[çğıİşÇĞŞ]/.test(title)) return "tr";
  return "latin";
}

/** Adayın yazısı listede ne kadar yaygın? 0.25..1.5 */
export function scriptFit(
  shares: Map<TitleScript, number>,
  title: string
): number {
  if (shares.size === 0) return 1;
  const share = shares.get(titleScript(title)) ?? 0;
  return 0.25 + 1.25 * share;
}

/** Aday süresi listenin ortancasına ne kadar uzak? 0.5..1 */
export function durationFit(medianMs: number, durationMs: number): number {
  if (medianMs <= 0 || durationMs <= 0) return 1;
  const off = Math.abs(Math.log(durationMs / medianMs));
  return off < 0.35 ? 1 : Math.max(0.5, 1 - (off - 0.35));
}
