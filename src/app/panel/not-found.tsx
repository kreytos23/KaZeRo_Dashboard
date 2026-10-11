import Link from 'next/link';

export const metadata = { title: 'No encontrado' };

export default function RegistroNoEncontrado() {
  return (
    <section className="flex max-w-md flex-col gap-4">
      <h1 className="text-2xl font-semibold">No encontramos ese registro</h1>
      {/* Mensaje genérico a propósito: no confirma si el registro existió. */}
      <p className="text-tinta-suave">
        Puede que el enlace esté mal escrito. Usa el buscador (tecla /) para encontrarlo.
      </p>
      <Link
        href="/panel"
        className="flex min-h-11 items-center self-start rounded-lg border border-secundario bg-white px-4 font-medium text-secundario hover:bg-secundario-suave"
      >
        Volver al panel
      </Link>
    </section>
  );
}
