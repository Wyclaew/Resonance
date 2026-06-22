import { Library } from "lucide-react";
import ViewHeader from "../components/ViewHeader";

// M0 iskelet. M2'de SQLite'tan playlist/şarkı listesi gelecek.
export default function LibraryView() {
  return (
    <div className="flex h-full flex-col">
      <ViewHeader
        title="Kütüphane"
        subtitle="Çalma listelerin, kaydettiğin şarkılar ve içe aktarımlar."
      />
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-faint">
        <Library size={40} strokeWidth={1.5} />
        <p className="max-w-sm text-center text-sm leading-relaxed">
          Kütüphanen boş. Bir çalma listesi oluştur ya da Spotify / YouTube
          Music'ten içe aktararak başla.
        </p>
      </div>
    </div>
  );
}
