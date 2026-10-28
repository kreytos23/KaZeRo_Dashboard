import { eq } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { cliente, entregaExhibidor, exhibidor, vExhibidor } from '@/db/schema';
import { centavosANumeric, formatoMXN, numericACentavos } from '@/domain/dinero';
import { ErrorNegocio, conErroresDeNegocio } from '@/server/errores';
import { conIdempotencia } from '@/server/idempotencia';
import { validarCodigos, bloquearPiezasPorCodigo } from '@/server/pedidos/comun';
import { crearPedidoEnTx, validarFecha } from '@/server/pedidos/servicio';
import { METODOS_PAGO, registrarPagoEnTx, type MetodoPago } from '@/server/pagos/servicio';

// Plan 4a: la venta del exhibidor en un paso (E-1, E-3, E-4) y el dinero que el exhibidor entrega (E-5, E-6).
// Orden de bloqueo (D-10): cliente → exhibidor → piezas → … (pedido y pago son nuevos en la venta).

export const METODOS_ENTREGA = ['efectivo', 'transferencia', 'otro'] as const;
type MetodoEntrega = (typeof METODOS_ENTREGA)[number];

/** La única clienta de mostrador (E-3); la migración 0021 la siembra. */
export async function clienteMostradorId(tx: Ejecutor): Promise<string> {
  const [c] = await tx.select({ id: cliente.id }).from(cliente).where(eq(cliente.esMostrador, true));
  if (!c) throw new ErrorNegocio('sin_mostrador', 'Falta la clienta «Venta de mostrador». Avisa al soporte.');
  return c.id;
}

/** Exhibidor abierto, bloqueado NO KEY UPDATE (como enviar/regresar/cerrar: serializa el dinero y el cierre). */
async function bloquearExhibidorAbierto(tx: Ejecutor, exhibidorId: string) {
  const [e] = await tx
    .select({ estado: exhibidor.estado, vendedorId: exhibidor.vendedorId })
    .from(exhibidor)
    .where(eq(exhibidor.id, exhibidorId))
    .for('no key update');
  if (!e) throw new ErrorNegocio('no_encontrado', 'El exhibidor no existe.', 'exhibidorId');
  if (e.estado === 'cerrado')
    throw new ErrorNegocio('exhibidor_cerrado', 'El exhibidor está cerrado.', 'exhibidorId');
  return e;
}

async function porEntregarCentavos(tx: Ejecutor, exhibidorId: string): Promise<number> {
  const [v] = await tx
    .select({ porEntregar: vExhibidor.porEntregar })
    .from(vExhibidor)
    .where(eq(vExhibidor.id, exhibidorId));
  return numericACentavos(v!.porEntregar);
}

export interface DatosVentaExhibidor {
  key: string;
  adminId: string;
  exhibidorId: string;
  codigos: string[];
  clienteId: string | null;
  fecha?: string;
  cobradoCentavos: number;
  metodo: MetodoPago;
}

/**
 * Nota KZR de las piezas del exhibidor, a nombre de su responsable (E-1), y el cobro que el exhibidor recibió
 * (E-4), todo en una transacción. Sin clienta, la nota va a «Venta de mostrador» y no cuenta en tarjeta (E-3).
 */
