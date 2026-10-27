/**
 * Plan 7a, D-4/D-9/D-10: única parte de la migración que toca la BD. Todo va en UNA transacción del dueño:
 * timeouts y bloqueo de tablas → admin "migración" + contexto de auditoría → lo ya migrado (origen_excel) →
 * resolución contra los datos de la app → inserción por lotes → secuencia de folios → verificación → COMMIT
 * (`aplicar`) o ROLLBACK intencional (`ensayo`). Solo INSERT: nada existente se actualiza ni se borra.
 */
import { randomBytes } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { conDbUrl, type Ejecutor } from '../../src/db/pool';
import {
  admin,
  aplicacionPago,
  categoria,
  cliente,
  exhibidor,
  material,
  movimientoPieza,
  origenExcel,
  pago,
  pedido,
  pedidoItem,
  pieza,
  proveedor,
  vendedor,
} from '../../src/db/schema';
import { centavosANumeric, numericACentavos } from '../../src/domain/dinero';
import { fijarContextoAuditoria } from '../../src/server/auditoria/servicio';
import { EMAIL_ADMIN_MIGRACION } from '../../src/server/auth/admin-migracion';
import { hashPassword } from '../../src/server/auth/password';
import { hashPlan } from './ids';
import type {
  CatalogoPlan,
  Origen,
  PagoPlan,
  PedidoPlan,
  PiezaPlan,
  PlanImportacion,
  Rechazo,
  ResultadoBd,
  VerificacionBd,
} from './tipos';

export type { ResultadoBd } from './tipos';

export { EMAIL_ADMIN_MIGRACION };
export const MOTIVO_MIGRACION = 'Migración Excel fase 1';
/** No es un secreto cifrado: `descifrar` falla con él, así que nunca hay segundo factor válido. */
const TOTP_INSERVIBLE = 'migracion:sin-totp';
const FOLIO_HISTORICO_DEFECTO = 100001;

/** Primer folio histórico del plan: el menor folio no-KZR (= mapeo.folioHistoricoDesde); el defecto solo si no hay. */
export function folioHistoricoDelPlan(plan: Pick<PlanImportacion, 'pedidos'>): number {
  const folios = plan.pedidos.filter((p) => p.tipo !== 'kzr').map((p) => p.folio);
  return folios.length > 0 ? Math.min(...folios) : FOLIO_HISTORICO_DEFECTO;
}
const NOTAS_MAX = 500;

/** La verificación no cuadró: la transacción se deshizo. `resultado` lleva lo calculado (para el reporte). */
export class ErrorVerificacion extends Error {
  override name = 'ErrorVerificacion';
  constructor(
    readonly diferencias: string[],
    readonly resultado?: ResultadoBd,
  ) {
    super(
      `La verificación de la migración no cuadra (${diferencias.length} diferencia(s)); se hizo ROLLBACK.`,
    );
  }
}
/** Las decisiones contra la BD ya no son las del ensayo aprobado (la BD cambió o es otro destino): ROLLBACK. */
export class ErrorEnsayoDistinto extends Error {
  override name = 'ErrorEnsayoDistinto';
  constructor() {
    super(
      'La BD cambió desde el ensayo aprobado (decisiones distintas). Vuelve a ensayar. ROLLBACK: no quedó nada.',
    );
  }
}
/** `ensayo`: se lanza al final para que la transacción haga ROLLBACK; se atrapa fuera y se devuelve. */
class RollbackIntencional extends Error {
  constructor(readonly resultado: ResultadoBd) {
    super('Ensayo: ROLLBACK intencional');
  }
}

/** Lista para `x IN (...)` como UN parámetro jsonb (sin un parámetro por elemento). */
const lista = (xs: readonly string[]): SQL =>
  sql`(SELECT x FROM jsonb_array_elements_text(${JSON.stringify(xs)}::jsonb) x)`;
const listaUuid = (xs: readonly string[]): SQL =>
  sql`(SELECT x::uuid FROM jsonb_array_elements_text(${JSON.stringify(xs)}::jsonb) x)`;
const mediodiaMX = (fecha: string) => new Date(`${fecha.slice(0, 10)}T12:00:00-06:00`);
const dinero = (c: number) => centavosANumeric(c);

async function filas<T>(tx: Ejecutor, q: SQL): Promise<T[]> {
  const r = await tx.execute(q);
  return r.rows as T[];
}

/** Un INSERT de varias filas por lote: el await recorre lotes de 500, nunca filas (sin N+1). */
async function insertarPorLotes<T extends PgTable>(
  tx: Ejecutor,
  tabla: T,
  valores: T['$inferInsert'][],
  tam = 500,
): Promise<number> {
  let n = 0;
  for (let i = 0; i < valores.length; i += tam) {
    const r = await tx
      .insert(tabla)
      .values(valores.slice(i, i + tam) as never)
      .onConflictDoNothing()
      .returning({ x: sql`1` });
    n += r.length;
  }
  return n;
}

