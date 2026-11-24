import { z } from 'zod';
import { parsearFechaISO } from '@/domain/fechas';
import { MAX_PIEZAS_PEDIDO } from '@/domain/pedidos';

const esquema = z.object({
  cliente: z.uuid().optional(),
  codigos: z.string().max(2000).optional(),
  tarjeta: z.enum(['0', '1']).optional(),
  // L-7: la fecha de la nota decide si la tarjeta venció. Debe ser una fecha real; sin ella, el servidor usa hoy.
  fecha: z
    .string()
    .refine((f) => parsearFechaISO(f) === f)
    .optional(),
});

export interface ConsultaPrevia {
  clienteId: string | null;
  codigos: string[];
  cuentaTarjeta: boolean;
  fecha: string | null;
}

/** Los parámetros son entrada del usuario: lo inválido devuelve null (la ruta responde 400). */
export function leerConsultaPrevia(sp: URLSearchParams): ConsultaPrevia | null {
  const r = esquema.safeParse(Object.fromEntries(sp));
  if (!r.success) return null;
  const codigos = (r.data.codigos ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  if (codigos.length > MAX_PIEZAS_PEDIDO) return null;
  return {
    clienteId: r.data.cliente ?? null,
    codigos,
    cuentaTarjeta: r.data.tarjeta === '1',
    fecha: r.data.fecha ?? null,
  };
}

export function urlConsultaPrevia(o: {
  clienteId: string | null;
  codigos: string[];
  cuentaTarjeta: boolean;
  /** La fecha del formulario; vacía o incompleta no se manda. */
  fecha?: string | null;
}): string {
  const qs = new URLSearchParams();
  if (o.clienteId) qs.set('cliente', o.clienteId);
  if (o.codigos.length) qs.set('codigos', o.codigos.join(','));
  qs.set('tarjeta', o.cuentaTarjeta ? '1' : '0');
  if (o.fecha && parsearFechaISO(o.fecha) === o.fecha) qs.set('fecha', o.fecha);
  return `/api/pedidos/previa?${qs}`;
}