export async function registrarVentaExhibidor(
  db: Ejecutor,
  d: DatosVentaExhibidor,
): Promise<{ pedidoId: string; folio: number; estado: 'abierto' | 'liquidado' }> {
  return conErroresDeNegocio(async () => {
    const codigos = validarCodigos(d.codigos);
    if (!Number.isSafeInteger(d.cobradoCentavos) || d.cobradoCentavos < 0)
      throw new ErrorNegocio('monto_invalido', 'Lo cobrado no puede ser negativo.', 'cobrado');
    // El método se valida aunque no haya cobro: el cobro del exhibidor nunca es con saldo a favor.
    if (!METODOS_PAGO.includes(d.metodo) || d.metodo === 'saldo_favor')
      throw new ErrorNegocio('metodo_invalido', 'Elige un método de cobro válido.', 'metodo');
    const fecha = d.fecha?.trim() || undefined;
    if (fecha) validarFecha(fecha);
    const payload = {
      exhibidorId: d.exhibidorId,
      codigos,
      clienteId: d.clienteId,
      fecha: fecha ?? null,
      cobradoCentavos: d.cobradoCentavos,
      metodo: d.metodo,
    };
    return db.transaction((tx) =>
      conIdempotencia(
        tx,
        { key: d.key, adminId: d.adminId, operacion: 'ventaExhibidor', payload },
        async () => {
          const mostrador = await clienteMostradorId(tx);
          const clienteId = d.clienteId ?? mostrador;
          // D-10: la clienta antes que el exhibidor (crearPedidoEnTx la vuelve a pedir: ya es nuestra).
          const [c] = await tx
            .select({ id: cliente.id })
            .from(cliente)
            .where(eq(cliente.id, clienteId))
            .for('no key update');
          if (!c) throw new ErrorNegocio('no_encontrado', 'La clienta no existe.', 'clienteId');
          const ex = await bloquearExhibidorAbierto(tx, d.exhibidorId);
          const { piezas, faltantes } = await bloquearPiezasPorCodigo(tx, codigos);
          const orden = new Map(codigos.map((x, i) => [x, i]));
          const ajenas = piezas
            .filter((p) => p.estado !== 'en_exhibidor' || p.exhibidorId !== d.exhibidorId)
            .sort((a, b) => orden.get(a.codigo)! - orden.get(b.codigo)!);
          if (faltantes.length || ajenas.length) {
            const partes = ['No se registró la venta.'];
            if (faltantes.length) partes.push(`No existen: ${faltantes.join(', ')}.`);
            if (ajenas.length)
              partes.push(`No están en este exhibidor: ${ajenas.map((p) => p.codigo).join(', ')}.`);
            throw new ErrorNegocio('piezas_ajenas', partes.join(' '), 'codigos');
          }
          const p = await crearPedidoEnTx(tx, {
            adminId: d.adminId,
            clienteId,
            vendedorId: ex.vendedorId,
            fecha,
            codigos,
            cuentaTarjeta: clienteId !== mostrador,
            descuentoManualCentavos: 0,
          });
          let estado = p.estado;
          if (d.cobradoCentavos > 0) {
            if (d.cobradoCentavos > numericACentavos(p.total))
              throw new ErrorNegocio(
                'pago_excede',
                `Lo cobrado (${formatoMXN(d.cobradoCentavos)}) supera el total de la nota (${formatoMXN(numericACentavos(p.total))}).`,
                'cobrado',
              );
            estado = (
              await registrarPagoEnTx(tx, {
                adminId: d.adminId,
                pedidoId: p.id,
                fecha,
                montoCentavos: d.cobradoCentavos,
                metodo: d.metodo,
                pagador: 'cliente',
                exhibidorId: d.exhibidorId,
              })
            ).estado;
          }
          return { pedidoId: p.id, folio: p.folio, estado };
        },
      ),
    );
  });
}

/** Inserta una entrega o ajuste bajo el bloqueo del exhibidor y devuelve lo que queda por entregar. */
async function registrarMovimiento(
  db: Ejecutor,
  o: {
    key: string;
    adminId: string;
    exhibidorId: string;
    operacion: 'entregaExhibidor' | 'ajusteExhibidor';
    payload: object;
    tipo: 'entrega' | 'ajuste';
    montoCentavos: number; // con signo en los ajustes
    fecha: string | undefined;
    metodo: MetodoEntrega | null;
    nota: string | null;
  },
): Promise<{ porEntregar: string }> {
  return conErroresDeNegocio(() =>
    db.transaction((tx) =>
      conIdempotencia(
        tx,
        { key: o.key, adminId: o.adminId, operacion: o.operacion, payload: o.payload },
        async () => {
          await bloquearExhibidorAbierto(tx, o.exhibidorId);
          const fecha = validarFecha(o.fecha);
          const actual = await porEntregarCentavos(tx, o.exhibidorId);
          const resta = o.tipo === 'entrega' ? o.montoCentavos : -o.montoCentavos;
          if (resta > actual)
            throw new ErrorNegocio(
              'excede',
              `El exhibidor tiene ${formatoMXN(actual)} por entregar; no puedes registrar ${formatoMXN(resta)}.`,
              'monto',
            );
          const abs = centavosANumeric(Math.abs(o.montoCentavos));
          await tx.insert(entregaExhibidor).values({
            exhibidorId: o.exhibidorId,
            tipo: o.tipo,
            monto: o.montoCentavos < 0 ? `-${abs}` : abs,
            fecha,
            metodo: o.metodo,
            nota: o.nota,
            adminId: o.adminId,
          });
          return { porEntregar: centavosANumeric(actual - resta) };
        },
      ),
    ),
  );
}