/** Admin dedicado: contraseña aleatoria descartada en el acto y TOTP inservible → nunca puede iniciar sesión. */
export async function asegurarAdminMigracion(tx: Ejecutor): Promise<string> {
  const hash = await hashPassword(randomBytes(32).toString('base64url'));
  await tx.execute(
    sql`INSERT INTO admin (email, password_hash, totp_secret_cifrado)
        VALUES (${EMAIL_ADMIN_MIGRACION}, ${hash}, ${TOTP_INSERVIBLE}) ON CONFLICT ((lower(email))) DO NOTHING`,
  );
  const [a] = await filas<{ id: string }>(
    tx,
    sql`SELECT id FROM ${admin} WHERE lower(email) = ${EMAIL_ADMIN_MIGRACION}`,
  );
  return a!.id;
}

type EstadoOrigen = 'nuevo' | 'aplicado' | 'cambiado';
type TipoSimple = 'categorias' | 'materiales' | 'proveedores' | 'vendedores' | 'clientes' | 'exhibidores';
interface Grupo {
  pedido: PedidoPlan | null;
  piezas: PiezaPlan[];
  pagos: PagoPlan[];
}
const miembros = (g: Grupo): Origen[] => [
  ...(g.pedido ? [g.pedido.origen] : []),
  ...g.piezas.map((p) => p.origen),
  ...g.pagos.map((p) => p.origen),
];

/** Resultado de comparar el plan con lo que hay en la BD (antes de escribir nada). */
interface Resolucion {
  /** id del plan → id real (catálogos, vendedores y clientes de la app reutilizados). */
  real: Map<string, string>;
  simplesNuevos: Record<TipoSimple, { id: string; origen: Origen }[]>;
  /** Entidades simples que existen como el plan las describe (nuevas o ya aplicadas con el mismo hash). */
  simplesVerificables: Record<TipoSimple, Set<string>>;
  gruposNuevos: Grupo[];
  gruposAplicados: Grupo[];
  folio: Map<string, number>;
  notas: Map<string, string>;
  yaAplicados: number;
  cambiados: { clave: string; hoja: string }[];
  reutilizados: ResultadoBd['reutilizados'];
  rechazosEnBd: Rechazo[];
  folioDesde: number;
}

const rechazo = (o: Origen, motivo: string): Rechazo => ({
  hoja: o.hoja,
  fila: o.filas[0] ?? null,
  clave: o.clave,
  motivo,
});

