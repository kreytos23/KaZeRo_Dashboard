/**
 * Planificación pura de la importación: resuelve las notas del Excel contra un `Snapshot` de la BD y aplica
 * las mismas reglas que `crearPedido` (pieza disponible y de la vendedora, tarjeta del cliente, descuento de
 * lealtad, totales). No toca la BD: al aplicar se vuelve a planificar bajo los bloqueos y el hash debe coincidir.
 */
import { createHash } from 'node:crypto';
import { descuentoLealtad } from '../../src/domain/lealtad';
import { calcularTotales } from '../../src/domain/pedidos';
import { formatoMXN } from '../../src/domain/dinero';
import { normalizar } from '../../src/domain/texto';
import { jsonCanonico } from '../migrar-excel/ids';
import {
  agruparNotas,
  esEstatusSoportado,
  hashFuente,
  iniciales,
  parsearTarjeta,
  similitudDescripcion,
  UMBRAL_DESCRIPCION,
} from './parsear';
import {
  LOTE_KZR,
  type ItemPlan,
  type NotaPlan,
  type PiezaSnapshot,
  type PlanKzr,
  type Problema,
  type Snapshot,
} from './tipos';

export const claveNota = (folio: number) => `kzr:${folio}`;
const corto = (id: string) => id.slice(0, 8);

function indexarPorNombre<T extends { nombre: string }>(xs: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = normalizar(x.nombre);
    m.set(k, [...(m.get(k) ?? []), x]);
  }
  return m;
}

