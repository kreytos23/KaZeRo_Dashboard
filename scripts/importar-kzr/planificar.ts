/**
 * Planificación pura de la importación: resuelve las notas del Excel contra un `Snapshot` de la BD y aplica
 * las mismas reglas que `crearPedido` (pieza disponible y de la vendedora, tarjeta del cliente, descuento de
 * lealtad, totales). No toca la BD: al aplicar se vuelve a planificar bajo los bloqueos y el hash debe coincidir.
 */
import { createHash } from 'node:crypto';
import { REGLAS_LEALTAD, descuentoLealtad } from '../../src/domain/lealtad';
import { MAX_PIEZAS_PEDIDO, calcularTotales } from '../../src/domain/pedidos';
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
  type ClientePorCrear,
  type NotaPlan,
  type PiezaSnapshot,
  type PlanKzr,
  type Problema,
  type Snapshot,
} from './tipos';

export const claveNota = (folio: number) => `kzr:${folio}`;
/** Nombre del cliente tal como se crea: recortado y con los espacios colapsados. */
export const nombreCliente = (t: string) => t.trim().replace(/\s+/g, ' ');
export const claveCliente = (nombre: string) =>
  `kzr-cliente:${createHash('sha256').update(normalizar(nombre)).digest('hex')}`;
const MAX_NOMBRE_CLIENTE = 120;
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
  /** Tarjeta de cada cliente según la BD (la vuelta más alta con algún pedido vigente y sus lugares). */
  const tarjetaDeBd = (clienteId: string) => {
    const suyas = snap.tarjetas.filter((x) => x.clienteId === clienteId);
    const ciclo = suyas.reduce((m, x) => Math.max(m, x.ciclo), 1);
    return { ciclo, ocupadas: new Set(suyas.filter((x) => x.ciclo === ciclo).map((x) => x.posicion)) };
  };
  interface Candidata {
    n: ReturnType<typeof agruparNotas>['notas'][number];
    clave: string;
    hash: string;
    cliente: { id: string | null; nombre: string; clave: string };
    vendedor: Snapshot['vendedores'][number];
    items: { p: PiezaSnapshot; fila: number }[];
    fecha: string;
    lugar: number;
  }
  const candidatas: Candidata[] = [];
  const porPrefijoUsado = new Map<
    string,
    { texto: string; v: Snapshot['vendedores'][number]; folio: number; filas: number[]; notas: number }
  >();
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

    if (n.filas.length > MAX_PIEZAS_PEDIDO)
      err('demasiadas_piezas', `Máximo ${MAX_PIEZAS_PEDIDO} piezas por pedido.`);

    // Estatus: solo «Por cobrar» por ahora.
    if (!esEstatusSoportado(n.estatus))
      err('estatus_no_soportado', `Estatus no soportado aún: «${n.estatus}».`);

    // Tarjeta: formato, fecha no futura.
    const tarjeta = parsearTarjeta(n.tarjeta, hoy);
    if (!tarjeta.ok) err(tarjeta.codigo, `Tarjeta de lealtad: ${tarjeta.motivo}.`);

    // Cliente: exactamente uno, sin importar mayúsculas, acentos ni espacios.
    const cs = clientes.get(normalizar(n.cliente)) ?? [];
    if (cs.length > 1)
      err(
        'cliente_ambiguo',
        `Hay ${cs.length} clientes con ese nombre (ids ${cs.map((c) => corto(c.id)).join(', ')}).`,
      );
    let cliente: Candidata['cliente'] | null = null;
    if (cs.length === 1) cliente = { id: cs[0]!.id, nombre: cs[0]!.nombre, clave: claveCliente(n.cliente) };
    else if (cs.length === 0) {
      // Sin coincidencia exacta: ¿ya se importó antes (origen_excel) o se crea con el nombre del Excel?
      const nombre = nombreCliente(n.cliente);
      const clave = claveCliente(nombre);
      const ligado = (origenes.get(clave) ?? []).find(
        (o) => o.lote === LOTE_KZR && o.clienteId && snap.clientes.some((c) => c.id === o.clienteId),
      );
      if (ligado)
        cliente = {
          id: ligado.clienteId,
          nombre: snap.clientes.find((c) => c.id === ligado.clienteId)!.nombre,
          clave,
        };
      else if (nombre.length > MAX_NOMBRE_CLIENTE)
        err('cliente_nombre_invalido', `El nombre del cliente excede ${MAX_NOMBRE_CLIENTE} caracteres.`);
      else cliente = { id: null, nombre, clave };
    }

    // Vendedora: el texto antes de « - »; debe existir y estar activa.
    const vs = vendedores.get(normalizar(n.vendedora)) ?? [];
    const activas = vs.filter((v) => v.activo);
    let vendedor = activas.length === 1 ? activas[0]! : null;
    if (vs.length === 0) {
      // Sin coincidencia exacta: una vendedora activa cuyo nombre empiece con el texto y una palabra completa.
      const q = normalizar(n.vendedora);
      const porPrefijo = q
        ? snap.vendedores.filter((v) => v.activo && normalizar(v.nombre).startsWith(`${q} `))
        : [];
      if (porPrefijo.length === 0) err('vendedor_no_encontrado', 'La vendedora no existe en la BD.');
      else if (porPrefijo.length > 1)
        err('vendedor_ambiguo', `Hay ${porPrefijo.length} vendedoras activas que empiezan con ese nombre.`);
      else {
        vendedor = porPrefijo[0]!;
        const previo = porPrefijoUsado.get(`${q}>${vendedor.id}`);
        if (previo) previo.notas++;
        else
          porPrefijoUsado.set(`${q}>${vendedor.id}`, {
            texto: n.vendedora,
            v: vendedor,
            folio: n.folio,
            filas: nums,
            notas: 1,
          });
      }
    } else if (activas.length === 0) err('vendedor_inactivo', 'La vendedora está inactiva.');
    else if (activas.length > 1)
      err('vendedor_ambiguo', `Hay ${activas.length} vendedoras activas con ese nombre.`);

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
      // Igual que exigirDisponibles: las piezas de un exhibidor también se apartan en una nota KZR.
      if (p.estado !== 'disponible' && p.estado !== 'en_exhibidor') {
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

    if (problemas.length || !cliente || !vendedor || !tarjeta.ok) {
      errores.push(...problemas);
      continue;
    }
    candidatas.push({
      n,
      clave,
      hash,
      cliente,
      vendedor,
      items,
      fecha: tarjeta.fecha,
      lugar: tarjeta.lugar,
    });
  }

  // Tarjeta de lealtad (reunión 2026-10-23, punto 3: al llegar al 10 se reinicia). Las notas de cada cliente se
  // procesan por fecha y folio sobre los lugares que ya tiene en la BD. Si el lugar pedido está libre en la
  // vuelta actual se usa; si la vuelta ya llegó al lugar 10 (o está llena), se abre la siguiente; si el lugar
  // está ocupado en una vuelta que no ha llegado al 10, es un error.
  const tamano = REGLAS_LEALTAD.tamanoCiclo;
  const porCliente = new Map<string, Candidata[]>();
  // Un cliente por crear no tiene tarjeta en la BD: su primera nota abre la vuelta 1 (y cuenta desde ahí).
  const llaveCliente = (c: Candidata) => c.cliente.id ?? `nuevo:${c.cliente.clave}`;
  for (const c of candidatas)
    porCliente.set(llaveCliente(c), [...(porCliente.get(llaveCliente(c)) ?? []), c]);
  for (const [clienteId, lista] of porCliente) {
    lista.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.n.folio - b.n.folio);
    const t = tarjetaDeBd(clienteId);
    const idCorto = lista[0]!.cliente.id ? corto(clienteId) : 'nuevo';
    for (const c of lista) {
      const nums = c.n.filas.map((f) => f.fila);
      if (t.ocupadas.size >= tamano || t.ocupadas.has(tamano)) {
        t.ciclo++;
        t.ocupadas = new Set();
      } else if (t.ocupadas.has(c.lugar)) {
        errores.push({
          codigo: 'lugar_ocupado',
          folio: c.n.folio,
          filas: nums,
          mensaje: `El lugar ${c.lugar} de la tarjeta (vuelta ${t.ciclo}) del cliente ${idCorto} ya está ocupado.`,
        });
        continue;
      }
      t.ocupadas.add(c.lugar);
      // Totales con el mismo cálculo del dominio que usa crearPedido.
      const pctBps = descuentoLealtad({ cuentaTarjeta: true, posicion: c.lugar }).pctBps;
      const tot = calcularTotales(
        c.items.map((i) => i.p.precioCentavos),
        pctBps,
        0,
      );
      if (tot.total === 0) {
        errores.push({
          codigo: 'total_cero',
          folio: c.n.folio,
          filas: nums,
          mensaje: 'El total de la nota es 0: crearPedido la liquidaría al crearla, no se soporta aquí.',
        });
        continue;
      }
      notas.push({
        estado: 'nueva',
        folio: c.n.folio,
        clave: c.clave,
        hashFuente: c.hash,
        filas: nums,
        fecha: c.fecha,
        clienteId: c.cliente.id,
        clienteNuevo: c.cliente.id ? null : c.cliente.clave,
        vendedorId: c.vendedor.id,
        clienteEtiqueta: `${idCorto} (${iniciales(c.cliente.nombre)})`,
        vendedorEtiqueta: `${corto(c.vendedor.id)} (${iniciales(c.vendedor.nombre)})`,
        ciclo: t.ciclo,
        posicion: c.lugar,
        pctBps,
        items: c.items.map((i, k) => ({
          piezaId: i.p.id,
          codigo: i.p.codigo,
          precioCentavos: i.p.precioCentavos,
          precioFinalCentavos: tot.preciosFinales[k]!,
        })),
        subtotal: tot.subtotal,
        descuentoLealtad: tot.descuentoLealtad,
        total: tot.total,
      });
    }
  }
  notas.sort((a, b) => a.folio - b.folio);
  for (const u of porPrefijoUsado.values())
    avisos.push({
      codigo: 'vendedor_por_prefijo',
      folio: u.folio,
      filas: u.filas,
      mensaje: `Vendedora resuelta por prefijo en ${u.notas} nota(s): «${u.texto}» → «${u.v.nombre}» (${corto(u.v.id)}). Confirma que es la correcta.`,
    });
  // Clientes por crear: uno por nombre normalizado, solo si alguna nota nueva los usa.
  const clientesPorCrear = new Map<string, ClientePorCrear>();
  for (const c of candidatas)
    if (
      !c.cliente.id &&
      !clientesPorCrear.has(c.cliente.clave) &&
      notas.some((n) => n.estado === 'nueva' && n.clienteNuevo === c.cliente.clave)
    )
      clientesPorCrear.set(c.cliente.clave, { clave: c.cliente.clave, nombre: c.cliente.nombre });

  const folios = notas.map((n) => n.folio);
  const siguienteFolio = Math.max(snap.maxFolio, snap.folioSecuencia, 0, ...folios) + 1;
  const porCrear = [...clientesPorCrear.values()].sort((a, b) => a.clave.localeCompare(b.clave));
  const hash = hashDelPlan(notas, siguienteFolio, porCrear);
  return { clientesPorCrear: porCrear, notas, errores, avisos, siguienteFolio, hash };
}

/** Hash del plan resuelto: ids, precios, lugares, fechas. No incluye números de fila ni nombres. */
function hashDelPlan(
  notas: readonly NotaPlan[],
  siguienteFolio: number,
  clientesPorCrear: readonly ClientePorCrear[],
): string {
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
          clienteNuevo: n.clienteNuevo,
          vendedorId: n.vendedorId,
          ciclo: n.ciclo,
          posicion: n.posicion,
          pctBps: n.pctBps,
          items: n.items,
          total: n.total,
        },
  );
  return createHash('sha256')
    .update(jsonCanonico({ notas: canon, siguienteFolio, clientesPorCrear }))
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
    clientes.add(n.clienteId ?? n.clienteNuevo!);
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
  l.push(
    `Clientes por crear: ${plan.clientesPorCrear.length}` +
      (plan.clientesPorCrear.length
        ? ` (${plan.clientesPorCrear.map((c) => iniciales(c.nombre)).join(', ')})`
        : '') +
      '.',
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