async function resolver(tx: Ejecutor, plan: PlanImportacion): Promise<Resolucion> {
  const previo = new Map(
    (
      await filas<{ clave: string; hash: string }>(
        tx,
        sql`SELECT clave, hash_contenido AS hash FROM ${origenExcel} WHERE lote = ${plan.lote}`,
      )
    ).map((x) => [x.clave, x.hash]),
  );
  const estado = (o: Origen): EstadoOrigen =>
    !previo.has(o.clave) ? 'nuevo' : previo.get(o.clave) === o.hash ? 'aplicado' : 'cambiado';
  const r: Resolucion = {
    real: new Map(),
    simplesNuevos: {
      categorias: [],
      materiales: [],
      proveedores: [],
      vendedores: [],
      clientes: [],
      exhibidores: [],
    },
    simplesVerificables: {
      categorias: new Set(),
      materiales: new Set(),
      proveedores: new Set(),
      vendedores: new Set(),
      clientes: new Set(),
      exhibidores: new Set(),
    },
    gruposNuevos: [],
    gruposAplicados: [],
    folio: new Map(),
    notas: new Map(),
    yaAplicados: 0,
    cambiados: [],
    reutilizados: { categorias: 0, materiales: 0, proveedores: 0, vendedores: 0, clientes: 0 },
    rechazosEnBd: [],
    // Frontera histórica configurada (mapeo.folioHistoricoDesde): los pedidos no-KZR empiezan en ella.
    // No se acota con el valor por defecto: si el mapeo la sube, los pedidos de la app entre el
    // defecto y esa frontera deben seguir contando para la secuencia de folios.
    folioDesde: folioHistoricoDelPlan(plan),
  };

  // --- Entidades simples: ya aplicadas, cambiadas o nuevas; las nuevas se buscan en la app por nombre.
  const simples: Record<TipoSimple, { id: string; nombre: string; origen: Origen }[]> = {
    categorias: plan.categorias,
    materiales: plan.materiales,
    proveedores: plan.proveedores,
    vendedores: plan.vendedores,
    clientes: plan.clientes,
    exhibidores: plan.exhibidores,
  };
  const pendientes = {} as Record<TipoSimple, { id: string; nombre: string; origen: Origen }[]>;
  for (const [tipo, xs] of Object.entries(simples) as [TipoSimple, (typeof simples)[TipoSimple]][]) {
    pendientes[tipo] = [];
    for (const x of xs) {
      const e = estado(x.origen);
      if (e === 'aplicado') {
        r.yaAplicados++;
        r.simplesVerificables[tipo].add(x.id);
      } else if (e === 'cambiado') r.cambiados.push({ clave: x.origen.clave, hoja: x.origen.hoja });
      else pendientes[tipo].push(x);
    }
  }
  // Una consulta por tipo; el índice único por kz_normalizar(nombre) garantiza a lo más una coincidencia.
  const tablas = {
    categorias: categoria,
    materiales: material,
    proveedores: proveedor,
    vendedores: vendedor,
  };
  for (const [tipo, tabla] of Object.entries(tablas) as [keyof typeof tablas, PgTable][]) {
    const xs = pendientes[tipo] as CatalogoPlan[];
    if (!xs.length) continue;
    const enApp = await filas<{ i: number; id: string }>(
      tx,
      sql`SELECT n.i::int AS i, t.id FROM jsonb_array_elements_text(${JSON.stringify(xs.map((x) => x.nombre))}::jsonb)
            WITH ORDINALITY n(nombre, i)
          JOIN ${tabla} t ON kz_normalizar(t.nombre) = kz_normalizar(n.nombre)`,
    );
    const porI = new Map(enApp.map((x) => [x.i - 1, x.id]));
    xs.forEach((x, i) => {
      const id = porI.get(i);
      if (id) {
        r.real.set(x.id, id);
        r.reutilizados[tipo]++;
      } else {
        r.simplesNuevos[tipo].push(x);
        r.simplesVerificables[tipo].add(x.id);
      }
    });
  }
  // Clientes: solo por llave exacta y solo clientes de la app (no los de otra clave migrada). Varios → el más viejo.
  if (pendientes.clientes.length) {
    const xs = pendientes.clientes;
    const enApp = await filas<{ i: number; id: string }>(
      tx,
      sql`SELECT n.i::int AS i, c.id FROM jsonb_array_elements_text(${JSON.stringify(xs.map((x) => x.nombre))}::jsonb)
            WITH ORDINALITY n(nombre, i)
          JOIN LATERAL (
            SELECT c.id FROM ${cliente} c
            WHERE kz_normalizar(c.nombre) = kz_normalizar(n.nombre)
              AND NOT EXISTS (SELECT 1 FROM ${origenExcel} o WHERE o.cliente_id = c.id)
            ORDER BY c.created_at, c.id LIMIT 1
          ) c ON true`,
    );
    const porI = new Map(enApp.map((x) => [x.i - 1, x.id]));
    xs.forEach((x, i) => {
      const id = porI.get(i);
      if (id) {
        r.real.set(x.id, id);
        r.reutilizados.clientes++;
      } else {
        r.simplesNuevos.clientes.push(x);
        r.simplesVerificables.clientes.add(x.id);
      }
    });
  }
  for (const x of pendientes.exhibidores) {
    r.simplesNuevos.exhibidores.push(x);
    r.simplesVerificables.exhibidores.add(x.id);
  }
  const real = (id: string) => r.real.get(id) ?? id;

  // --- Grupos: un pedido con sus piezas y su pago, o una pieza suelta. Se aplican enteros o nada.
  const piezaPorId = new Map(plan.piezas.map((p) => [p.id, p]));
  const pagosPorPedido = new Map<string, PagoPlan[]>();
  for (const g of plan.pagos) pagosPorPedido.set(g.pedidoId, [...(pagosPorPedido.get(g.pedidoId) ?? []), g]);
  const enPedido = new Set(plan.pedidos.flatMap((p) => p.items.map((i) => i.piezaId)));
  const grupos: Grupo[] = [
    ...plan.pedidos.map((p) => ({
      pedido: p,
      piezas: p.items.map((i) => piezaPorId.get(i.piezaId)!),
      pagos: pagosPorPedido.get(p.id) ?? [],
    })),
    ...plan.piezas.filter((p) => !enPedido.has(p.id)).map((p) => ({ pedido: null, piezas: [p], pagos: [] })),
  ];
  const candidatos: Grupo[] = [];
  for (const g of grupos) {
    const ms = miembros(g);
    const es = ms.map(estado);
    if (es.every((e) => e === 'aplicado')) {
      r.yaAplicados += ms.length;
      r.gruposAplicados.push(g);
    } else if (es.every((e) => e === 'nuevo')) candidatos.push(g);
    else
      ms.forEach((o, i) => {
        if (es[i] === 'aplicado') r.yaAplicados++;
        else if (es[i] === 'cambiado') r.cambiados.push({ clave: o.clave, hoja: o.hoja });
        else
          r.rechazosEnBd.push(
            rechazo(o, 'Fila nueva ligada a filas ya migradas que cambiaron: no se aplica'),
          );
      });
  }

  // Códigos de pieza que ya existen en la BD (de la app o de otra clave) → se rechaza el grupo completo.
  const codigos = candidatos.flatMap((g) => g.piezas.map((p) => p.codigo));
  const ocupados = new Set(
    codigos.length
      ? (
          await filas<{ codigo: string }>(
            tx,
            sql`SELECT codigo FROM ${pieza} WHERE codigo IN ${lista(codigos)}`,
          )
        ).map((x) => x.codigo)
      : [],
  );
  // Posiciones de tarjeta ya ocupadas (clientes reutilizados con notas de la app).
  const clientesTarjeta = [
    ...new Set(candidatos.filter((g) => g.pedido?.cuentaTarjeta).map((g) => real(g.pedido!.clienteId))),
  ];
  const posiciones = new Set(
    clientesTarjeta.length
      ? (
          await filas<{ k: string }>(
            tx,
            sql`SELECT cliente_id || ':' || ciclo_tarjeta || ':' || posicion_tarjeta AS k FROM ${pedido}
                WHERE cuenta_tarjeta AND estado <> 'cancelado' AND cliente_id IN ${listaUuid(clientesTarjeta)}`,
          )
        ).map((x) => x.k)
      : [],
  );
  const aceptados: Grupo[] = [];
  for (const g of candidatos) {
    const choca = g.piezas.filter((p) => ocupados.has(p.codigo));
    const p = g.pedido;
    const posOcupada = !!p?.cuentaTarjeta && posiciones.has(`${real(p.clienteId)}:${p.ciclo}:${p.posicion}`);
    if (!choca.length && !posOcupada) {
      aceptados.push(g);
      continue;
    }
    for (const x of choca) r.rechazosEnBd.push(rechazo(x.origen, 'Código de pieza ya existe en la app'));
    if (p)
      r.rechazosEnBd.push(
        rechazo(
          p.origen,
          posOcupada
            ? 'Posición de tarjeta ya ocupada en la app: el pedido no se importa'
            : 'Pedido con una pieza cuyo código ya existe en la app: no se importa',
        ),
      );
    for (const x of g.piezas.filter((y) => !ocupados.has(y.codigo)))
      r.rechazosEnBd.push(rechazo(x.origen, 'Pieza de un pedido rechazado: no se importa'));
  }

  // Folios: los ocupados se mueven al rango histórico, después del mayor folio existente o planeado.
  const pedidosNuevos = aceptados.filter((g) => g.pedido).map((g) => g.pedido!);
  const folios = pedidosNuevos.map((p) => String(p.folio));
  const [maxBd] = await filas<{ m: number }>(
    tx,
    sql`SELECT coalesce(max(folio), 0)::int AS m FROM ${pedido}`,
  );
  const tomados = new Set(
    folios.length
      ? (
          await filas<{ folio: number }>(
            tx,
            sql`SELECT folio FROM ${pedido} WHERE folio IN (SELECT x::int FROM jsonb_array_elements_text(${JSON.stringify(folios)}::jsonb) x)`,
          )
        ).map((x) => x.folio)
      : [],
  );
  let siguiente = Math.max(r.folioDesde - 1, maxBd!.m, ...plan.pedidos.map((p) => p.folio));
  for (const p of pedidosNuevos) {
    if (!tomados.has(p.folio)) {
      r.folio.set(p.id, p.folio);
      continue;
    }
    r.folio.set(p.id, ++siguiente);
    if (p.tipo === 'kzr') {
      r.notas.set(
        p.id,
        `Nota original KZR-${p.folio} (Excel)${p.notas ? `. ${p.notas}` : ''}`.slice(0, NOTAS_MAX),
      );
      r.rechazosEnBd.push(rechazo(p.origen, 'Folio KZR ocupado en la app: se movió al rango histórico'));
    } else r.rechazosEnBd.push(rechazo(p.origen, 'Folio histórico ocupado: se asignó el siguiente libre'));
  }
  // Folios reales de los pedidos ya aplicados (pudieron moverse en una corrida anterior).
  const aplicados = r.gruposAplicados.filter((g) => g.pedido).map((g) => g.pedido!.id);
  if (aplicados.length)
    for (const x of await filas<{ id: string; folio: number }>(
      tx,
      sql`SELECT id, folio FROM ${pedido} WHERE id IN ${listaUuid(aplicados)}`,
    ))
      r.folio.set(x.id, x.folio);
  r.gruposNuevos = aceptados;
  return r;
}

