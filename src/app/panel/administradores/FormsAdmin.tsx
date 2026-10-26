'use client';

import { startTransition, useActionState, useState } from 'react';
import { Campo } from '@/features/ui/Campo';
import { useHidratado } from '@/features/ui/hidratado';
import { accionAgregarAdmin, accionRegenerarTotp } from './acciones';
import type { EstadoEnrolamiento } from './tipos';

type Accion = (prev: EstadoEnrolamiento, fd: FormData) => Promise<EstadoEnrolamiento>;

function Enrolamiento({
  e,
  nota,
  onOcultar,
}: {
  e: NonNullable<EstadoEnrolamiento['enrolamiento']>;
  nota: string;
  onOcultar: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-aviso-borde bg-aviso-fondo p-4">
      <h3 className="text-lg font-semibold">Escanea este código</h3>
      <p className="text-meta">Cuenta: {e.email}. Agrégala en la app autenticadora.</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL generada en el servidor, no hay nada que optimizar */}
      <img src={e.qr} alt="Código QR para la app autenticadora" width={220} height={220} />
      <p className="text-meta">
        Clave manual: <code className="break-all">{e.secreto}</code>
      </p>
      <p className="text-meta font-medium">
        Códigos de recuperación (guárdalos fuera de la computadora; cada uno sirve una sola vez):
      </p>
      <ol aria-label="Códigos de recuperación" className="grid grid-cols-2 gap-1 font-mono text-meta">
        {e.codigos.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <p role="status" className="text-meta font-semibold">
        Guárdalos ahora; no se volverán a mostrar.
      </p>
      <p className="text-meta">{nota}</p>
      <button
        type="button"
        onClick={onOcultar}
        className="min-h-11 self-start rounded-lg border border-secundario bg-white px-4 font-medium text-secundario hover:bg-secundario-suave"
      >
        Ya los guardé, ocultar
      </button>
    </div>
  );
}

/**
 * Campo de usuario oculto para el gestor de contraseñas: la "contraseña actual" es la de ESTA cuenta, así que
 * Chrome debe emparejarla con el correo del administrador en sesión y no con otro campo del formulario.
 * El servidor lo ignora (la identidad sale de la sesión).
 */
function UsuarioActual({ email }: { email: string }) {
  return (
    <input
      type="text"
      name="usuarioActual"
      autoComplete="username"
      value={email}
      readOnly
      hidden
      aria-hidden
    />
  );
}

/** Despacha con onSubmit para conservar el control; las contraseñas siempre se vacían tras enviar. */
function useAccion(accion: Accion) {
  const [estado, despachar, pendiente] = useActionState(accion, {});
  const onSubmit = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (pendiente) return;
    const form = ev.currentTarget;
    const datos = new FormData(form);
    startTransition(() => despachar(datos));
    for (const i of form.querySelectorAll<HTMLInputElement>('input[type="password"]')) i.value = '';
  };
  const hidratado = useHidratado();
  return { estado, pendiente: pendiente || !hidratado, hidratado, onSubmit };
}

function Alta({ onOcultar, emailActual }: { onOcultar: () => void; emailActual: string }) {
  const { estado, pendiente, hidratado, onSubmit } = useAccion(accionAgregarAdmin);
  if (estado.enrolamiento)
    return (
      <Enrolamiento
        e={estado.enrolamiento}
        nota="Entrégale estos datos a la persona nueva por un canal seguro."
        onOcultar={onOcultar}
      />
    );
  return (
    <form
      method="post"
      data-hidratado={hidratado ? 'si' : 'no'}
      onSubmit={onSubmit}
      aria-busy={pendiente}
      className="flex max-w-md flex-col gap-3"
    >
      {/* Primero la credencial de esta cuenta (con su usuario oculto); después, la del administrador nuevo. */}
      <UsuarioActual email={emailActual} />
      <Campo
        etiqueta="Tu contraseña actual"
        name="passwordActual"
        type="password"
        autoComplete="current-password"
        required
      />
      <Campo
        etiqueta="Correo del nuevo administrador"
        name="correoNuevo"
        type="email"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        required
        maxLength={200}
      />
      <Campo
        etiqueta="Contraseña nueva"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={12}
      />
      <Campo
        etiqueta="Confirmar contraseña"
        name="confirmacion"
        type="password"
        autoComplete="new-password"
        required
        minLength={12}
      />
      {estado.error && (
        <p role="alert" className="aviso-error">
          {estado.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pendiente}
        className="min-h-11 self-start rounded-lg bg-primario px-4 font-medium text-white enabled:hover:bg-primario-fuerte disabled:opacity-60"
      >
        Agregar administrador
      </button>
    </form>
  );
}

function Regenerar({ onOcultar, emailActual }: { onOcultar: () => void; emailActual: string }) {
  const { estado, pendiente, hidratado, onSubmit } = useAccion(accionRegenerarTotp);
  if (estado.enrolamiento)
    return (
      <Enrolamiento
        e={estado.enrolamiento}
        nota="Tus códigos y TOTP anteriores ya no sirven y se cerraron tus demás sesiones."
        onOcultar={onOcultar}
      />
    );
  return (
    <form
      method="post"
      data-hidratado={hidratado ? 'si' : 'no'}
      onSubmit={onSubmit}
      aria-busy={pendiente}
      className="flex max-w-md flex-col gap-3"
    >
      <p className="text-meta text-tinta-suave">
        Úsalo si perdiste el teléfono. Tu TOTP y códigos actuales dejan de servir y se cierran tus demás
        sesiones.
      </p>
      <UsuarioActual email={emailActual} />
      <Campo
        etiqueta="Tu contraseña actual"
        name="passwordActual"
        type="password"
        autoComplete="current-password"
        required
      />
      {estado.error && (
        <p role="alert" className="aviso-error">
          {estado.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pendiente}
        className="min-h-11 self-start rounded-lg border border-secundario bg-white px-4 font-medium text-secundario hover:bg-secundario-suave disabled:opacity-60"
      >
        Regenerar mi TOTP
      </button>
    </form>
  );
}

/** Al ocultar se cambia la `key`: el estado con el secreto se descarta por completo. */
export function FormAgregarAdmin({ emailActual }: { emailActual: string }) {
  const [n, setN] = useState(0);
  return <Alta key={n} emailActual={emailActual} onOcultar={() => setN((x) => x + 1)} />;
}

export function FormRegenerarTotp({ emailActual }: { emailActual: string }) {
  const [n, setN] = useState(0);
  return <Regenerar key={n} emailActual={emailActual} onOcultar={() => setN((x) => x + 1)} />;
}
