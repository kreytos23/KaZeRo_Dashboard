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
      <Link href="/panel" className="boton-secundario self-start">
        Volver al panel
      </Link>
    </section>
  );
}
