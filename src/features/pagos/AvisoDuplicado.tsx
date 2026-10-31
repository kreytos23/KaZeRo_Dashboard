'use client';

import Link from 'next/link';
import { useContext } from 'react';
import { CampoCasilla } from '@/features/ui/Campo';
import { EstadoDeAccion } from '@/features/ui/errores-campo';
import { parecidosDe, textoParecido } from './formato';

/**
 * P-4: si el servidor avisa de un posible duplicado, muestra los pagos parecidos (con enlace a su ficha) y la casilla
 * que hace falta marcar para guardar de todos modos. Sin aviso no ocupa lugar.
 */
export function AvisoDuplicado() {
  const estado = useContext(EstadoDeAccion);
  if (estado.codigo !== 'posible_duplicado') return null;
  const parecidos = parecidosDe(estado.detalle);
  return (
    <div className="aviso-atencion flex flex-col gap-2">
      <p className="font-semibold">Revisa antes de guardar: ya hay un pago parecido.</p>
      {parecidos.length > 0 && (
        <ul className="flex flex-col">
          {parecidos.map((p) => (
            <li key={p.pagoId}>
              <Link href={`/panel/pagos/${p.pagoId}`} className="enlace inline-flex min-h-11 items-center">
                {textoParecido(p)}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <CampoCasilla name="confirmarDuplicado" required>
        Confirmo que no es un duplicado
      </CampoCasilla>
    </div>
  );
}
