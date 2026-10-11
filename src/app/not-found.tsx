import Link from 'next/link';

export const metadata = { title: 'No encontrado' };

export default function NoEncontrado() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold">No encontramos esa página</h1>
      <p className="text-stone-600">Revisa la dirección o vuelve al inicio.</p>
      <Link
        href="/panel"
        className="flex min-h-11 items-center self-start rounded-lg bg-stone-900 px-4 text-white"
      >
        Ir al panel
      </Link>
    </main>
  );
}