export function planificar(filas: Parameters<typeof agruparNotas>[0], snap: Snapshot, hoy: string): PlanKzr {
  const { notas: agrupadas, errores } = agruparNotas(filas);
  const avisos: Problema[] = [];
  const clientes = indexarPorNombre(snap.clientes);
  const vendedores = indexarPorNombre(snap.vendedores);
  const piezas = new Map(snap.piezas.map((p) => [p.codigo, p]));
  const folioExistente = new Map(snap.pedidosPorFolio.map((p) => [p.folio, p.id]));
  const origenes = new Map<string, Snapshot['origenes']>();
  for (const o of snap.origenes) origenes.set(o.clave, [...(origenes.get(o.clave) ?? []), o]);
  const usadas = new Map<string, number>(); // código → folio que ya lo reservó
  const tarjetas = new Map<string, { ciclo: number; ocupadas: Set<number> }>();
  const tarjetaDe = (clienteId: string) => {
    let t = tarjetas.get(clienteId);
    if (!t) {
      const suyas = snap.tarjetas.filter((x) => x.clienteId === clienteId);
      // Misma regla que siguientePosicion: la tarjeta actual es la vuelta más alta con algún pedido vigente.
      const ciclo = suyas.reduce((m, x) => Math.max(m, x.ciclo), 1);
      t = { ciclo, ocupadas: new Set(suyas.filter((x) => x.ciclo === ciclo).map((x) => x.posicion)) };
      tarjetas.set(clienteId, t);
    }
    return t;
  };
  const notas: NotaPlan[] = [];

  for (const n of agrupadas) {
    const nums = n.filas.map((f) => f.fila);
    const clave = claveNota(n.folio);
    const hash = hashFuente(n);
    const problemas: Problema[] = [];
    const err = (codigo: Problema['codigo'], mensaje: string, filasProblema = nums) =>
      problemas.push({ codigo, folio: n.folio, filas: filasProblema, mensaje });

    // Idempotencia: la nota ya importada con el mismo contenido no se vuelve a tocar.
    const previos = origenes.get(clave) ?? [];
    const propio = previos.find((o) => o.lote === LOTE_KZR);
    if (previos.some((o) => o.lote !== LOTE_KZR))
      err('folio_existente', 'El folio ya está registrado en origen_excel por otro lote.');
    else if (propio) {
      if (propio.hash === hash && propio.pedidoId) {
        for (const c of n.codigos) usadas.set(c, n.folio);
        notas.push({
          estado: 'ya_aplicada',
          folio: n.folio,
          clave,
          hashFuente: hash,
          filas: nums,
          pedidoId: propio.pedidoId,
        });
        continue;
      }
      err('origen_cambiado', 'La nota ya se importó, pero su contenido en el Excel cambió desde entonces.');
    } else if (folioExistente.has(n.folio))
      err('folio_existente', 'El folio ya existe como pedido en la BD (no se importó desde este Excel).');

    // Con el folio ya ocupado o el contenido cambiado, lo demás sería ruido (la nota ya tiene su pedido).
    if (problemas.length) {
      for (const c of n.codigos) usadas.set(c, n.folio);
      errores.push(...problemas);
      continue;
    }

    // Estatus: solo «Por cobrar» por ahora.
    if (!esEstatusSoportado(n.estatus))
      err('estatus_no_soportado', `Estatus no soportado aún: «${n.estatus}».`);

    // Tarjeta: formato, fecha no futura.
    const tarjeta = parsearTarjeta(n.tarjeta, hoy);
    if (!tarjeta.ok) err(tarjeta.codigo, `Tarjeta de lealtad: ${tarjeta.motivo}.`);

    // Cliente: exactamente uno, sin importar mayúsculas, acentos ni espacios.
    const cs = clientes.get(normalizar(n.cliente)) ?? [];
    if (cs.length === 0) err('cliente_no_encontrado', 'El cliente no existe en la BD.');
    else if (cs.length > 1)
      err(
        'cliente_ambiguo',
        `Hay ${cs.length} clientes con ese nombre (ids ${cs.map((c) => corto(c.id)).join(', ')}).`,
      );
    const cliente = cs.length === 1 ? cs[0]! : null;

    // Vendedora: el texto antes de « - »; debe existir y estar activa.
    const vs = vendedores.get(normalizar(n.vendedora)) ?? [];
    const activas = vs.filter((v) => v.activo);
    if (vs.length === 0) err('vendedor_no_encontrado', 'La vendedora no existe en la BD.');
    else if (activas.length === 0) err('vendedor_inactivo', 'La vendedora está inactiva.');
    else if (activas.length > 1)
      err('vendedor_ambiguo', `Hay ${activas.length} vendedoras activas con ese nombre.`);
    const vendedor = activas.length === 1 ? activas[0]! : null;

    // Piezas: existen, disponibles, de la vendedora de la nota y no repetidas.
    const items: { p: PiezaSnapshot; fila: number }[] = [];
    for (const f of n.filas) {
      const codigo = n.codigos[n.filas.indexOf(f)]!;
      const p = piezas.get(codigo);
      if (!p) {
        err('pieza_faltante', `La pieza ${codigo} no existe en la BD.`, [f.fila]);
        continue;
      }
      const previa = usadas.get(codigo);
      if (previa !== undefined) {
        err(
          'pieza_repetida',
          previa === n.folio
            ? `La pieza ${codigo} aparece más de una vez en la nota.`
            : `La pieza ${codigo} ya está en la nota KZR-${previa} del mismo Excel.`,
          [f.fila],
        );
        continue;
      }
      usadas.set(codigo, n.folio);
      if (p.estado !== 'disponible') {
        err('pieza_no_disponible', `La pieza ${codigo} no está disponible (estado: ${p.estado}).`, [f.fila]);
        continue;
      }
      if (vendedor && p.vendedorCustodiaId && p.vendedorCustodiaId !== vendedor.id) {
        err(
          'pieza_de_otra_vendedora',
          `La pieza ${codigo} la tiene otra vendedora distinta a la de la nota.`,
          [f.fila],
        );
        continue;
      }
      items.push({ p, fila: f.fila });
      if (f.descripcion && similitudDescripcion(f.descripcion, p.descripcion) < UMBRAL_DESCRIPCION)
        avisos.push({
          codigo: 'descripcion_distinta',
          folio: n.folio,
          filas: [f.fila],
          mensaje: `La descripción del Excel difiere mucho de la de la BD para ${codigo}.`,
        });
    }

    // Lugar de la tarjeta en la vuelta actual del cliente (y lo ya reservado por otras notas del Excel).
    let ciclo = 0;
    let posicion = 0;
    if (cliente && tarjeta.ok) {
      const t = tarjetaDe(cliente.id);
      if (t.ocupadas.has(tarjeta.lugar))
        err(
          'lugar_ocupado',
          `El lugar ${tarjeta.lugar} de la tarjeta (vuelta ${t.ciclo}) del cliente ${corto(cliente.id)} ya está ocupado.`,
        );
      else {
        ciclo = t.ciclo;
        posicion = tarjeta.lugar;
        t.ocupadas.add(tarjeta.lugar);
      }
    }

    // Totales con el mismo cálculo del dominio que usa crearPedido.
    const pctBps = posicion ? descuentoLealtad({ cuentaTarjeta: true, posicion }).pctBps : 0;
    const t = calcularTotales(
      items.map((i) => i.p.precioCentavos),
      pctBps,
      0,
    );
    if (!problemas.length && t.total === 0)
      err(
        'total_cero',
        'El total de la nota es 0: crearPedido la liquidaría al crearla, no se soporta aquí.',
      );

    if (problemas.length) {
      errores.push(...problemas);
      continue;
    }
    const itemsPlan: ItemPlan[] = items.map((i, k) => ({
      piezaId: i.p.id,
      codigo: i.p.codigo,
      precioCentavos: i.p.precioCentavos,
      precioFinalCentavos: t.preciosFinales[k]!,
    }));
    notas.push({
      estado: 'nueva',
      folio: n.folio,
      clave,
      hashFuente: hash,
      filas: nums,
      fecha: (tarjeta as { fecha: string }).fecha,
      clienteId: cliente!.id,
      vendedorId: vendedor!.id,
      clienteEtiqueta: `${corto(cliente!.id)} (${iniciales(cliente!.nombre)})`,
      vendedorEtiqueta: `${corto(vendedor!.id)} (${iniciales(vendedor!.nombre)})`,
      ciclo,
      posicion,
      pctBps,
      items: itemsPlan,
      subtotal: t.subtotal,
      descuentoLealtad: t.descuentoLealtad,
      total: t.total,
    });
  }

  const folios = notas.map((n) => n.folio);
  const siguienteFolio = Math.max(snap.maxFolio, snap.folioSecuencia, 0, ...folios) + 1;
  const hash = hashDelPlan(notas, siguienteFolio);
  return { notas, errores, avisos, siguienteFolio, hash };
}

