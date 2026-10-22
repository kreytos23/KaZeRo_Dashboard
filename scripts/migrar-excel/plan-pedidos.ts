import { parsearFolio } from '../../src/domain/pedidos';
import { uuidDeterminista } from './ids';
import {
  centavosDeCelda,
  clasificarEstatus,
  fechaDeCelda,
  fechasDeComentario,
  inferirFecha,
  llaveNombre,
  parsearTarjeta,
  restaDeComentario,
} from './normalizar';
import { crearOrigen } from './origen';
import type { PersonasPlan } from './plan-personas';
import type { CatalogosPiezasPlan } from './plan-piezas';
import type {
  Celda,
  ClaseEstatus,
  Contexto,
  FilaConcentrado,
  ItemPlan,
  Libro,
  Mapeo,
  PagoPlan,
  PedidoPlan,
  PiezaPlan,
} from './tipos';

export interface PedidosPlan {
  /** En orden de aparición en el Concentrado (las del inventario al final). */
  pedidos: PedidoPlan[];
  pagos: PagoPlan[];
  /** Piezas con su estado final; las históricas de una venta sin pedido se descartan. */
  piezas: PiezaPlan[];
  /** Pedidos que pueden contar para la tarjeta (`cuentaTarjeta` queda provisional hasta asignarla). */
  elegibles: Set<string>;
  /** Evidencia de la columna "Tarjeta de Lealtad" del Concentrado, por pedido. */
  evidencia: Map<string, { posicion: number; fecha: string | null }>;
}

type ClaseVenta = 'vendido' | 'por_cobrar' | 'no_cobrado' | 'regalo';
const MOTIVO_NO_COBRADO = 'No se cobró (Excel)';
const MOTIVO_REGALO = 'Regalo (Excel)';
const NOTA_PAGO = 'Pago histórico resumido (Excel fase 1)';

interface Linea {
  f: FilaConcentrado;
  piezaId: string;
  clase: ClaseVenta;
  clienteId: string | null;
  vendedorId: string;
  precio: number;
  fecha: string;
  folio: number | null;
  comentario: string | null;
}

const texto = (c: Celda): string | null => (typeof c === 'string' && c.trim() ? c.trim() : null);

