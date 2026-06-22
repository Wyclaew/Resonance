interface ViewHeaderProps {
  title: string;
  subtitle?: string;
  children?: React.ReactNode; // sağ taraf aksiyonları
}

export default function ViewHeader({ title, subtitle, children }: ViewHeaderProps) {
  return (
    <header className="flex items-end justify-between gap-4 px-8 pb-5 pt-7">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
        )}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </header>
  );
}
