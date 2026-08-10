// Cihaz / kurulum kimliği. İleride bulut senkronunda hangi cihazın hangi
// değişikliği yaptığını ayırt etmek için kullanılacak. Yerelde saklanır.
const KEY = "resonance.deviceId";

export function getDeviceId(): string {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

// Olay günlüğü satırları (votes / play_history / recommendation_history) için
// CİHAZDAN BAĞIMSIZ benzersiz kimlik.
//
// NEDEN: bu tablolar AUTOINCREMENT `id` kullanıyor → iki cihaz KAÇINILMAZ
// olarak aynı id'yi üretir (ikisi de 1, 2, 3… diye sayar). Buluta bu id ile
// yazılsa cihazlar birbirinin oylarını ezerdi. `uid` upsert anahtarıdır:
// aynı satır iki kez gelse bile tek kayıt olur (idempotent).
export function newUid(): string {
  return crypto.randomUUID();
}