async function insertarTodo(
  tx: Ejecutor,
  plan: PlanImportacion,
  r: Resolucion,
  adminId: string,
): Promise<Record<string, number>> {
  const real = (id: string) => r.real.get(id) ?? id;
  const realN = (id: string | null) => (id === null ? null : real(id));
  const s = r.simplesNuevos;
  const porId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));
  const vend = porId(plan.vendedores);
  const cli = porId(plan.clientes);
  const exh = porId(plan.exhibidores);
  const piezas = r.gruposNuevos.flatMap((g) => g.piezas);
  const pedidos = r.gruposNuevos.filter((g) => g.pedido).map((g) => g.pedido!);
  const pagos = r.gruposNuevos.flatMap((g) => g.pagos);
  const n: Record<string, number> = {};
  const insertar = async <T extends PgTable>(nombre: string, tabla: T, valores: T['$inferInsert'][]) => {
    n[nombre] = await insertarPorLotes(tx, tabla, valores);
    if (n[nombre] !== valores.length)
      throw new ErrorVerificacion([
        `${nombre}: se esperaban ${valores.length} inserciones y hubo ${n[nombre]} (choque con datos existentes)`,
      ]);
  };
  const catalogo = (xs: { id: string; origen: Origen }[]) =>
    xs.map((x) => ({ id: x.id, nombre: (x as CatalogoPlan).nombre }));

  await insertar('categorias', categoria, catalogo(s.categorias));
  await insertar('materiales', material, catalogo(s.materiales));
  await insertar('proveedores', proveedor, catalogo(s.proveedores));
  await insertar(
    'vendedores',
    vendedor,
    s.vendedores.map((x) => {
      const v = vend.get(x.id)!;
      return { id: v.id, nombre: v.nombre, tipo: v.tipo, comisionPct: v.comisionPct, activo: true };
    }),
  );
  await insertar(
    'clientes',
    cliente,
    s.clientes.map((x) => {
      const c = cli.get(x.id)!;
      return {
        id: c.id,
        nombre: c.nombre,
        referencia: c.referencia,
        cumpleanos: c.cumpleanos,
        redSocial: c.redSocial,
        usuarioRed: c.usuarioRed,
        vendedorHabitualId: realN(c.vendedorHabitualId),
        notas: c.notas,
      };
    }),
  );
  await insertar(
    'exhibidores',
    exhibidor,
    s.exhibidores.map((x) => {
      const e = exh.get(x.id)!;
      return { id: e.id, vendedorId: real(e.vendedorId), nombre: e.nombre, fechaEnvio: e.fechaEnvio };
    }),
  );
  // La pieza nace en su estado final (sin UPDATE: no pasa por pieza_transicion, D-2).
  await insertar(
    'piezas',
    pieza,
    piezas.map((p) => ({
      id: p.id,
      codigo: p.codigo,
      categoriaId: real(p.categoriaId),
      materialId: realN(p.materialId),
      proveedorId: realN(p.proveedorId),
      descripcion: p.descripcion,
      costo: dinero(p.costo),
      precio: dinero(p.precio),
      fechaAlta: p.fechaAlta,
      estado: p.estado,
      exhibidorId: p.exhibidorId,
    })),
  );
  await insertar(
    'pedidos',
    pedido,
    pedidos.map((p) => ({
      id: p.id,
      folio: r.folio.get(p.id)!,
      clienteId: real(p.clienteId),
      vendedorId: real(p.vendedorId),
      fecha: p.fecha,
      estado: p.estado,
      cuentaTarjeta: p.cuentaTarjeta,
      cicloTarjeta: p.ciclo,
      posicionTarjeta: p.posicion,
      descuentoLealtadPct: '0',
      descuentoManualMonto: dinero(p.descuentoManual),
      descuentoManualMotivo: p.descuentoManualMotivo,
      total: dinero(p.total),
      notas: r.notas.get(p.id) ?? p.notas,
      liquidadoAt: p.liquidadoEn ? new Date(p.liquidadoEn) : null,
      adminId,
    })),
  );
  await insertar(
    'items',
    pedidoItem,
    pedidos.flatMap((p) =>
      p.items.map((i) => ({
        pedidoId: p.id,
        piezaId: i.piezaId,
        precioLista: dinero(i.precioLista),
        precioFinal: dinero(i.precioFinal),
      })),
    ),
  );
  // Un `alta` por pieza, después de pieza y pedido (FK y trigger movimiento_pieza_coherente).
  await insertar(
    'movimientos',
    movimientoPieza,
    piezas.map((p) => ({
      piezaId: p.id,
      tipo: 'alta' as const,
      deEstado: null,
      aEstado: p.estado,
      exhibidorId: p.estado === 'en_exhibidor' || p.estado === 'apartada' ? p.exhibidorId : null,
      pedidoId: p.pedidoId,
      adminId,
      nota: p.notaMovimiento,
      fecha: mediodiaMX(p.fechaMovimiento),
    })),
  );
  await insertar(
    'pagos',
    pago,
    pagos.map((g) => ({
      id: g.id,
      idempotencyKey: g.idempotencyKey,
      fecha: g.fecha,
      monto: dinero(g.monto),
      metodo: 'otro' as const,
      pagadorClienteId: realN(g.pagadorClienteId),
      pagadorVendedorId: realN(g.pagadorVendedorId),
      nota: g.nota,
      adminId,
    })),
  );
  await insertar(
    'aplicaciones',
    aplicacionPago,
    pagos.map((g) => ({ pagoId: g.id, pedidoId: g.pedidoId, monto: dinero(g.monto), fecha: g.fecha })),
  );
  const origen = (
    fk: keyof Pick<
      typeof origenExcel.$inferInsert,
      | 'categoriaId'
      | 'materialId'
      | 'proveedorId'
      | 'vendedorId'
      | 'clienteId'
      | 'exhibidorId'
      | 'piezaId'
      | 'pedidoId'
      | 'pagoId'
    >,
    xs: { id: string; origen: Origen }[],
  ) =>
    xs.map((x) => ({
      lote: plan.lote,
      clave: x.origen.clave,
      hoja: x.origen.hoja,
      filas: x.origen.filas,
      hashContenido: x.origen.hash,
      datos: x.origen.datos ?? {},
      [fk]: x.id,
    }));
  await insertar('origen', origenExcel, [
    ...origen('categoriaId', s.categorias),
    ...origen('materialId', s.materiales),
    ...origen('proveedorId', s.proveedores),
    ...origen('vendedorId', s.vendedores),
    ...origen('clienteId', s.clientes),
    ...origen('exhibidorId', s.exhibidores),
    ...origen('piezaId', piezas),
    ...origen('pedidoId', pedidos),
    ...origen('pagoId', pagos),
  ]);
  return n;
}

