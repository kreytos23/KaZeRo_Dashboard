'use client';

import { startTransition, useActionState, useState } from 'react';
import { Campo } from '@/features/ui/Campo';
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
    <div className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
      <h3 className="text-lg font-semibold">Escanea este código</h3>
      <p className="text-sm">Cuenta: {e.email}. Agrégala en la app autenticadora.</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL generada en el servidor, no hay nada que optimizar */}
      <img src={e.qr} alt="Código QR para la app autenticadora" width={220} height={220} />
      <p className="text-sm">
        Clave manual: <code className="break-all">{e.secreto}</code>
      </p>
      <p className="text-sm font-medium">
        Códigos de recuperación (guárdalos fuera de la computadora; cada uno sirve una sola vez):
      </p>
      <ol aria-label="Códigos de recuperación" className="grid grid-cols-2 gap-1 font-mono text-sm">
        {e.codigos.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <p role="status" className="text-sm font-semibold">
        Guárdalos ahora; no se volverán a mostrar.
      </p>
      <p className="text-sm">{nota}</p>
      <button
        type="button"
        onClick={onOcultar}
        className="min-h-11 self-start rounded-lg border border-stone-900 px-4 font-medium"
      >
        Ya los guardé, ocultar
      </button>
    </div>
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
  return { estado, pendiente, onSubmit };
}

function Alta({ onOcultar }: { onOcultar: () => void }) {
  const { estado, pendiente, onSubmit } = useAccion(accionAgregarAdmin);
  if (estado.enrolamiento)
    return (
      <Enrolamiento
        e={estado.enrolamiento}
        nota="Entrégale estos datos a la persona nueva por un canal seguro."
        onOcultar={onOcultar}
      />
    );
  return (
    <form onSubmit={onSubmit} aria-busy={pendiente} className="flex max-w-md flex-col gap-3">
      <Campo
        etiqueta="Correo del nuevo administrador"
        name="email"
        type="email"
        autoComplete="off"
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
      <Campo
        etiqueta="Tu contraseña actual"
        name="passwordActual"
        type="password"
        autoComplete="current-password"
        required
      />
      {estado.error && (
        <p role="alert" className="text-sm text-red-700">
          {estado.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pendiente}
        className="min-h-11 self-start rounded-lg bg-stone-900 px-4 font-medium text-white disabled:opacity-60"
      >
        Agregar administrador
      </button>
    </form>
  );
}

function Regenerar({ onOcultar }: { onOcultar: () => void }) {
  const { estado, pendiente, onSubmit } = useAccion(accionRegenerarTotp);
  if (estado.enrolamiento)
    return (
      <Enrolamiento
        e={estado.enrolamiento}
        nota="Tus códigos y TOTP anteriores ya no sirven y se cerraron tus demás sesiones."
        onOcultar={onOcultar}
      />
    );
  return (
    <form onSubmit={onSubmit} aria-busy={pendiente} className="flex max-w-md flex-col gap-3">
      <p className="text-sm text-stone-600">
        Úsalo si perdiste el teléfono. Tu TOTP y códigos actuales dejan de servir y se cierran tus demás
        sesiones.
      </p>
      <Campo
        etiqueta="Tu contraseña actual"
        name="passwordActual"
        type="password"
        autoComplete="current-password"
        required
      />
      {estado.error && (
        <p role="alert" className="text-sm text-red-700">
          {estado.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pendiente}
        className="min-h-11 self-start rounded-lg border border-stone-900 px-4 font-medium disabled:opacity-60"
      >
        Regenerar mi TOTP
      </button>
    </form>
  );
}

/** Al ocultar se cambia la `key`: el estado con el secreto se descarta por completo. */
export function FormAgregarAdmin() {
  const [n, setN] = useState(0);
  return <Alta key={n} onOcultar={() => setN((x) => x + 1)} />;
}

export function FormRegenerarTotp() {
  const [n, setN] = useState(0);
  return <Regenerar key={n} onOcultar={() => setN((x) => x + 1)} />;
}
