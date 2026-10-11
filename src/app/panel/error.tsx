'use client';

export default function ErrorPanel({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section role="alert" className="flex max-w-md flex-col gap-4">
      <h1 className="text-2xl font-semibold">Algo salió mal</h1>
      {/* Nunca error.message: podría traer detalles internos. El digest sirve para buscar en los logs. */}
      <p className="text-stone-600">
        No se pudo cargar esta sección.{error.digest ? ` Código: ${error.digest}.` : ''}
      </p>
      <button
        type="button"
        onClick={reset}
        className="min-h-11 self-start rounded-lg bg-stone-900 px-4 text-white"
      >
        Reintentar
      </button>
    </section>
  );
}
