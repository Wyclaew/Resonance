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
