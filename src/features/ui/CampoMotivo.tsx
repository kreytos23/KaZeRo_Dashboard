'use client';

import { useEffect, useRef, useState } from 'react';
import { montoCambio } from '@/domain/auditoria';
import { Campo } from './Campo';

export type MontoVigilado = { name: string; tipo: 'pesos' | 'porcentaje' };
/** Un selector cuyo cambio también exige motivo; `aviso` es el texto que lo explica. */
export type ValorVigilado = { name: string; original: string; aviso: string };

/**
 * Motivo del cambio (R-09). Pasa a obligatorio en cuanto un monto vigilado difiere de su valor original
 * (`defaultValue`) o el selector vigilado deja su valor original. Es solo ayuda: el servicio y los triggers lo exigen
 * de todos modos.
 */
export function CampoMotivo({
  montos = [],
  valor,
}: {
  montos?: readonly MontoVigilado[];
  valor?: ValorVigilado;
}) {
  const ancla = useRef<HTMLDivElement>(null);
  const [aviso, setAviso] = useState('');
  const obligatorio = aviso !== '';
  // Clave estable: el arreglo llega nuevo en cada render del servidor.
  const clave = montos.map((m) => `${m.name}:${m.tipo}`).join('|');
  const { name, original, aviso: avisoValor } = valor ?? {};

  useEffect(() => {
    const form = ancla.current?.closest('form');
    if (!form || !(clave || name)) return;
    const vigilados = (clave ? clave.split('|') : []).map((s) => {
      const [name, tipo] = s.split(':') as [string, MontoVigilado['tipo']];
      return { name, tipo };
    });
    const revisar = () => {
      const monto = vigilados.some((v) => {
        const el = form.elements.namedItem(v.name);
        return el instanceof HTMLInputElement && montoCambio(v.tipo, el.value, el.defaultValue);
      });
      // El control es un <select> en celular y un <input hidden> en escritorio (Seleccion).
      const el = name ? form.elements.namedItem(name) : null;
      const cambio =
        (el instanceof HTMLSelectElement || el instanceof HTMLInputElement) && el.value !== original;
      setAviso(monto ? 'Cambiaste un monto: explica por qué.' : cambio ? (avisoValor ?? '') : '');
    };
    revisar();
    form.addEventListener('input', revisar);
    form.addEventListener('change', revisar);
    return () => {
      form.removeEventListener('input', revisar);
      form.removeEventListener('change', revisar);
    };
  }, [clave, name, original, avisoValor]);

  return (
    <div ref={ancla} className="flex flex-col gap-1">
      <Campo
        etiqueta={obligatorio ? 'Motivo del cambio (obligatorio)' : 'Motivo del cambio (opcional)'}
        name="motivo"
        maxLength={200}
        required={obligatorio}
      />
      {obligatorio && <p className="text-meta text-tinta-suave">{aviso}</p>}
    </div>
  );
}
