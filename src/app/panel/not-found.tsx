import Link from 'next/link';

export const metadata = { title: 'No encontrado' };

export default function RegistroNoEncontrado() {
  return (
    <section className="flex max-w-md flex-col gap-4">
      <h1 className="text-2xl font-semibold">No encontramos ese registro</h1>
      {/* Mensaje genérico a propósito: no confirma si el registro existió. */}
      <p className="text-stone-600">
        Puede que el enlace esté mal escrito. Usa el buscador (tecla /) para encontrarlo.
      </p>
      <Link
        href="/panel"
        className="flex min-h-11 items-center self-start rounded-lg border border-stone-300 px-4"
      >
        Volver al panel
      </Link>
    </section>
  );
}
