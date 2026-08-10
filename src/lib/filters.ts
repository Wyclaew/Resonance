import type { TrKey } from "./i18n";

// ═══════════════════════════════════════════════════════════════════════════
// KEŞFET FİLTRELERİ — ruh hali + tür
//
// ⚠️ TEMEL KISIT: veritabanında TÜR/GENRE ALANI YOK. `tracks` yalnız başlık,
// sanatçı, süre tutuyor; YouTube radyosu da video ID'siyle çalışıyor. Yani
// "rock" filtresi için rock TOHUMUNU bir yerden üretmek gerekiyor.
//
// ÇÖZÜM (kullanıcı tercihi: "karışık"):
//  1. Filtrenin arama terimleriyle YouTube'da şarkı aranır → `isLikelySong`ten
//     geçenler radyo TOHUMU olur (tohum "şarkı" olduğu sürece radyo o tarzda
//     gerçek şarkılar döndürür).
//  2. Buna kullanıcının KENDİ yüksek yakınlıklı sanatçılarından da tohum
//     eklenir → gelen parti hem tanıdık hem yeni olur.
//  3. Sonuçlar sıralanırken kullanıcının sevdiği sanatçılar öne çekilir.
//
// NEDEN ARAMA TOHUM OLARAK GÜVENLİ: CLAUDE.md metin aramasının VİDEO (röportaj,
// tepki videosu) döndürdüğünü söyler — bu doğru, o yüzden arama sonuçları
// DOĞRUDAN öneri olarak KULLANILMAZ. Yalnız tohum seçilir ve tohum da
// `isLikelySong` + süre filtresinden geçirilir. Asıl parçalar radyodan gelir.
// ═══════════════════════════════════════════════════════════════════════════

export type FilterKind = "mood" | "genre";

export interface DiscoveryFilter {
  id: string;
  /** Ruh hali × tür BİRLEŞTİRİLİRKEN kullanılan kısa İngilizce terim
   *  ("energetic" + "rock" → "energetic rock songs"). */
  term: string;
  kind: FilterKind;
  labelKey: TrKey;
  /** Tohum aramak için kullanılacak sorgular (rastgele biri seçilir). */
  queries: string[];
}

export const DISCOVERY_FILTERS: DiscoveryFilter[] = [
  // — Ruh hali
  { id: "calm", term: "calm", kind: "mood", labelKey: "filter.calm",
    queries: ["calm hits", "sakin şarkılar", "chill hits"] },
  { id: "energetic", term: "energetic", kind: "mood", labelKey: "filter.energetic",
    queries: ["energetic hits", "hareketli şarkılar", "upbeat hits"] },
  { id: "sad", term: "sad", kind: "mood", labelKey: "filter.sad",
    queries: ["sad songs", "hüzünlü şarkılar", "melancholic music"] },
  { id: "focus", term: "instrumental focus", kind: "mood", labelKey: "filter.focus",
    queries: ["lofi beats", "instrumental focus hits"] },
  { id: "night", term: "late night", kind: "mood", labelKey: "filter.night",
    queries: ["late night songs", "gece müzikleri", "midnight vibes music"] },
  { id: "happy", term: "feel good", kind: "mood", labelKey: "filter.happy",
    queries: ["feel good songs", "neşeli şarkılar", "happy music"] },

  // — Tür
  { id: "rock", term: "rock", kind: "genre", labelKey: "filter.rock",
    queries: ["rock hits", "classic rock hits", "best rock songs"] },
  { id: "pop", term: "pop", kind: "genre", labelKey: "filter.pop",
    queries: ["pop hits", "best pop songs", "indie pop hits"] },
  { id: "rap", term: "rap", kind: "genre", labelKey: "filter.rap",
    queries: ["rap hits", "hip hop hits", "türkçe rap"] },
  { id: "electronic", term: "electronic", kind: "genre", labelKey: "filter.electronic",
    queries: ["electronic hits", "house music hits", "edm hits"] },
  { id: "turkish", term: "turkish", kind: "genre", labelKey: "filter.turkish",
    queries: ["türkçe şarkılar", "türkçe pop", "anadolu rock"] },
  { id: "jazz", term: "jazz", kind: "genre", labelKey: "filter.jazz",
    queries: ["jazz songs", "smooth jazz", "jazz standards"] },
  { id: "rnb", term: "r&b", kind: "genre", labelKey: "filter.rnb",
    queries: ["r&b songs", "soul songs", "neo soul music"] },
  { id: "metal", term: "metal", kind: "genre", labelKey: "filter.metal",
    queries: ["metal songs", "heavy metal", "metalcore songs"] },
  { id: "acoustic", term: "acoustic", kind: "genre", labelKey: "filter.acoustic",
    queries: ["acoustic songs", "akustik şarkılar", "singer songwriter"] },
  { id: "classical", term: "classical", kind: "genre", labelKey: "filter.classical",
    queries: ["classical music", "piano classical pieces"] },
];

export function filterById(id: string): DiscoveryFilter | undefined {
  return DISCOVERY_FILTERS.find((f) => f.id === id);
}

/**
 * Seçili filtreler için tohum arama sorguları.
 *
 * ⭐ RUH HALİ × TÜR ÇAPRAZLANIR. "Enerjik + Rock" seçen kullanıcı ENERJİK ROCK
 * bekler; her filtreye ayrı sorgu yapılsaydı sonuç bir BİRLEŞİM olurdu ve
 * kuyruğa enerjik Türkçe pop + rock karışık düşerdi (ölçüldü: Gülben Ergen
 * rock filtresiyle aynı partide çıkıyordu). Aynı GRUP içinde ise çoklu seçim
 * "veya" demektir (Rock + Metal → ikisinden de gelir).
 */
export function queriesFor(ids: string[]): string[] {
  const sel = ids.map(filterById).filter(Boolean) as DiscoveryFilter[];
  const moods = sel.filter((f) => f.kind === "mood");
  const genres = sel.filter((f) => f.kind === "genre");
  const shuffle = <T,>(a: T[]) => [...a].sort(() => Math.random() - 0.5);

  if (moods.length > 0 && genres.length > 0) {
    // ⭐ HER TÜRE BİR SORGU GARANTİSİ. Eskiden tüm mood×genre çiftleri üretilip
    // baştan kırpılıyordu; 4 filtre seçilince (ör. Sakin+Türkçe+Jazz+R&B)
    // rastgele sırada TÜRKÇE eleniyordu ve kullanıcı seçtiği türden tek şarkı
    // görmüyordu (ölçüldü). Artık her tür sırayla, rastgele bir ruh haliyle
    // eşleştirilir.
    // "songs" yerine "hits": stok/telifsiz müzik kanalları "… songs" ifadesine
    // SEO yapıyor.
    return shuffle(genres)
      .slice(0, 3)
      .map((g) => {
        const m = shuffle(moods)[0];
        return `${m.term} ${g.term} hits`;
      });
  }

  // Tek grup: her filtrenin kendi hazır sorgularından rastgele biri.
  return shuffle(sel)
    .slice(0, 3)
    .map((f) => f.queries[Math.floor(Math.random() * f.queries.length)]);
}

/** Tamamen rastgele bir filtre seti ("Rastgele" düğmesi). */
export function randomFilters(): string[] {
  const moods = DISCOVERY_FILTERS.filter((f) => f.kind === "mood");
  const genres = DISCOVERY_FILTERS.filter((f) => f.kind === "genre");
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  return [pick(moods).id, pick(genres).id];
}
