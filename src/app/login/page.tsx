import { FormLogin } from './FormLogin';
import { MarcoAcceso } from './MarcoAcceso';
import { avisoDeMotivo } from './motivo';

export const metadata = { title: 'Iniciar sesión' };

export default async function PaginaLogin({
  searchParams,
}: {
  searchParams: Promise<{ motivo?: string | string[] }>;
}) {
  const aviso = avisoDeMotivo((await searchParams).motivo);
  return (
    <MarcoAcceso>
      <h1 className="text-2xl font-semibold">Iniciar sesión</h1>
      {aviso && (
        <p role="alert" className="aviso-error">
          {aviso}
        </p>
      )}
      <FormLogin />
    </MarcoAcceso>
  );
}
