import { z } from 'zod';
import { MAX_PIEZAS_PEDIDO } from '@/domain/pedidos';

const esquema = z.object({
  cliente: z.uuid().optional(),
  codigos: z.string().max(2000).optional(),
  tarjeta: z.enum(['0', '1']).optional(),
});

/** Los parámetros son entrada del usuario: lo inválido devuelve null (la ruta responde 400). */
export function leerConsultaPrevia(
  sp: URLSearchParams,
): { clienteId: string | null; codigos: string[]; cuentaTarjeta: boolean } | null {
  const r = esquema.safeParse(Object.fromEntries(sp));
  if (!r.success) return null;
  const codigos = (r.data.codigos ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  if (codigos.length > MAX_PIEZAS_PEDIDO) return null;
  return { clienteId: r.data.cliente ?? null, codigos, cuentaTarjeta: r.data.tarjeta === '1' };
}

export function urlConsultaPrevia(o: {
  clienteId: string | null;
  codigos: string[];
  cuentaTarjeta: boolean;
}): string {
  const qs = new URLSearchParams();
  if (o.clienteId) qs.set('cliente', o.clienteId);
  if (o.codigos.length) qs.set('codigos', o.codigos.join(','));
  qs.set('tarjeta', o.cuentaTarjeta ? '1' : '0');
  return `/api/pedidos/previa?${qs}`;
}
