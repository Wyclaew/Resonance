// Karma decay: oylar zamanla değer kaybeder (üssel, yarı ömür gün cinsinden).
// Böylece son zamanlarda upvote'ladıkların yukarı çıkar, eski oylar zamanla solar.
// Yarı ömür ileride Ayarlar'dan (M6) değiştirilebilecek.

export const DEFAULT_HALF_LIFE_DAYS = 30;

const DAY_MS = 86_400_000;

export interface VoteEvent {
  value: number;
  createdAt: number;
}

export function decayWeight(
  ageMs: number,
  halfLifeDays = DEFAULT_HALF_LIFE_DAYS
): number {
  const ageDays = Math.max(0, ageMs) / DAY_MS;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

// Bir parçanın decay'li karma skoru = Σ (oy_değeri * decay(yaş)).
export function computeKarma(
  events: VoteEvent[],
  now = Date.now(),
  halfLifeDays = DEFAULT_HALF_LIFE_DAYS
): number {
  let sum = 0;
  for (const e of events) {
    sum += e.value * decayWeight(now - e.createdAt, halfLifeDays);
  }
  return sum;
}

// Gösterim için yuvarla (taze tek upvote ≈ 1, downvote ≈ -1).
export function displayKarma(karma: number): number {
  return Math.round(karma);
}