/** D-8: la siguiente nota de la app sigue a la última KZR (o a la última de la app, si es mayor). */
async function siguienteFolioEsperado(tx: Ejecutor, desde: number): Promise<number> {
  const [x] = await filas<{ m: number }>(
    tx,
    sql`SELECT coalesce(max(folio), 0)::int AS m FROM ${pedido} WHERE folio < ${desde}`,
  );
  return x!.m + 1;
}

/**
 * setval NO se deshace con ROLLBACK: por eso va al final, solo en `aplicar` y solo con la verificación ya correcta.
 * Devuelve el siguiente folio que entregará la secuencia.
 */
async function fijarSecuenciaFolio(tx: Ejecutor, esperado: number): Promise<number> {
  const m = esperado - 1;
  await tx.execute(
    sql`SELECT setval(pg_get_serial_sequence('pedido', 'folio'), GREATEST(${m}::int, 1), ${m}::int >= 1)`,
  );
  const [s] = await filas<{ last_value: string; is_called: boolean }>(
    tx,
    sql`SELECT last_value::text AS last_value, is_called FROM pedido_folio_seq`,
  );
  return Number(s!.last_value) + (s!.is_called ? 1 : 0);
}

/**
 * Huella de las decisiones tomadas contra la BD (reutilizados, folios, rechazos, cambiados, conteos), atada al
 * destino y al hash del plan: `aplicar` exige la misma huella que dio el `ensayo` contra ese destino.
 */
