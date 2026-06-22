import { Sparkles, Clock } from "lucide-react";
import ViewHeader from "../components/ViewHeader";

// "Şu An" — öğrenen algoritmanın o anki gün/saate göre önerdiği görünüm (M4).
// M0: kavramı tanıtan iskelet.
export default function HomeView() {
  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 6
      ? "İyi geceler"
      : hour < 12
      ? "Günaydın"
      : hour < 18
      ? "İyi günler"
      : "İyi akşamlar";

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <ViewHeader
        title={greeting}
        subtitle="Algoritma, gün ve saate göre senin için seçiyor."
      />

      <div className="px-8 pb-8">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface/60 px-5 py-4">
          <Clock size={18} className="text-accent" />
          <p className="text-sm text-muted">
            Şu an{" "}
            <span className="tnum text-text">
              {String(hour).padStart(2, "0")}:
              {String(now.getMinutes()).padStart(2, "0")}
            </span>{" "}
            ·{" "}
            {
              ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"][
                now.getDay()
              ]
            }
            . Oy verdikçe öneriler bu bağlama göre keskinleşecek.
          </p>
        </div>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 py-16 text-faint">
          <Sparkles size={40} strokeWidth={1.5} />
          <p className="max-w-md text-center text-sm leading-relaxed">
            Henüz yeterli veri yok. Çalma listelerindeki şarkılara upvote /
            downvote vermeye başla — algoritma hangi gün ve saatte neyi
            sevdiğini öğrenip burayı sana göre dolduracak.
          </p>
        </div>
      </div>
    </div>
  );
}