/** Hash del plan resuelto: ids, precios, lugares, fechas. No incluye números de fila ni nombres. */
function hashDelPlan(notas: readonly NotaPlan[], siguienteFolio: number): string {
  const canon = notas.map((n) =>
    n.estado === 'ya_aplicada'
      ? { estado: n.estado, folio: n.folio, clave: n.clave, hashFuente: n.hashFuente, pedidoId: n.pedidoId }
      : {
          estado: n.estado,
          folio: n.folio,
          clave: n.clave,
          hashFuente: n.hashFuente,
          fecha: n.fecha,
          clienteId: n.clienteId,
          vendedorId: n.vendedorId,
          ciclo: n.ciclo,
          posicion: n.posicion,
          pctBps: n.pctBps,
          items: n.items,
          total: n.total,
        },
  );
  return createHash('sha256')
    .update(jsonCanonico({ notas: canon, siguienteFolio }))
    .digest('hex');
}

/** Reporte de conciliación para la consola: ids cortos e iniciales, sin nombres completos ni descripciones. */
export function renderizarReporte(plan: PlanKzr, ctx: { archivoSha256?: string } = {}): string[] {
  const l: string[] = [];
  const nuevas = plan.notas.filter((n) => n.estado === 'nueva');
  const aplicadas = plan.notas.filter((n) => n.estado === 'ya_aplicada');
  if (ctx.archivoSha256) l.push(`SHA-256 del Excel: ${ctx.archivoSha256}`);
  l.push(`Notas válidas: ${plan.notas.length} (nuevas ${nuevas.length}, ya importadas ${aplicadas.length}).`);
  let piezasTotal = 0;
  let subtotal = 0;
  let descuento = 0;
  let total = 0;
  const clientes = new Set<string>();
  const vendedores = new Set<string>();
  for (const n of nuevas) {
    piezasTotal += n.items.length;
    subtotal += n.subtotal;
    descuento += n.descuentoLealtad;
    total += n.total;
    clientes.add(n.clienteId);
    vendedores.add(n.vendedorId);
    l.push(
      `  KZR-${n.folio} · ${n.items.length} pieza(s) · cliente ${n.clienteEtiqueta} · vendedora ${n.vendedorEtiqueta} · ` +
        `tarjeta vuelta ${n.ciclo} lugar ${n.posicion} (${n.pctBps / 100} % lealtad) · fecha ${n.fecha} · ` +
        `subtotal ${formatoMXN(n.subtotal)} → total ${formatoMXN(n.total)}`,
    );
  }
  for (const n of aplicadas)
    l.push(`  KZR-${n.folio} · ya importada (pedido ${corto(n.pedidoId)}): no se toca.`);
  l.push(
    `Por insertar: ${nuevas.length} pedido(s), ${piezasTotal} pieza(s) a apartar, ${clientes.size} cliente(s) y ` +
      `${vendedores.size} vendedora(s) enlazados.`,
  );
  l.push(
    `Totales por insertar: subtotal ${formatoMXN(subtotal)} − lealtad ${formatoMXN(descuento)} = ${formatoMXN(total)}.`,
  );
  l.push(`Siguiente folio tras aplicar: ${plan.siguienteFolio}.`);
  const porCodigo = (xs: Problema[]) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x.codigo, (m.get(x.codigo) ?? 0) + 1);
    return JSON.stringify(Object.fromEntries(m));
  };
  l.push(`Errores (${plan.errores.length}) por tipo: ${porCodigo(plan.errores)}`);
  for (const e of plan.errores) l.push(`  ERROR ${etiquetaProblema(e)}: ${e.mensaje}`);
  l.push(`Avisos (${plan.avisos.length}) por tipo: ${porCodigo(plan.avisos)}`);
  for (const a of plan.avisos) l.push(`  AVISO ${etiquetaProblema(a)}: ${a.mensaje}`);
  l.push(`Hash del plan: ${plan.hash}`);
  return l;
}

const etiquetaProblema = (p: Problema) =>
  `[${p.codigo}] ${p.folio !== null ? `KZR-${p.folio}` : 'sin folio'} (fila${p.filas.length === 1 ? '' : 's'} ${p.filas.join(', ')})`;