function huellaDecisiones(
  r: Resolucion,
  insertados: Record<string, number>,
  siguienteFolio: number,
  contexto: ContextoAplicacion | undefined,
): string {
  const orden = <T>(xs: [string, T][]) => xs.sort((a, b) => a[0].localeCompare(b[0]));
  return hashPlan({
    contexto: contexto ?? null,
    reutilizados: orden([...r.real]),
    folios: orden(
      r.gruposNuevos.filter((g) => g.pedido).map((g) => [g.pedido!.id, r.folio.get(g.pedido!.id)!]),
    ),
    notasMovidas: [...r.notas.keys()].sort(),
    rechazosEnBd: r.rechazosEnBd,
    cambiados: r.cambiados,
    yaAplicados: r.yaAplicados,
    conteoReutilizados: r.reutilizados,
    insertados,
    siguienteFolio,
  });
}

/** Las cifras de la conciliación del plan, quitando lo que no quedó en la BD como el plan lo describe. */
function esperado(plan: PlanImportacion, r: Resolucion) {
  const c = plan.conciliacion;
  const real = (id: string) => r.real.get(id) ?? id;
  const quedan = [...r.gruposAplicados, ...r.gruposNuevos];
  const vPiezas = new Set(quedan.flatMap((g) => g.piezas.map((p) => p.id)));
  const vPedidos = new Set(quedan.filter((g) => g.pedido).map((g) => g.pedido!.id));
  const vPagos = new Set(quedan.flatMap((g) => g.pagos.map((p) => p.id)));
  const fuera = {
    piezas: plan.piezas.filter((p) => !vPiezas.has(p.id)),
    pedidos: plan.pedidos.filter((p) => !vPedidos.has(p.id)),
    pagos: plan.pagos.filter((p) => !vPagos.has(p.id)),
  };
  const pagado = new Map<string, number>();
  for (const g of plan.pagos) pagado.set(g.pedidoId, (pagado.get(g.pedidoId) ?? 0) + g.monto);
  const sv = r.simplesVerificables;
  const conteos: Record<string, number> = { ...c.conteos };
  for (const k of Object.keys(sv) as TipoSimple[])
    conteos[k] = c.conteos[k] - simplesDe(plan, k).filter((x) => !sv[k].has(x.id)).length;
  conteos.piezas = c.conteos.piezas - fuera.piezas.length;
  conteos.pedidos = c.conteos.pedidos - fuera.pedidos.length;
  conteos.items = c.conteos.items - fuera.pedidos.reduce((a, p) => a + p.items.length, 0);
  conteos.pagos = c.conteos.pagos - fuera.pagos.length;

  const piezasPorEstado: Record<string, number> = { ...c.piezasPorEstado };
  for (const p of fuera.piezas) piezasPorEstado[p.estado]!--;
  const porMes = new Map(c.porMes.map((m) => [m.mes, { ...m }]));
  const saldoCliente = new Map<string, number>();
  for (const s of c.saldoPorCliente) saldoCliente.set(s.clienteId, s.saldo);
  let saldoTotal = c.saldoTotal;
  const posFuera = new Set<string>();
  for (const p of fuera.pedidos) {
    const m = porMes.get(p.fecha.slice(0, 7));
    const pg = pagado.get(p.id) ?? 0;
    if (m) {
      m.pedidos--;
      m.total -= p.total;
      m.pagado -= pg;
      m.saldo -= p.total - pg;
    }
    if (p.total > pg) {
      saldoCliente.set(p.clienteId, (saldoCliente.get(p.clienteId) ?? 0) - (p.total - pg));
      saldoTotal -= p.total - pg;
    }
    if (p.cuentaTarjeta) posFuera.add(`${p.clienteId}:${p.ciclo}:${p.posicion}`);
  }
  // Folio real por folio del plan (los folios del plan son únicos).
  const folioReal = new Map(plan.pedidos.map((p) => [p.folio, r.folio.get(p.id) ?? p.folio]));
  const exhFuera = new Map<string, number>();
  for (const p of fuera.piezas)
    if (p.exhibidorId) exhFuera.set(p.exhibidorId, (exhFuera.get(p.exhibidorId) ?? 0) + 1);
  return {
    vPiezas: [...vPiezas],
    vPedidos: [...vPedidos],
    vPagos: [...vPagos],
    vSimples: Object.fromEntries((Object.keys(sv) as TipoSimple[]).map((k) => [k, [...sv[k]]])) as Record<
      TipoSimple,
      string[]
    >,
    conteos,
    piezasPorEstado,
    porMes: [...porMes.values()].filter((m) => m.pedidos > 0),
    saldoTotal,
    saldoPorCliente: new Map(
      [...saldoCliente].filter(([, s]) => s > 0).map(([id, s]) => [real(id), s] as const),
    ),
    tarjeta: c.tarjeta
      .filter((t) => !posFuera.has(`${t.clienteId}:${t.ciclo}:${t.posicion}`))
      .map((t) => `${real(t.clienteId)}:${t.ciclo}:${t.posicion}:${t.estado}:${folioReal.get(t.folio)}`)
      .sort(),
    exhibidores: new Map(
      c.exhibidores
        .filter((e) => sv.exhibidores.has(e.exhibidorId))
        .map((e) => [e.exhibidorId, e.piezas - (exhFuera.get(e.exhibidorId) ?? 0)] as const)
        .filter(([, n]) => n > 0),
    ),
  };
}

