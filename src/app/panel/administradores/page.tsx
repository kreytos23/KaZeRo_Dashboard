import { conDbLectura } from '@/db/client';
import { listarAdmins } from '@/server/auth/administradores';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { FormAgregarAdmin, FormRegenerarTotp } from './FormsAdmin';

const FECHA = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'medium',
  timeZone: 'America/Mexico_City',
});

export const metadata = { title: 'Administradores' };

export default async function PaginaAdministradores() {
  const { adminId } = await requerirSesion();
  const admins = await conDbLectura((db) => listarAdmins(db));
  // No es secreto: es el usuario de esta cuenta, para que el gestor de contraseñas empareje bien.
  const emailActual = admins.find((a) => a.id === adminId)?.email ?? '';
  return (
    <section className="flex max-w-3xl flex-col gap-8">
      <h1 className="text-2xl font-semibold">Administradores</h1>
      <ul className="flex flex-col gap-1 text-sm">
        {admins.map((a) => (
          <li key={a.id}>
            {a.email} · desde {FECHA.format(a.createdAt)}
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Agregar administrador</h2>
        <FormAgregarAdmin emailActual={emailActual} />
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Regenerar mi TOTP</h2>
        <FormRegenerarTotp emailActual={emailActual} />
      </div>
    </section>
  );
}
