import Image from 'next/image';
import Link from 'next/link';

export const metadata = { title: 'No encontrado' };

export default function NoEncontrado() {
  return (
    <main className="fondo-acuarela flex min-h-dvh items-center px-4">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        <Image src="/marca/logo-k.webp" alt="" width={43} height={64} unoptimized className="h-16 w-auto" />
        <h1 className="text-2xl font-semibold">No encontramos esa página</h1>
        <p className="text-tinta-suave">Revisa la dirección o vuelve al inicio.</p>
        <Link
          href="/panel"
          className="flex min-h-11 items-center self-start rounded-lg bg-primario px-4 font-medium text-white hover:bg-primario-fuerte"
        >
          Ir al panel
        </Link>
      </div>
    </main>
  );
}