function simplesDe(plan: PlanImportacion, k: TipoSimple): { id: string }[] {
  return plan[k];
}

/** D-4: consultas agregadas (sin N+1) contra tablas y vistas; cualquier diferencia → ROLLBACK. */
async function verificar(tx: Ejecutor, plan: PlanImportacion, r: Resolucion): Promise<VerificacionBd> {
  const e = esperado(plan, r);
  const dif: string[] = [];
  const comparar = (que: string, plan: number, bd: number) => {
    if (plan !== bd) dif.push(`${que}: plan ${plan}, BD ${bd}`);
  };
  const ids = (xs: string[]) => listaUuid(xs);
  const [n] = await filas<Record<string, number>>(
    tx,
    sql`SELECT
      (SELECT count(*) FROM ${categoria} WHERE id IN ${ids(e.vSimples.categorias)})::int AS categorias,
      (SELECT count(*) FROM ${material} WHERE id IN ${ids(e.vSimples.materiales)})::int AS materiales,
      (SELECT count(*) FROM ${proveedor} WHERE id IN ${ids(e.vSimples.proveedores)})::int AS proveedores,
      (SELECT count(*) FROM ${vendedor} WHERE id IN ${ids(e.vSimples.vendedores)})::int AS vendedores,
      (SELECT count(*) FROM ${cliente} WHERE id IN ${ids(e.vSimples.clientes)})::int AS clientes,
      (SELECT count(*) FROM ${exhibidor} WHERE id IN ${ids(e.vSimples.exhibidores)})::int AS exhibidores,
      (SELECT count(*) FROM ${pieza} WHERE id IN ${ids(e.vPiezas)})::int AS piezas,
      (SELECT count(*) FROM ${pedido} WHERE id IN ${ids(e.vPedidos)})::int AS pedidos,
      (SELECT count(*) FROM ${pedidoItem} WHERE pedido_id IN ${ids(e.vPedidos)})::int AS items,
      (SELECT count(*) FROM ${pago} WHERE id IN ${ids(e.vPagos)})::int AS pagos,
      (SELECT count(*) FROM ${origenExcel} WHERE lote = ${plan.lote}
         AND coalesce(categoria_id, material_id, proveedor_id, vendedor_id, cliente_id, exhibidor_id, pieza_id,
                      pedido_id, pago_id) IN ${ids([...Object.values(e.vSimples).flat(), ...e.vPiezas, ...e.vPedidos, ...e.vPagos])})::int AS origen,
      (SELECT count(*) FROM ${pieza} p WHERE p.id IN ${ids(e.vPiezas)} AND (
         SELECT count(*) FROM ${movimientoPieza} m WHERE m.pieza_id = p.id AND m.tipo = 'alta' AND m.a_estado = p.estado
       ) <> 1)::int AS historia_incoherente`,
  );
  for (const [k, v] of Object.entries(e.conteos)) comparar(`conteo ${k}`, v, n![k]!);
  const origenEsperado =
    Object.values(e.vSimples).reduce((a, x) => a + x.length, 0) +
    e.vPiezas.length +
    e.vPedidos.length +
    e.vPagos.length;
  comparar('filas de origen_excel', origenEsperado, n!.origen!);
  comparar('piezas sin un alta coherente con su estado', 0, n!.historia_incoherente!);

  const estados = await filas<{ estado: string; n: number }>(
    tx,
    sql`SELECT estado::text, count(*)::int AS n FROM ${pieza} WHERE id IN ${ids(e.vPiezas)} GROUP BY estado`,
  );
  const enBd = new Map(estados.map((x) => [x.estado, x.n]));
  for (const [k, v] of Object.entries(e.piezasPorEstado)) comparar(`piezas ${k}`, v, enBd.get(k) ?? 0);

  const meses = await filas<{ mes: string; pedidos: number; total: string; pagado: string; saldo: string }>(
    tx,
    sql`SELECT to_char(fecha, 'YYYY-MM') AS mes, count(*)::int AS pedidos, sum(total)::text AS total,
               sum(pagado)::text AS pagado, sum(saldo)::text AS saldo
        FROM v_pedido WHERE id IN ${ids(e.vPedidos)} GROUP BY 1`,
  );
  const mesBd = new Map(meses.map((m) => [m.mes, m]));
  for (const m of e.porMes) {
    const b = mesBd.get(m.mes);
    comparar(`${m.mes} pedidos`, m.pedidos, b?.pedidos ?? 0);
    comparar(`${m.mes} total`, m.total, b ? numericACentavos(b.total) : 0);
    comparar(`${m.mes} pagado`, m.pagado, b ? numericACentavos(b.pagado) : 0);
    comparar(`${m.mes} saldo`, m.saldo, b ? numericACentavos(b.saldo) : 0);
  }
  for (const m of meses)
    if (!e.porMes.some((x) => x.mes === m.mes)) dif.push(`${m.mes}: mes que el plan no tiene`);

  const saldos = await filas<{ cliente_id: string; saldo: string }>(
    tx,
    sql`SELECT cliente_id, sum(saldo)::text AS saldo FROM v_pedido WHERE id IN ${ids(e.vPedidos)}
        GROUP BY cliente_id HAVING sum(saldo) > 0`,
  );
  const saldoBd = new Map(saldos.map((x) => [x.cliente_id, numericACentavos(x.saldo)]));
  comparar(
    'Σ saldo',
    e.saldoTotal,
    [...saldoBd.values()].reduce((a, x) => a + x, 0),
  );
  for (const id of new Set([...e.saldoPorCliente.keys(), ...saldoBd.keys()]))
    comparar(`saldo del cliente ${id}`, e.saldoPorCliente.get(id) ?? 0, saldoBd.get(id) ?? 0);

  const tarjeta = (
    await filas<{ k: string }>(
      tx,
      sql`SELECT cliente_id || ':' || ciclo_tarjeta || ':' || posicion_tarjeta || ':' || estado || ':' || folio AS k
          FROM ${pedido} WHERE cuenta_tarjeta AND id IN ${ids(e.vPedidos)}`,
    )
  )
    .map((x) => x.k)
    .sort();
  const distintas =
    e.tarjeta.filter((t) => !tarjeta.includes(t)).length +
    tarjeta.filter((t) => !e.tarjeta.includes(t)).length;
  if (distintas)
    dif.push(`tarjeta: plan ${e.tarjeta.length} posiciones, BD ${tarjeta.length}, ${distintas} distintas`);

  const vExh = await filas<{ id: string; n: number }>(
    tx,
    sql`SELECT id, (piezas_actuales + piezas_apartadas)::int AS n FROM v_exhibidor
        WHERE id IN ${ids(e.vSimples.exhibidores)}`,
  );
  const exhBd = new Map(vExh.filter((x) => x.n > 0).map((x) => [x.id, x.n]));
  for (const id of new Set([...e.exhibidores.keys(), ...exhBd.keys()]))
    comparar(`piezas del exhibidor ${id}`, e.exhibidores.get(id) ?? 0, exhBd.get(id) ?? 0);

  return { ok: dif.length === 0, diferencias: dif };
}

