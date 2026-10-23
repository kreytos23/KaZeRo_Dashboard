import { esCodigoValido } from '../../src/domain/codigos';
import { hashPlan, uuidDeterminista } from './ids';
import { fechaDeCelda, llaveNombre } from './normalizar';
import { crearOrigen } from './origen';
import { planPedidos } from './plan-pedidos';
import { planPersonas } from './plan-personas';
import { planCatalogosYPiezas } from './plan-piezas';
import { asignarTarjeta, type CeldaHoja, type PedidoTarjeta } from './plan-tarjeta';
import {
  nuevoContexto,
  type Celda,
  type Conciliacion,
  type EstadoPiezaPlan,
  type Libro,
  type Mapeo,
  type PedidoPlan,
  type PlanImportacion,
} from './tipos';

export const NOTA_POSICION = 'Posición de tarjeta migrada sin venta identificada (Excel)';
const ESTADOS: EstadoPiezaPlan[] = [
  'disponible',
  'en_exhibidor',
  'apartada',
  'vendida',
  'regalo',
  'defecto',
  'guardada',
];

function celdaHoja(c: Celda): CeldaHoja {
  if (c == null) return null;
  if (c instanceof Date) return { fecha: fechaDeCelda(c, '2100-01-01') };
  if (typeof c === 'string' && llaveNombre(c) === 'tbd') return { fecha: null, tbd: true };
  return { fecha: null };
}

/**
 * Planificación completa y pura: personas → catálogos y piezas → pedidos y pagos → tarjeta → conciliación.
 * Lanza si el plan rompe una regla de la BD (es un bug del plan, no un dato del cliente).
 */
export function planificar(l: Libro, m: Mapeo): { plan: PlanImportacion; hash: string } {
  const ctx = nuevoContexto();
  const personas = planPersonas(l, m, ctx);
  const cat = planCatalogosYPiezas(l, m, ctx);
  const ped = planPedidos(l, m, ctx, personas, cat);
  const casa = personas.vendedores.find((v) => v.tipo === 'casa')!;
  const pedidos: PedidoPlan[] = ped.pedidos;
  const clientePorId = new Map(personas.clientes.map((c) => [c.id, c]));

  // --- Tarjeta de lealtad por cliente (D-12)
  const filasHoja = new Map<string, { celdas: CeldaHoja[]; fila: number }[]>();
  for (const f of l.lealtad) {
    const cid = personas.filaClienteLealtad.get(f.fila);
    if (!cid) continue;
    filasHoja.set(cid, [...(filasHoja.get(cid) ?? []), { celdas: f.celdas.map(celdaHoja), fila: f.fila }]);
  }
  const candidatos = new Map<string, PedidoPlan[]>();
  for (const p of pedidos)
    if (ped.elegibles.has(p.id)) candidatos.set(p.clienteId, [...(candidatos.get(p.clienteId) ?? []), p]);
  const porPedido = new Map(pedidos.map((p) => [p.id, p]));
  const marcadores: PedidoPlan[] = [];
  for (const cid of [...new Set([...filasHoja.keys(), ...candidatos.keys()])].sort()) {
    const cliente = clientePorId.get(cid)!;
    const propios = candidatos.get(cid) ?? [];
    const hoja = filasHoja.get(cid) ?? [];
    const r = asignarTarjeta({
      pedidos: propios.map((p): PedidoTarjeta => ({
        id: p.id,
        fecha: p.fecha,
        estado: p.estado,
        tipo: p.tipo === 'kzr' ? 'kzr' : 'historico',
      })),
      filasHoja: hoja.map((h) => h.celdas),
      evidencia: ped.evidencia,
      fechaRespaldo: m.fechaCorte,
    });
    for (const [id, pos] of r.asignados) {
      const p = porPedido.get(id)!;
      p.cuentaTarjeta = true;
      p.ciclo = pos.ciclo;
      p.posicion = pos.posicion;
    }
    for (const id of r.sinTarjeta) porPedido.get(id)!.cuentaTarjeta = false;
    for (const mk of r.marcadores) {
      const clave = `tarjeta:${cliente.llave}:${mk.ciclo}:${mk.posicion}`;
      marcadores.push({
        id: uuidDeterminista(m.lote, clave),
        folio: 0,
        folioOriginal: null,
        clienteId: cid,
        vendedorId: cliente.vendedorHabitualId ?? casa.id,
        fecha: mk.fecha,
        estado: 'liquidado',
        cuentaTarjeta: true,
        ciclo: mk.ciclo,
        posicion: mk.posicion,
        descuentoManual: 0,
        descuentoManualMotivo: null,
        total: 0,
        notas: NOTA_POSICION,
        liquidadoEn: `${mk.fecha}T12:00:00-06:00`,
        items: [],
        tipo: 'posicion',
        origen: crearOrigen(
          clave,
          'Tarjeta de Lealtad',
          hoja.map((h) => h.fila),
          { ciclo: mk.ciclo, posicion: mk.posicion },
        ),
      });
    }
    for (const codigo of new Set(r.avisos))
      ctx.avisos.push({
        hoja: 'Tarjeta de Lealtad',
        fila: hoja[0]?.fila ?? null,
        clave: `tarjeta:${cliente.llave}`,
        tipo: codigo,
        detalle: `${r.avisos.filter((a) => a === codigo).length} caso(s) en la tarjeta de este cliente.`,
      });
  }
  // Folios de los marcadores: a continuación de los históricos, en orden (fecha, clave).
  let siguiente = Math.max(
    m.folioHistoricoDesde - 1,
    ...pedidos.filter((p) => p.folioOriginal === null).map((p) => p.folio),
  );
  marcadores.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.origen.clave.localeCompare(b.origen.clave));
  for (const mk of marcadores) mk.folio = ++siguiente;
  const todos = [...pedidos, ...marcadores];

  // --- Exhibidores: solo los que quedaron con alguna pieza
  const usados = new Set(ped.piezas.map((p) => p.exhibidorId).filter((x): x is string => !!x));
  const exhibidores = cat.exhibidores.filter((e) => usados.has(e.id));

  const plan: PlanImportacion = {
    lote: m.lote,
    archivos: l.archivos,
    categorias: cat.categorias,
    materiales: cat.materiales,
    proveedores: cat.proveedores,
    vendedores: personas.vendedores,
    clientes: personas.clientes,
    exhibidores,
    piezas: ped.piezas,
    pedidos: todos,
    pagos: ped.pagos,
    conciliacion: undefined as unknown as Conciliacion,
    rechazos: ctx.rechazos,
    avisos: ctx.avisos,
    candidatasFusion: personas.candidatasFusion,
  };
  plan.conciliacion = conciliar(plan);
  validarInvariantes(plan);
  return { plan, hash: hashPlan(plan) };
}

