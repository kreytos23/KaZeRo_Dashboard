'use client';

import { useEffect, useRef, useState } from 'react';
import { montoCambio } from '@/domain/auditoria';
import { Campo } from './Campo';

export type MontoVigilado = { name: string; tipo: 'pesos' | 'porcentaje' };

/**
 * Motivo del cambio (R-09). Pasa a obligatorio en cuanto un monto vigilado difiere de su valor original
 * (`defaultValue`). Es solo ayuda: el servicio y el trigger kz_auditar lo exigen de todos modos.
 */
export function CampoMotivo({ montos = [] }: { montos?: readonly MontoVigilado[] }) {
  const ancla = useRef<HTMLDivElement>(null);
  const [obligatorio, setObligatorio] = useState(false);
  // Clave estable: el arreglo llega nuevo en cada render del servidor.
  const clave = montos.map((m) => `${m.name}:${m.tipo}`).join('|');

  useEffect(() => {
    const form = ancla.current?.closest('form');
    if (!form || !clave) return;
    const vigilados = clave.split('|').map((s) => {
      const [name, tipo] = s.split(':') as [string, MontoVigilado['tipo']];
      return { name, tipo };
    });
    const revisar = () =>
      setObligatorio(
        vigilados.some(({ name, tipo }) => {
          const el = form.elements.namedItem(name);
          return el instanceof HTMLInputElement && montoCambio(tipo, el.value, el.defaultValue);
        }),
      );
    revisar();
    form.addEventListener('input', revisar);
    return () => form.removeEventListener('input', revisar);
  }, [clave]);

  return (
    <div ref={ancla} className="flex flex-col gap-1">
      <Campo
        etiqueta={obligatorio ? 'Motivo del cambio (obligatorio)' : 'Motivo del cambio (opcional)'}
        name="motivo"
        maxLength={200}
        required={obligatorio}
      />
      {obligatorio && <p className="text-sm text-tinta-suave">Cambiaste un monto: explica por qué.</p>}
    </div>
  );
}
