export default function StepDots({ total, current }: { total: number; current: number }) {
  if (total <= 1) return null
  return (
    <div className="flex justify-center gap-1.5 pb-3">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            i === current ? 'w-6 bg-indigo-600' : 'w-1.5 bg-slate-200 dark:bg-slate-700'
          }`}
        />
      ))}
    </div>
  )
}
