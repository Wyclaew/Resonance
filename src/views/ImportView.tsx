import { useState } from "react";
import { Download, Link2 } from "lucide-react";
import ViewHeader from "../components/ViewHeader";

// M0 iskelet. Gerçek içe aktarma (Spotify API + yt-dlp eşleme) M5'te.
export default function ImportView() {
  const [url, setUrl] = useState("");

  const detected = detectSource(url);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <ViewHeader
        title="İçe Aktar"
        subtitle="Spotify veya YouTube Music çalma listesi linkini yapıştır, uygulama içine kopyasını al."
      />

      <div className="mx-auto w-full max-w-2xl px-8">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 focus-within:border-border-strong">
          <Link2 size={18} className="text-faint" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://open.spotify.com/playlist/... veya https://music.youtube.com/playlist?list=..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
          />
          <button
            disabled={!detected}
            className="flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Download size={15} />
            İçe Aktar
          </button>
        </div>

        {url && (
          <p className="mt-2 px-1 text-xs text-muted">
            {detected
              ? `Algılandı: ${detected}`
              : "Geçerli bir Spotify veya YouTube Music çalma listesi linki değil."}
          </p>
        )}

        <div className="mt-6 rounded-lg border border-border bg-surface/50 p-5 text-sm leading-relaxed text-muted">
          <p className="mb-2 font-medium text-text">Nasıl çalışır?</p>
          <p>
            Spotify'ın sesi doğrudan alınamaz. Uygulama, çalma listendeki şarkı
            adlarını ve sanatçıları okur, her birini YouTube'da bulur ve uygulama
            içinde bir kopyasını oluşturur. Ses YouTube'dan çalar.
          </p>
          <p className="mt-2 text-faint">
            Not: Spotify için Ayarlar → Entegrasyonlar'dan tek seferlik ücretsiz
            bir API anahtarı gerekir. YouTube Music linkleri anahtarsız çalışır.
          </p>
        </div>
      </div>
    </div>
  );
}

function detectSource(url: string): string | null {
  const u = url.trim().toLowerCase();
  if (!u) return null;
  if (u.includes("open.spotify.com/playlist")) return "Spotify çalma listesi";
  if (u.includes("music.youtube.com") && u.includes("list="))
    return "YouTube Music çalma listesi";
  if (u.includes("youtube.com/playlist") && u.includes("list="))
    return "YouTube çalma listesi";
  return null;
}
