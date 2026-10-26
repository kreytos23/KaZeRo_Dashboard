'use client';

import './globals.css';

/** Reemplaza al layout raíz cuando este falla: por eso lleva su propio <html> y <body>. */
export default function ErrorGlobal({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es-MX">
      <body className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 bg-crema px-4 text-tinta">
        <title>Error · Kazero</title>
        <h1 className="text-2xl font-semibold">Algo salió mal</h1>
        {/* Nunca error.message: podría traer detalles internos. */}
        <p>Intenta de nuevo.{error.digest ? ` Código: ${error.digest}.` : ''}</p>
        <button type="button" onClick={reset} className="boton-primario self-start">
          Reintentar
        </button>
      </body>
    </html>
  );
}
