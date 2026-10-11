export default function Cargando() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-3">
      <span className="sr-only">Cargando…</span>
      {/* motion-safe: respeta "menos movimiento" del sistema (lecciones §7). */}
      <div className="h-8 w-48 rounded bg-stone-200 motion-safe:animate-pulse" />
      <div className="h-4 w-full max-w-xl rounded bg-stone-200 motion-safe:animate-pulse" />
      <div className="h-4 w-full max-w-lg rounded bg-stone-200 motion-safe:animate-pulse" />
    </div>
  );
}
