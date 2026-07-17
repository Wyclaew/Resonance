// Resonance logosu — uygulama ikonundaki 7 çubuklu ses dalgasının aynısı.
// Eskiden UI'da "◈" karakteri kullanılıyordu; ikonla alakasız olduğu için
// garip duruyordu. Bu SVG `src-tauri/app-icon.svg`'deki çubukların birebir
// aynı geometrisi (1024 kanvas → 24 viewBox'a ölçeklendi).
//
// Renk: `currentColor` → sarmalayıcının `text-accent`'i neyse onu alır, yani
// kullanıcının seçtiği vurgu rengine ve temaya uyar.

export default function Logo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      {/* app-icon.svg'deki 7 çubuk: x/y/genişlik/yükseklik değerleri /42.67 ölçekli */}
      <rect x="5.45" y="10.10" width="1.22" height="3.81" rx="0.61" />
      <rect x="7.43" y="8.76" width="1.22" height="6.47" rx="0.61" />
      <rect x="9.41" y="7.43" width="1.22" height="9.14" rx="0.61" />
      <rect x="11.39" y="6.29" width="1.22" height="11.43" rx="0.61" />
      <rect x="13.37" y="7.43" width="1.22" height="9.14" rx="0.61" />
      <rect x="15.35" y="8.76" width="1.22" height="6.47" rx="0.61" />
      <rect x="17.33" y="10.10" width="1.22" height="3.81" rx="0.61" />
    </svg>
  );
}
