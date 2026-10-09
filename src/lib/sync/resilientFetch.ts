// ═══════════════════════════════════════════════════════════════════════════
// DAYANIKLI FETCH (v1.9.7) — Supabase istemcisinin TÜM HTTP istekleri buradan.
//
// ⛔ NEDEN: Windows'ta hesaba girerken "Failed to fetch" (WebKit'te "Load
// failed"). Bu, isteğin tarayıcı motorunun AĞ katmanında düştüğü anlamına
// gelir: sunucu cevabı yok, JS'ten sebep görünmüyor. Mac'te de bir kez,
// geçici olarak görüldü (log: "playlists push: TypeError: Load failed").
//
// Önce normal `fetch`; ağ hatası (TypeError) gelirse aynı istek masaüstü
// uygulamanın kendi HTTP istemcisinden (Rust `net_fetch`, WebView2'den
// bağımsız) tekrar gönderilir. O yol bir kez çalışırsa bu oturumda doğrudan
// o kullanılır (her istekte önce düşen yolu beklememek için). İkisi de
// düşerse Rust'ın SINIFLANDIRILMIŞ hatası fırlatılır ("DNS çözülemedi",
// "sertifika — saat yanlış olabilir" …) → kullanıcı ne yapacağını görür.
//
// ⚠️ PAYLAŞILAN DOSYA (mobil kopyalar): yedek yol YALNIZ gerçek Tauri'de
// (`__TAURI_INTERNALS__`) devreye girer; mobilde düz `fetch` olarak kalır.
// ═══════════════════════════════════════════════════════════════════════════

interface NativeResponse {
  status: number;
  status_text: string;
  headers: [string, string][];
  body: string;
}

let preferNative = false;

function hasNative(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function viaNative(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const { invoke } = await import("@tauri-apps/api/core");
  const req = new Request(input, init);
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => (headers[k] = v));
  let body: string | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = typeof init?.body === "string" ? init.body : await req.text();
  }
  const res = await invoke<NativeResponse>("net_fetch", {
    req: { url: req.url, method: req.method, headers, body },
  });
  // 204/205/304 gövdesiz olmalı, yoksa Response kurucusu hata verir.
  const noBody = [101, 204, 205, 304].includes(res.status);
  return new Response(noBody ? null : res.body, {
    status: res.status,
    statusText: res.status_text,
    headers: res.headers,
  });
}

export const resilientFetch: typeof fetch = async (input, init) => {
  if (!hasNative()) return fetch(input, init);
  if (preferNative) return viaNative(input, init);
  try {
    return await fetch(input, init);
  } catch (e) {
    // Yalnız AĞ hatası (TypeError). İptal (AbortError) olduğu gibi geçer.
    if (!(e instanceof TypeError)) throw e;
    try {
      const res = await viaNative(input, init);
      if (!preferNative) {
        preferNative = true;
        console.warn(
          `[sync] tarayıcı ağı başarısız (${e.message}); uygulamanın kendi ağ yolu kullanılıyor`
        );
      }
      return res;
    } catch (nativeErr) {
      const why = nativeErr instanceof Error ? nativeErr.message : String(nativeErr);
      console.error(`[sync] ağ isteği iki yoldan da başarısız: ${e.message} / ${why}`);
      throw new TypeError(why);
    }
  }
};
