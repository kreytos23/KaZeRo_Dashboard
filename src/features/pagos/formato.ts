import { centavosANumeric, formatoMXN, pesosACentavos } from '@/domain/dinero';
import { fechaCorta } from '@/domain/fechas';
import { formatoFolio } from '@/domain/pedidos';
import { repartoSugerido, type PedidoReparto } from '@/domain/reparto';
import type { PagoParecido } from '@/server/pagos/duplicados';

/** Reparto sugerido (R-33) como textos de pesos para los campos; el pedido sin asignar queda vacío. */
export function montosDeReparto(montoCentavos: number, pedidos: PedidoReparto[]): Record<string, string> {
  const { aplicaciones } = repartoSugerido(Math.max(0, montoCentavos), pedidos);
  const porId = new Map(aplicaciones.map((a) => [a.pedidoId, a.montoCentavos]));
  return Object.fromEntries(
    pedidos.map((p) => {
      const c = porId.get(p.id);
      return [p.id, c ? centavosANumeric(c) : ''];
    }),
  );
}

export interface ResumenReparto {
  aplicadoCentavos: number;
  /** Lo que queda del pago sin repartir: va a saldo a favor de la vendedora. */
  sobranteCentavos: number;
  /** Cuánto se pasa lo repartido del monto del pago (0 si cabe). */
  excedeCentavos: number;
  /** Problema por pedido (texto que lo explica y cómo corregirlo). */
  errores: Record<string, string>;
}

/** Suma el reparto editado y señala, por pedido, lo que el servicio rechazaría. Se recalcula en cada tecla. */
export function resumenReparto(
  montoCentavos: number,
  montos: Record<string, string>,
  pedidos: PedidoReparto[],
): ResumenReparto {
  const errores: Record<string, string> = {};
  let aplicado = 0;
  for (const p of pedidos) {
    const t = (montos[p.id] ?? '').trim();
    if (!t) continue;
    const c = pesosACentavos(t);
    if (c === null) errores[p.id] = 'Escribe un monto válido, por ejemplo 149 o 149.50.';
    else if (c === 0) errores[p.id] = 'Deja vacío el pedido que no se paga.';
    else if (c > p.saldoCentavos)
      errores[p.id] = `Supera el saldo del pedido (${formatoMXN(p.saldoCentavos)}).`;
    else aplicado += c;
  }
  const monto = Math.max(0, montoCentavos);
  return {
    aplicadoCentavos: aplicado,
    sobranteCentavos: Math.max(0, monto - aplicado),
    excedeCentavos: Math.max(0, aplicado - monto),
    errores,
  };
}

/** La lista del error `posible_duplicado` llega como `unknown` desde la acción (la arma el servidor): basta un guard mínimo. */
export function parecidosDe(detalle: unknown): PagoParecido[] {
  return Array.isArray(detalle)
    ? detalle.filter((x): x is PagoParecido => typeof (x as PagoParecido | null)?.pagoId === 'string')
    : [];
}

export function textoParecido(p: PagoParecido): string {
  return `${formatoMXN(p.montoCentavos)} del ${fechaCorta(p.fecha)}${p.folio === null ? '' : ` (${formatoFolio(p.folio)})`}`;
}

/** P-3: aviso suave, nunca bloquea. */
export function avisoSinCaptura(metodo: string, hayCaptura: boolean): string | null {
  return metodo === 'transferencia' && !hayCaptura
    ? 'Es una transferencia y no hay captura. Puedes guardarla así y agregar la captura después.'
    : null;
}