export function planPedidos(
  l: Libro,
  m: Mapeo,
  ctx: Contexto,
  personas: PersonasPlan,
  cat: CatalogosPiezasPlan,
): PedidosPlan {
  const lote = m.lote;
  const piezaPorId = new Map(cat.piezas.map((p) => [p.id, p]));
  const casa = personas.vendedores.find((v) => v.tipo === 'casa')!;
  const vendedorPorId = new Map(personas.vendedores.map((v) => [v.id, v]));
  const rechazar = (fila: number, motivo: string, clave: string | null = null) =>
    ctx.rechazos.push({ hoja: 'Concentrado', fila, clave, motivo });
  const avisar = (fila: number, tipo: string, detalle: string, clave: string | null = null) =>
    ctx.avisos.push({ hoja: 'Concentrado', fila, clave, tipo, detalle });

  // Vendedor que el inventario asigna a cada pieza
  const vendedorInv = new Map<string, string>();
  for (const [filaInv, pid] of cat.piezaPorFilaInv) {
    const v = personas.filaClienteInv.get(filaInv)?.vendedorId;
    if (v) vendedorInv.set(pid, v);
  }

  // --- Fecha de venta de cada fila (D-13), con la fila anterior como respaldo
  interface FechaFila {
    fecha: string;
    origen: 'tarjeta' | 'comentario' | 'compra' | 'fila_anterior' | 'corte';
  }
  const fechaDeFila = new Map<number, FechaFila>();
  let previa: string | null = null;
  for (const f of l.concentrado) {
    const t = parsearTarjeta(f.tarjeta);
    const deTarjeta = t && 'fecha' in t && t.fecha && t.fecha <= m.fechaCorte ? t.fecha : null;
    const compra = fechaDeCelda(f.fechaCompra, m.fechaCorte);
    let r: FechaFila | null = null;
    if (deTarjeta) r = { fecha: deTarjeta, origen: 'tarjeta' };
    else {
      const dm = fechasDeComentario(texto(f.comentarios) ?? '')[0];
      const inf = dm ? inferirFecha(dm, { desde: compra, hasta: m.fechaCorte }) : null;
      if (inf) r = { fecha: inf, origen: 'comentario' };
      else if (compra) r = { fecha: compra, origen: 'compra' };
    }
    if (r) previa = r.fecha;
    else r = previa ? { fecha: previa, origen: 'fila_anterior' } : { fecha: m.fechaCorte, origen: 'corte' };
    fechaDeFila.set(f.fila, r);
  }

  // --- Líneas de venta
  const lineas: Linea[] = [];
  const evidenciaFila = new Map<number, { posicion: number; fecha: string | null }>();
  for (const f of l.concentrado) {
    if (ctx.filasRechazadas.has(f.fila)) continue;
    const piezaId = cat.vinculo.get(f.fila);
    const clase = clasificarEstatus(f.estatus, m) as ClaseEstatus | null;
    if (!piezaId || !clase || !['vendido', 'por_cobrar', 'no_cobrado', 'regalo'].includes(clase)) continue;
    const per = personas.filaCliente.get(f.fila);
    const clienteId = per?.clienteId ?? null;
    if (clase === 'regalo' && !clienteId) continue; // regalo sin cliente: pieza `regalo`, sin pedido
    const pieza = piezaPorId.get(piezaId)!;
    let precio = centavosDeCelda(f.venta);
    if (precio === null) {
      if (pieza.origen.clave.startsWith('inv:') && pieza.precio > 0) {
        precio = pieza.precio;
        avisar(
          f.fila,
          'precio_de_inventario',
          'Venta sin precio: se usa el precio del inventario.',
          pieza.origen.clave,
        );
      } else {
        precio = 0;
        avisar(f.fila, 'precio_vacio_venta', 'Venta sin precio: la línea va en 0.', pieza.origen.clave);
      }
    }
    const ff = fechaDeFila.get(f.fila)!;
    if (ff.origen !== 'tarjeta')
      avisar(
        f.fila,
        {
          comentario: 'fecha_venta_inferida',
          compra: 'fecha_venta_de_compra',
          fila_anterior: 'fecha_venta_fila_anterior',
          corte: 'fecha_venta_corte',
        }[ff.origen],
        'La fecha de venta no está en la columna Tarjeta; se infirió.',
        pieza.origen.clave,
      );
    // Nota KZR
    let folio: number | null = null;
    if (f.nota instanceof Date)
      avisar(f.fila, 'nota_con_fecha', 'La columna Nota KZR trae una fecha: la fila va sin nota.');
    else if (f.nota != null) {
      folio = parsearFolio(String(f.nota));
      if (folio === null)
        avisar(f.fila, 'nota_invalida', 'La columna Nota KZR no es un folio: la fila va sin nota.');
    }
    const t = parsearTarjeta(f.tarjeta);
    if (t && 'posicion' in t) evidenciaFila.set(f.fila, { posicion: t.posicion, fecha: t.fecha });
    lineas.push({
      f,
      piezaId,
      clase: clase as ClaseVenta,
      clienteId,
      vendedorId: per?.vendedorId ?? vendedorInv.get(piezaId) ?? casa.id,
      precio,
      fecha: ff.fecha,
      folio,
      comentario: texto(f.comentarios),
    });
  }

  // --- Armado de pedidos
  const pedidos: PedidoPlan[] = [];
  const orden = new Map<string, number>(); // pedido → primera fila del Concentrado
  const pagos: PagoPlan[] = [];
  const elegibles = new Set<string>();
  const evidencia = new Map<string, { posicion: number; fecha: string | null }>();
  const usadas = new Map<string, string>(); // pieza → clave del pedido
  const rechazadas = new Set<string>(); // piezas cuya línea se rechazó
  const clienteLlave = new Map(personas.clientes.map((c) => [c.id, c.llave]));
  const genericoLlave = llaveNombre(m.clienteSinNombre);
  const esCero = (c: ClaseVenta) => c === 'no_cobrado' || c === 'regalo';

  function aceptar(lns: Linea[]): Linea[] {
    const ok: Linea[] = [];
    for (const x of lns) {
      if (usadas.has(x.piezaId) || ok.some((o) => o.piezaId === x.piezaId)) {
        rechazar(x.f.fila, 'pieza ya está en otro pedido');
        rechazadas.add(x.piezaId);
      } else ok.push(x);
    }
    return ok;
  }

  function armar(o: {
    clave: string;
    tipo: 'kzr' | 'historico';
    lns: Linea[];
    clienteId: string;
    esGenerico: boolean;
    folio: number | null;
  }) {
    const { lns, clave } = o;
    const filas = lns.map((x) => x.f.fila).sort((a, b) => a - b);
    const fecha = lns.map((x) => x.fecha).sort()[0]!;
    const vendedorId = lns[0]!.vendedorId;
    if (lns.some((x) => x.vendedorId !== vendedorId))
      avisar(
        filas[0]!,
        'nota_vendedores_distintos',
        'Las líneas de la nota traen vendedores distintos: gana el de la primera.',
        clave,
      );
    const subtotal = lns.reduce((a, x) => a + x.precio, 0);
    const manual = lns.filter((x) => esCero(x.clase)).reduce((a, x) => a + x.precio, 0);
    const hayNoCobrado = lns.some((x) => x.clase === 'no_cobrado' && x.precio > 0);
    const hayRegalo = lns.some((x) => x.clase === 'regalo' && x.precio > 0);
    const motivo =
      manual === 0
        ? null
        : hayNoCobrado && hayRegalo
          ? 'No se cobró / regalo (Excel)'
          : hayNoCobrado
            ? MOTIVO_NO_COBRADO
            : MOTIVO_REGALO;
    const total = subtotal - manual;
    let pagado = 0;
    for (const x of lns) {
      if (x.clase === 'vendido') pagado += x.precio;
      else if (x.clase === 'por_cobrar') {
        const resta = restaDeComentario(x.comentario ?? '');
        if (resta !== null && resta > x.precio)
          avisar(
            x.f.fila,
            'resta_mayor_que_precio',
            'El RESTA supera el precio de la línea: se toma como sin abono.',
            clave,
          );
        pagado += resta === null || resta > x.precio ? 0 : x.precio - resta;
      }
    }
    const estado = pagado === total ? 'liquidado' : 'abierto';
    let fechaPago = fecha;
    for (const x of lns)
      for (const dm of fechasDeComentario(x.comentario ?? '')) {
        const d = inferirFecha(dm, { desde: x.fecha, hasta: m.fechaCorte });
        if (d && d > fechaPago) fechaPago = d;
      }
    const id = uuidDeterminista(lote, clave);
    const coments = lns.map((x) => x.comentario).filter((x): x is string => !!x);
    const notas =
      `Excel (filas ${filas.join(', ')})${coments.length ? `: ${coments.join(' / ')}` : ''}`.slice(0, 500);
    const cobrable = lns.some((x) => x.clase === 'vendido' || x.clase === 'por_cobrar');
    const elegible = !o.esGenerico && cobrable;
    const items: ItemPlan[] = lns.map((x) => ({
      piezaId: x.piezaId,
      precioLista: x.precio,
      precioFinal: x.precio,
    }));
    const pedido: PedidoPlan = {
      id,
      folio: o.folio ?? 0,
      folioOriginal: o.tipo === 'kzr' ? o.folio : null,
      clienteId: o.clienteId,
      vendedorId,
      fecha,
      estado,
      cuentaTarjeta: elegible,
      ciclo: null,
      posicion: null,
      descuentoManual: manual,
      descuentoManualMotivo: motivo,
      total,
      notas,
      liquidadoEn: estado === 'liquidado' ? `${fechaPago}T12:00:00-06:00` : null,
      items,
      tipo: o.tipo,
      origen: crearOrigen(
        clave,
        'Concentrado',
        filas,
        lns.map((x) => x.f),
      ),
    };
    pedidos.push(pedido);
    orden.set(id, filas[0]!);
    for (const x of lns) usadas.set(x.piezaId, clave);
    if (elegible) {
      elegibles.add(id);
      const ev = lns.map((x) => evidenciaFila.get(x.f.fila)).find((e) => e);
      if (ev) evidencia.set(id, ev);
    }
    if (pagado > 0) {
      const v = vendedorPorId.get(vendedorId)!;
      const claveP = `pago:${clave}`;
      pagos.push({
        id: uuidDeterminista(lote, claveP),
        idempotencyKey: uuidDeterminista(lote, `idem:${claveP}`),
        pedidoId: id,
        fecha: fechaPago,
        monto: pagado,
        pagadorClienteId: v.tipo === 'casa' ? o.clienteId : null,
        pagadorVendedorId: v.tipo === 'casa' ? null : vendedorId,
        nota: NOTA_PAGO,
        origen: crearOrigen(claveP, 'Concentrado', filas, { pedido: clave, monto: pagado }),
      });
    }
  }

  // Notas KZR
  const notas = new Map<number, Linea[]>();
  const sinNota: Linea[] = [];
  for (const x of lineas) {
    if (x.folio === null) sinNota.push(x);
    else notas.set(x.folio, [...(notas.get(x.folio) ?? []), x]);
  }
  for (const [folio, lns0] of notas) {
    const clientes = new Set(lns0.map((x) => x.clienteId).filter((x): x is string => !!x));
    if (clientes.size > 1) {
      for (const x of lns0) {
        rechazar(x.f.fila, 'nota con dos clientes');
        rechazadas.add(x.piezaId);
      }
      continue;
    }
    const lns = aceptar(lns0);
    if (!lns.length) continue;
    const clienteId = [...clientes][0] ?? personas.clienteGenerico();
    armar({ clave: `kzr:${folio}`, tipo: 'kzr', lns, clienteId, esGenerico: clientes.size === 0, folio });
  }

  // Ventas sin nota: (cliente, vendedor, fecha de venta); lo que no se cobró va en su propio pedido
  const grupos = new Map<string, { lns: Linea[]; clienteId: string; generico: boolean; cero: boolean }>();
  for (const x of aceptar(sinNota)) {
    const generico = x.clienteId === null;
    const clienteId = x.clienteId ?? personas.clienteGenerico();
    const cero = esCero(x.clase);
    const llave = generico ? genericoLlave : (clienteLlave.get(clienteId) ?? clienteId);
    const clave = `hist:${llave}|${vendedorPorId.get(x.vendedorId)!.llave}|${x.fecha}${cero ? '|cero' : ''}`;
    const g = grupos.get(clave) ?? { lns: [], clienteId, generico, cero };
    g.lns.push(x);
    grupos.set(clave, g);
  }
  for (const [clave, g] of grupos)
    armar({
      clave,
      tipo: 'historico',
      lns: g.lns,
      clienteId: g.clienteId,
      esGenerico: g.generico,
      folio: null,
    });

  // --- Piezas del inventario con cliente y sin venta → pedido abierto (M-36)
  const invGrupos = new Map<
    string,
    { clienteId: string; vendedorId: string; piezas: PiezaPlan[]; filas: number[] }
  >();
  for (const f of l.inventario) {
    const pid = cat.piezaPorFilaInv.get(f.fila);
    const per = personas.filaClienteInv.get(f.fila);
    const pieza = pid ? piezaPorId.get(pid) : undefined;
    if (!pieza || !per?.clienteId || usadas.has(pieza.id)) continue;
    if (!['disponible', 'en_exhibidor', 'guardada'].includes(pieza.estado)) continue;
    if (pieza.precio === 0) {
      ctx.rechazos.push({
        hoja: 'INVENTARIO',
        fila: f.fila,
        clave: pieza.origen.clave,
        motivo: 'pieza de inventario con cliente y sin precio',
      });
      continue;
    }
    const vendedorId = per.vendedorId ?? casa.id;
    const clave = `inv:${clienteLlave.get(per.clienteId) ?? per.clienteId}|${vendedorPorId.get(vendedorId)!.llave}`;
    const g = invGrupos.get(clave) ?? { clienteId: per.clienteId, vendedorId, piezas: [], filas: [] };
    g.piezas.push(pieza);
    g.filas.push(f.fila);
    invGrupos.set(clave, g);
    ctx.avisos.push({
      hoja: 'INVENTARIO',
      fila: f.fila,
      clave: pieza.origen.clave,
      tipo: 'inventario_con_cliente_sin_venta',
      detalle: 'La pieza tiene cliente en el inventario y ninguna venta en el Concentrado: pedido abierto.',
    });
  }
  for (const [clave, g] of invGrupos) {
    const items: ItemPlan[] = g.piezas.map((p) => ({
      piezaId: p.id,
      precioLista: p.precio,
      precioFinal: p.precio,
    }));
    const total = items.reduce((a, i) => a + i.precioLista, 0);
    const id = uuidDeterminista(lote, clave);
    pedidos.push({
      id,
      folio: 0,
      folioOriginal: null,
      clienteId: g.clienteId,
      vendedorId: g.vendedorId,
      fecha: m.fechaCorte,
      estado: 'abierto',
      cuentaTarjeta: false,
      ciclo: null,
      posicion: null,
      descuentoManual: 0,
      descuentoManualMotivo: null,
      total,
      notas:
        `Excel (inventario, filas ${g.filas.join(', ')}): cliente asignado en el inventario sin venta en el Concentrado`.slice(
          0,
          500,
        ),
      liquidadoEn: null,
      items,
      tipo: 'inventario',
      origen: crearOrigen(
        clave,
        'INVENTARIO',
        g.filas,
        g.piezas.map((p) => p.origen.datos),
      ),
    });
    orden.set(id, Number.MAX_SAFE_INTEGER);
    for (const p of g.piezas) usadas.set(p.id, clave);
  }

  // --- Folios: las notas conservan el suyo; el resto, desde folioHistoricoDesde en orden (fecha, clave)
  const nuevos = pedidos
    .filter((p) => p.folio === 0)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.origen.clave.localeCompare(b.origen.clave));
  nuevos.forEach((p, i) => (p.folio = m.folioHistoricoDesde + i));
  pedidos.sort((a, b) => orden.get(a.id)! - orden.get(b.id)! || a.folio - b.folio);

  // --- Estado final de las piezas (M-37)
  const pedidoDePieza = new Map<string, PedidoPlan>();
  for (const p of pedidos) for (const i of p.items) pedidoDePieza.set(i.piezaId, p);
  const piezas: PiezaPlan[] = [];
  for (const p of cat.piezas) {
    const ped = pedidoDePieza.get(p.id);
    if (ped) {
      piezas.push({
        ...p,
        estado: ped.estado === 'liquidado' ? 'vendida' : 'apartada',
        exhibidorId: ped.estado === 'liquidado' ? null : p.exhibidorId,
        pedidoId: ped.id,
        fechaMovimiento: ped.fecha > p.fechaAlta ? ped.fecha : p.fechaAlta,
      });
    } else if (p.origen.clave.startsWith('conc:') && (p.estado === 'vendida' || p.estado === 'apartada')) {
      // Venta histórica que no llegó a pedido (nota rechazada…): la pieza tampoco entra.
      if (!rechazadas.has(p.id))
        ctx.rechazos.push({
          hoja: 'Concentrado',
          fila: p.origen.filas[0] ?? null,
          clave: p.origen.clave,
          motivo: 'venta sin pedido',
        });
    } else piezas.push(p);
  }

  return {
    pedidos,
    pagos,
    piezas,
    elegibles,
    evidencia,
  };
}
