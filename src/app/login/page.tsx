import { FormLogin } from './FormLogin';
import { avisoDeMotivo } from './motivo';

export const metadata = { title: 'Iniciar sesión' };

export default async function PaginaLogin({
  searchParams,
}: {
  searchParams: Promise<{ motivo?: string | string[] }>;
}) {
  const aviso = avisoDeMotivo((await searchParams).motivo);
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold">Iniciar sesión</h1>
      {aviso && (
        <p role="alert" className="text-sm text-red-700">
          {aviso}
        </p>
      )}
      <FormLogin />
    </main>
  );
}