function conciliar(plan: PlanImportacion): Conciliacion {
  const pagadoPorPedido = new Map<string, number>();
  for (const p of plan.pagos)
    pagadoPorPedido.set(p.pedidoId, (pagadoPorPedido.get(p.pedidoId) ?? 0) + p.monto);
  const meses = new Map<string, { pedidos: number; total: number; pagado: number }>();
  const saldos = new Map<string, number>();
  for (const p of plan.pedidos) {
    const pagado = pagadoPorPedido.get(p.id) ?? 0;
    const mes = p.fecha.slice(0, 7);
    const x = meses.get(mes) ?? { pedidos: 0, total: 0, pagado: 0 };
    meses.set(mes, { pedidos: x.pedidos + 1, total: x.total + p.total, pagado: x.pagado + pagado });
    if (p.total > pagado) saldos.set(p.clienteId, (saldos.get(p.clienteId) ?? 0) + p.total - pagado);
  }
  const piezasPorEstado = Object.fromEntries(ESTADOS.map((e) => [e, 0])) as Record<EstadoPiezaPlan, number>;
  const porExhibidor = new Map<string, number>();
  for (const p of plan.piezas) {
    piezasPorEstado[p.estado]++;
    if (p.exhibidorId) porExhibidor.set(p.exhibidorId, (porExhibidor.get(p.exhibidorId) ?? 0) + 1);
  }
  const saldoPorCliente = [...saldos]
    .map(([clienteId, saldo]) => ({ clienteId, saldo }))
    .sort((a, b) => b.saldo - a.saldo || a.clienteId.localeCompare(b.clienteId));
  return {
    conteos: {
      categorias: plan.categorias.length,
      materiales: plan.materiales.length,
      proveedores: plan.proveedores.length,
      vendedores: plan.vendedores.length,
      clientes: plan.clientes.length,
      exhibidores: plan.exhibidores.length,
      piezas: plan.piezas.length,
      pedidos: plan.pedidos.length,
      items: plan.pedidos.reduce((a, p) => a + p.items.length, 0),
      pagos: plan.pagos.length,
    },
    piezasPorEstado,
    porMes: [...meses]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([mes, x]) => ({ mes, ...x, saldo: x.total - x.pagado })),
    saldoTotal: saldoPorCliente.reduce((a, x) => a + x.saldo, 0),
    saldoPorCliente,
    tarjeta: plan.pedidos
      .filter((p) => p.cuentaTarjeta)
      .map((p) => ({
        clienteId: p.clienteId,
        ciclo: p.ciclo!,
        posicion: p.posicion!,
        estado: p.estado,
        folio: p.folio,
      }))
      .sort((a, b) => a.clienteId.localeCompare(b.clienteId) || a.ciclo - b.ciclo || a.posicion - b.posicion),
    exhibidores: [...porExhibidor]
      .map(([exhibidorId, piezas]) => ({ exhibidorId, piezas }))
      .sort((a, b) => a.exhibidorId.localeCompare(b.exhibidorId)),
  };
}

