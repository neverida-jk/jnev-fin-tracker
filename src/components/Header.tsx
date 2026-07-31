export default function Header({ title }: { title: string }) {
  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
      <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
    </header>
  )
}