const textoOpcional = (t: string | undefined, max: number, campo: string, mensaje: string) => {
  const v = t?.trim() || null;
  if (v && v.length > max) throw new ErrorNegocio(`${campo}_invalida`, mensaje, campo);
  return v;
};

export async function registrarEntregaExhibidor(
  db: Ejecutor,
  d: {
    key: string;
    adminId: string;
    exhibidorId: string;
    montoCentavos: number;
    fecha?: string;
    metodo: MetodoEntrega;
    nota?: string;
  },
): Promise<{ porEntregar: string }> {
  return conErroresDeNegocio(async () => {
    if (!Number.isSafeInteger(d.montoCentavos) || d.montoCentavos <= 0)
      throw new ErrorNegocio('monto_invalido', 'El monto debe ser mayor que cero.', 'monto');
    if (!METODOS_ENTREGA.includes(d.metodo))
      throw new ErrorNegocio('metodo_invalido', 'Elige un método de entrega válido.', 'metodo');
    const fecha = d.fecha?.trim() || undefined;
    if (fecha) validarFecha(fecha);
    const nota = textoOpcional(d.nota, 200, 'nota', 'La nota admite hasta 200 caracteres.');
    return registrarMovimiento(db, {
      key: d.key,
      adminId: d.adminId,
      exhibidorId: d.exhibidorId,
      operacion: 'entregaExhibidor',
      payload: {
        exhibidorId: d.exhibidorId,
        montoCentavos: d.montoCentavos,
        fecha: fecha ?? null,
        metodo: d.metodo,
        nota,
      },
      tipo: 'entrega',
      montoCentavos: d.montoCentavos,
      fecha,
      metodo: d.metodo,
      nota,
    });
  });
}

/** Ajuste con signo (E-5, E-6): corrige el por entregar; el motivo es obligatorio. */
export async function registrarAjusteExhibidor(
  db: Ejecutor,
  d: {
    key: string;
    adminId: string;
    exhibidorId: string;
    montoCentavos: number;
    motivo: string;
    fecha?: string;
  },
): Promise<{ porEntregar: string }> {
  return conErroresDeNegocio(async () => {
    if (!Number.isSafeInteger(d.montoCentavos) || d.montoCentavos === 0)
      throw new ErrorNegocio('monto_invalido', 'El ajuste no puede ser cero.', 'monto');
    const motivo = (d.motivo ?? '').trim();
    if (!motivo || motivo.length > 200)
      throw new ErrorNegocio(
        'motivo_invalido',
        'Escribe el motivo del ajuste (hasta 200 caracteres).',
        'motivo',
      );
    const fecha = d.fecha?.trim() || undefined;
    if (fecha) validarFecha(fecha);
    return registrarMovimiento(db, {
      key: d.key,
      adminId: d.adminId,
      exhibidorId: d.exhibidorId,
      operacion: 'ajusteExhibidor',
      payload: { exhibidorId: d.exhibidorId, montoCentavos: d.montoCentavos, fecha: fecha ?? null, motivo },
      tipo: 'ajuste',
      montoCentavos: d.montoCentavos,
      fecha,
      metodo: null,
      nota: motivo,
    });
  });
}
