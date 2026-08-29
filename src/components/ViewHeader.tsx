interface ViewHeaderProps {
  title: string;
  subtitle?: string;
  children?: React.ReactNode; // sağ taraf aksiyonları
}

export default function ViewHeader({ title, subtitle, children }: ViewHeaderProps) {
  return (
    // ⚠️ DAR PENCEREDE DÜĞMELER EZİLİYORDU: başlık bloğu küçülemediği
    // (min-w-0 yok) ve aksiyonlar shrink-0 olmadığı için düğmeler sıkışıyor,
    // içlerindeki yazı satır atlayınca "ağzı yüzü kayıyordu". Artık başlık
    // kısalır, aksiyonlar sıkışmak yerine ALT SATIRA taşar.
    <header className="flex items-end justify-between gap-4 px-8 pb-5 pt-7">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && (
          <p className="mt-1 truncate text-sm text-muted">{subtitle}</p>
        )}
      </div>
      {children && (
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {children}
        </div>
      )}
    </header>
  );
}