/** M-47: las mismas reglas que impone la BD. Lanza con la lista de violaciones (sin datos del cliente). */
export function validarInvariantes(plan: PlanImportacion): void {
  const errores: string[] = [];
  const falla = (t: string) => errores.length < 30 && errores.push(t);
  const existe = (conjunto: { id: string }[]) => new Set(conjunto.map((x) => x.id));
  const clientes = existe(plan.clientes);
  const vendedores = existe(plan.vendedores);
  const categorias = existe(plan.categorias);
  const materiales = existe(plan.materiales);
  const proveedores = existe(plan.proveedores);
  const exhibidores = existe(plan.exhibidores);
  const pedidos = new Map(plan.pedidos.map((p) => [p.id, p]));
  for (const [nombre, xs] of Object.entries({
    categorias: plan.categorias,
    materiales: plan.materiales,
    proveedores: plan.proveedores,
    vendedores: plan.vendedores,
    clientes: plan.clientes,
    exhibidores: plan.exhibidores,
    piezas: plan.piezas,
    pedidos: plan.pedidos,
    pagos: plan.pagos,
  }))
    if (new Set(xs.map((x) => x.id)).size !== xs.length) falla(`${nombre}: id repetido`);

  for (const c of plan.clientes) {
    if (c.nombre.trim().length < 1 || c.nombre.length > 120) falla('cliente: nombre fuera de 1..120');
    if (c.notas.length > 2000) falla('cliente: notas de más de 2000');
  }
  const llavesVend = new Set<string>();
  for (const v of plan.vendedores) {
    if (llavesVend.has(v.llave)) falla('vendedor: nombre repetido');
    llavesVend.add(v.llave);
    if (!/^\d{1,3}\.\d{2}$/.test(v.comisionPct) || Number(v.comisionPct) > 100)
      falla('vendedor: comisión fuera de 0..100');
  }
  for (const e of plan.exhibidores) {
    if (!vendedores.has(e.vendedorId)) falla('exhibidor: vendedor inexistente');
    if (e.nombre.length < 1 || e.nombre.length > 120) falla('exhibidor: nombre fuera de 1..120');
  }

  const codigos = new Set<string>();
  const pedidoDePieza = new Map<string, string>();
  for (const p of plan.pedidos)
    for (const i of p.items) {
      if (pedidoDePieza.has(i.piezaId)) falla('R-05: una pieza en más de un pedido');
      pedidoDePieza.set(i.piezaId, p.id);
    }
  for (const p of plan.piezas) {
    if (!esCodigoValido(p.codigo)) falla('pieza: código inválido');
    if (codigos.has(p.codigo)) falla('pieza: código repetido');
    codigos.add(p.codigo);
    if (!categorias.has(p.categoriaId)) falla('pieza: categoría inexistente');
    if (p.materialId && !materiales.has(p.materialId)) falla('pieza: material inexistente');
    if (p.proveedorId && !proveedores.has(p.proveedorId)) falla('pieza: proveedor inexistente');
    if (p.descripcion.length < 1 || p.descripcion.length > 300) falla('pieza: descripción fuera de 1..300');
    if (!Number.isSafeInteger(p.costo) || p.costo < 0 || !Number.isSafeInteger(p.precio) || p.precio < 0)
      falla('pieza: montos inválidos');
    if (p.notaMovimiento.length > 200) falla('pieza: nota de movimiento de más de 200');
    if (p.fechaMovimiento < p.fechaAlta) falla('pieza: movimiento anterior al alta');
    if (p.estado === 'en_exhibidor' && !p.exhibidorId) falla('pieza: en_exhibidor sin exhibidor');
    if (p.estado !== 'en_exhibidor' && p.estado !== 'apartada' && p.exhibidorId)
      falla('pieza: exhibidor en un estado que no lo admite');
    if (p.exhibidorId && !exhibidores.has(p.exhibidorId)) falla('pieza: exhibidor inexistente');
    const ped = p.pedidoId ? pedidos.get(p.pedidoId) : undefined;
    if (p.pedidoId && !ped) falla('pieza: pedido inexistente');
    if (p.pedidoId !== (pedidoDePieza.get(p.id) ?? null))
      falla('pieza: pedidoId no coincide con el pedido que la contiene');
    if (p.estado === 'vendida' && ped?.estado !== 'liquidado') falla('pieza: vendida sin pedido liquidado');
    if (p.estado === 'apartada' && ped?.estado !== 'abierto') falla('pieza: apartada sin pedido abierto');
    if (!['vendida', 'apartada'].includes(p.estado) && p.pedidoId)
      falla('pieza: pedido en un estado que no lo admite');
  }

  const pagadoPor = new Map<string, number>();
  const llaves = new Set<string>();
  for (const g of plan.pagos) {
    if (!Number.isSafeInteger(g.monto) || g.monto <= 0) falla('pago: monto no positivo');
    if ([g.pagadorClienteId, g.pagadorVendedorId].filter(Boolean).length !== 1)
      falla('pago: debe tener un solo pagador');
    if (g.nota.length > 200) falla('pago: nota de más de 200');
    if (llaves.has(g.idempotencyKey)) falla('pago: idempotencyKey repetida');
    llaves.add(g.idempotencyKey);
    if (!pedidos.has(g.pedidoId)) falla('pago: pedido inexistente');
    pagadoPor.set(g.pedidoId, (pagadoPor.get(g.pedidoId) ?? 0) + g.monto);
  }

  const folios = new Set<number>();
  const posiciones = new Set<string>();
  for (const p of plan.pedidos) {
    if (!Number.isSafeInteger(p.folio) || p.folio <= 0) falla('pedido: folio no positivo');
    if (folios.has(p.folio)) falla('pedido: folio repetido');
    folios.add(p.folio);
    if (!clientes.has(p.clienteId)) falla('pedido: cliente inexistente');
    if (!vendedores.has(p.vendedorId)) falla('pedido: vendedor inexistente');
    const subtotal = p.items.reduce((a, i) => a + i.precioLista, 0);
    if (p.total !== subtotal - p.descuentoManual || p.total < 0)
      falla('pedido: total ≠ Σ precios − descuento manual (o negativo)');
    if (p.items.some((i) => i.precioFinal !== i.precioLista || i.precioLista < 0))
      falla('pedido: precio final distinto del precio de lista');
    const pagado = pagadoPor.get(p.id) ?? 0;
    if (pagado > p.total) falla('pedido: pagos mayores al total');
    if ((p.estado === 'liquidado') !== (pagado === p.total))
      falla('pedido: liquidado no equivale a pagado = total');
    if ((p.estado === 'liquidado') !== (p.liquidadoEn !== null))
      falla('pedido: liquidadoEn solo en liquidados');
    if (p.descuentoManual > 0 !== (p.descuentoManualMotivo !== null))
      falla('pedido: descuento manual y motivo no coinciden');
    if (
      p.descuentoManualMotivo !== null &&
      (p.descuentoManualMotivo.trim().length < 1 || p.descuentoManualMotivo.length > 200)
    )
      falla('pedido: motivo del descuento fuera de 1..200');
    if (p.notas.length > 500) falla('pedido: notas de más de 500');
    if (p.cuentaTarjeta) {
      if (p.ciclo === null || p.posicion === null || p.ciclo < 1 || p.posicion < 1 || p.posicion > 10)
        falla('pedido: tarjeta con ciclo o posición inválidos');
      const k = `${p.clienteId}:${p.ciclo}:${p.posicion}`;
      if (posiciones.has(k)) falla('pedido: dos pedidos en la misma posición de tarjeta');
      posiciones.add(k);
    } else if (p.ciclo !== null || p.posicion !== null)
      falla('pedido: sin tarjeta pero con ciclo o posición');
    if (p.tipo === 'posicion' && (p.items.length || p.total))
      falla('pedido: la posición migrada debe ir vacía y en 0');
    if (!p.items.length && p.tipo !== 'posicion') falla('pedido: sin líneas');
  }
  if (errores.length) throw new Error(`El plan rompe invariantes de la BD:\n- ${errores.join('\n- ')}`);
}