export interface ContextoAplicacion {
  /** `host/base` normalizado del destino (sin credenciales). */
  destino: string;
  hashPlan: string;
}

export async function aplicarPlan(
  urlOwner: string,
  plan: PlanImportacion,
  o: { modo: 'ensayo' | 'aplicar'; contexto?: ContextoAplicacion; huellaEsperada?: string },
): Promise<ResultadoBd> {
  try {
    return await conDbUrl(urlOwner, (db) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
        await tx.execute(sql`SET LOCAL statement_timeout = '120s'`);
        await tx.execute(sql`LOCK TABLE pieza, pedido, pago, cliente, exhibidor IN SHARE ROW EXCLUSIVE MODE`);
        const adminId = await asegurarAdminMigracion(tx);
        await fijarContextoAuditoria(tx, { adminId, motivo: MOTIVO_MIGRACION });
        const r = await resolver(tx, plan);
        const insertados = await insertarTodo(tx, plan, r, adminId);
        const siguienteFolio = await siguienteFolioEsperado(tx, r.folioDesde);
        const verificacion = await verificar(tx, plan, r);
        const resultado: ResultadoBd = {
          modo: o.modo,
          insertados,
          yaAplicados: r.yaAplicados,
          cambiados: r.cambiados,
          reutilizados: r.reutilizados,
          rechazosEnBd: r.rechazosEnBd,
          verificacion,
          siguienteFolio,
          huella: huellaDecisiones(r, insertados, siguienteFolio, o.contexto),
        };
        if (!verificacion.ok) throw new ErrorVerificacion(verificacion.diferencias, resultado);
        if (o.huellaEsperada !== undefined && o.huellaEsperada !== resultado.huella)
          throw new ErrorEnsayoDistinto();
        if (o.modo === 'ensayo') throw new RollbackIntencional(resultado);
        const deLaSecuencia = await fijarSecuenciaFolio(tx, siguienteFolio);
        if (deLaSecuencia !== siguienteFolio)
          throw new ErrorVerificacion(
            [`siguiente folio: plan ${siguienteFolio}, secuencia ${deLaSecuencia}`],
            resultado,
          );
        return resultado;
      }),
    );
  } catch (e) {
    if (e instanceof RollbackIntencional) return e.resultado;
    throw e;
  }
}
