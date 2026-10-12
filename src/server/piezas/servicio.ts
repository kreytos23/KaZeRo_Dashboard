import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { Ejecutor } from '@/db/pool';
import { movimientoPieza, pieza, vMovimientoPieza, vPieza } from '@/db/schema';
import { esCodigoValido, esPrefijoValido, normalizarCodigo, siguienteCodigo } from '@/domain/codigos';
import { calcularCambios } from '@/domain/auditoria';
import { centavosANumeric } from '@/domain/dinero';
import { hoyMX, parsearFechaISO } from '@/domain/fechas';
import { MAX_FILAS_LOTE, type FilaLote } from '@/domain/lote';
import { escaparLike, normalizar } from '@/domain/texto';
import { fijarContextoAuditoria, motivoPara } from '@/server/auditoria/servicio';
import { obtenerOCrearCatalogo, resolverCatalogos } from '@/server/catalogos/servicio';
import { ErrorNegocio, conErroresDeNegocio, conflictoVersion } from '@/server/errores';

export type EstadoPieza = (typeof pieza.$inferSelect)['estado'];
export const ESTADOS_MANUALES = ['regalo', 'defecto', 'guardada', 'disponible'] as const;
export type EstadoManual = (typeof ESTADOS_MANUALES)[number];

export interface DatosPieza {
  codigo: string;
  categoria: string;
  material?: string | null;
  proveedor?: string | null;
  descripcion: string;
  costoCentavos: number;
  precioCentavos: number;
  fechaAlta?: string;
}

// Lecturas por la vista v_pieza (ya trae los nombres de catálogo y exhibidor: sin consultas por fila).
const filaPieza = {
  id: vPieza.id,
  codigo: vPieza.codigo,
  descripcion: vPieza.descripcion,
  precio: vPieza.precio,
  estado: vPieza.estado,
  categoriaNombre: vPieza.categoriaNombre,
  exhibidorId: vPieza.exhibidorId,
};
export type PiezaFila = {
  id: string;
  codigo: string;
  descripcion: string;
  precio: string;
  estado: EstadoPieza;
  categoriaNombre: string;
  exhibidorId: string | null;
};

export async function sugerirCodigo(db: Ejecutor, prefijo: string): Promise<string> {
  const p = normalizarCodigo(prefijo);
  if (!esPrefijoValido(p))
    throw new ErrorNegocio('prefijo_invalido', 'El prefijo debe tener de 1 a 6 letras.');
  const filas = await db
    .select({ codigo: vPieza.codigo })
    .from(vPieza)
    .where(sql`${vPieza.codigo} ~ ${'^' + p + '[0-9]+$'}`);
  return siguienteCodigo(
    p,
    filas.map((f) => f.codigo),
  );
}

function descripcionValida(texto: string): string {
  const descripcion = texto.trim();
  if (!descripcion || descripcion.length > 300)
    throw new ErrorNegocio(
      'pieza_invalida',
      'La descripción debe tener entre 1 y 300 caracteres.',
      'descripcion',
    );
  return descripcion;
}

function validarPieza(d: DatosPieza) {
  const codigo = normalizarCodigo(d.codigo);
  if (!esCodigoValido(codigo))
    throw new ErrorNegocio(
      'pieza_codigo_formato',
      'El código solo admite letras, números y guiones (máx. 20).',
      'codigo',
    );
  const descripcion = descripcionValida(d.descripcion);
  const fechaAlta = d.fechaAlta ? parsearFechaISO(d.fechaAlta) : hoyMX();
  if (!fechaAlta) throw new ErrorNegocio('pieza_invalida', 'La fecha de alta no es válida.');
  return {
    codigo,
    descripcion,
    fechaAlta,
    costo: centavosANumeric(d.costoCentavos),
    precio: centavosANumeric(d.precioCentavos),
  };
}

export interface EdicionPieza {
  piezaId: string;
  version: number;
  adminId: string;
  motivo?: string | null;
  categoria: string;
  material?: string | null;
  proveedor?: string | null;
  descripcion: string;
  costoCentavos: number;
  precioCentavos: number;
}

// D4: el pedido ya fijó el precio (precio_lista, R-11). El costo sí se puede corregir, con motivo.
const PRECIO_FIJADO_POR_PEDIDO: readonly EstadoPieza[] = ['apartada', 'vendida'];

/**
 * Edita todo menos el código (inmutable por grants) y la fecha de alta. La bitácora la escribe el trigger
 * kz_auditar; aquí se calcula el diff antes de escribir para no tocar nada en un no-op y para dar el error
 * de motivo junto al campo.
 */
export async function editarPieza(
  db: Ejecutor,
  d: EdicionPieza,
): Promise<{ cambios: number; codigo: string }> {
  const descripcion = descripcionValida(d.descripcion);
  const costo = centavosANumeric(d.costoCentavos);
  const precio = centavosANumeric(d.precioCentavos);
  return conErroresDeNegocio(() =>
    db.transaction(async (tx) => {
      const [actual] = await tx
        .select({
          codigo: pieza.codigo,
          estado: pieza.estado,
          version: pieza.version,
          descripcion: pieza.descripcion,
          categoriaId: pieza.categoriaId,
          materialId: pieza.materialId,
          proveedorId: pieza.proveedorId,
          costo: pieza.costo,
          precio: pieza.precio,
        })
        .from(pieza)
        .where(eq(pieza.id, d.piezaId))
        .for('update');
      if (!actual) throw new ErrorNegocio('no_encontrada', 'La pieza no existe.');
      if (actual.version !== d.version) throw conflictoVersion();
      // Mismo criterio que el alta: reutiliza el catálogo existente (normalizado) o lo crea.
      const categoriaId = await obtenerOCrearCatalogo(tx, 'categoria', d.categoria);
      const materialId = d.material?.trim() ? await obtenerOCrearCatalogo(tx, 'material', d.material) : null;
      const proveedorId = d.proveedor?.trim()
        ? await obtenerOCrearCatalogo(tx, 'proveedor', d.proveedor)
        : null;
      const cambios = calcularCambios(
        {
          descripcion: actual.descripcion,
          categoria_id: actual.categoriaId,
          material_id: actual.materialId,
          proveedor_id: actual.proveedorId,
          costo: actual.costo,
          precio: actual.precio,
        },
        {
          descripcion,
          categoria_id: categoriaId,
          material_id: materialId,
          proveedor_id: proveedorId,
          costo,
          precio,
        },
      );
      if (cambios.length === 0) return { cambios: 0, codigo: actual.codigo };
      if (cambios.some((c) => c.campo === 'precio') && PRECIO_FIJADO_POR_PEDIDO.includes(actual.estado))
        throw new ErrorNegocio(
          'pieza_precio_bloqueado',
          'No se puede cambiar el precio de una pieza apartada o vendida: su pedido ya lo fijó.',
          'precio',
        );
      await fijarContextoAuditoria(tx, {
        adminId: d.adminId,
        motivo: motivoPara('pieza', cambios, d.motivo),
      });
      await tx
        .update(pieza)
        .set({
          descripcion,
          categoriaId,
          materialId,
          proveedorId,
          costo,
          precio,
          version: sql`${pieza.version} + 1`,
        })
        .where(and(eq(pieza.id, d.piezaId), eq(pieza.version, d.version)));
      return { cambios: cambios.length, codigo: actual.codigo };
    }),
  );
}

export async function altaPieza(db: Ejecutor, d: DatosPieza): Promise<{ id: string; codigo: string }> {
  const v = validarPieza(d);
  return conErroresDeNegocio(() =>
    db.transaction(async (tx) => {
      const categoriaId = await obtenerOCrearCatalogo(tx, 'categoria', d.categoria);
      const materialId = d.material?.trim() ? await obtenerOCrearCatalogo(tx, 'material', d.material) : null;
      const proveedorId = d.proveedor?.trim()
        ? await obtenerOCrearCatalogo(tx, 'proveedor', d.proveedor)
        : null;
      const [p] = await tx
        .insert(pieza)
        .values({ ...v, categoriaId, materialId, proveedorId })
        .returning({ id: pieza.id, codigo: pieza.codigo });
      await tx.insert(movimientoPieza).values({ piezaId: p!.id, tipo: 'alta', aEstado: 'disponible' });
      return p!;
    }),
  );
}

/**
 * Todo o nada y sin N+1: una consulta para los códigos existentes, dos por cada tipo de catálogo,
 * un INSERT de piezas y un INSERT de movimientos, sin importar cuántas filas traiga el lote.
 */
export async function altaLote(db: Ejecutor, filas: FilaLote[]): Promise<{ creadas: number }> {
  if (filas.length === 0) throw new ErrorNegocio('lote_vacio', 'El lote no tiene piezas.');
  if (filas.length > MAX_FILAS_LOTE)
    throw new ErrorNegocio('lote', `Máximo ${MAX_FILAS_LOTE} piezas por lote.`);
  const validas = filas.map((f) => ({ fila: f, v: validarPieza(f) }));
  return conErroresDeNegocio(() =>
    db.transaction(async (tx) => {
      // Flujo de escritura: verificación contra la tabla justo antes de insertar.
      const existentes = await tx
        .select({ codigo: pieza.codigo })
        .from(pieza)
        .where(
          inArray(
            pieza.codigo,
            validas.map((x) => x.v.codigo),
          ),
        );
      if (existentes.length) {
        const repetidos = new Set(existentes.map((e) => e.codigo));
        throw new ErrorNegocio(
          'pieza_codigo_uq',
          validas
            .filter((x) => repetidos.has(x.v.codigo))
            .map((x) => `Línea ${x.fila.linea}: ya existe una pieza con el código ${x.v.codigo}.`)
            .join('\n'),
        );
      }
      const [categorias, materiales, proveedores] = [
        await resolverCatalogos(
          tx,
          'categoria',
          filas.map((f) => f.categoria),
        ),
        await resolverCatalogos(
          tx,
          'material',
          filas.flatMap((f) => (f.material ? [f.material] : [])),
        ),
        await resolverCatalogos(
          tx,
          'proveedor',
          filas.flatMap((f) => (f.proveedor ? [f.proveedor] : [])),
        ),
      ];
      const idDe = (m: Map<string, string>, nombre: string | null) =>
        nombre ? (m.get(normalizar(nombre)) ?? null) : null;
      const valores = validas.map(({ fila, v }) => {
        const categoriaId = idDe(categorias, fila.categoria);
        if (!categoriaId)
          throw new ErrorNegocio('lote', `Línea ${fila.linea}: no se pudo asignar la categoría.`);
        // Con texto pero sin id (p. ej. normalización distinta en JS y en Postgres): mejor abortar que guardar vacío.
        const materialId = idDe(materiales, fila.material);
        if (fila.material && !materialId)
          throw new ErrorNegocio('lote', `Línea ${fila.linea}: no se pudo asignar el material.`);
        const proveedorId = idDe(proveedores, fila.proveedor);
        if (fila.proveedor && !proveedorId)
          throw new ErrorNegocio('lote', `Línea ${fila.linea}: no se pudo asignar el proveedor.`);
        return { ...v, categoriaId, materialId, proveedorId };
      });
      const insertadas = await tx.insert(pieza).values(valores).returning({ id: pieza.id });
      await tx
        .insert(movimientoPieza)
        .values(
          insertadas.map((p) => ({ piezaId: p.id, tipo: 'alta' as const, aEstado: 'disponible' as const })),
        );
      return { creadas: insertadas.length };
    }),
  );
}

// Pares (estado actual → destino) permitidos de forma manual; el resto pasa por pedidos, ventas o exhibidores.
const PARES_MANUALES: Record<string, readonly EstadoManual[]> = {
  disponible: ['regalo', 'defecto', 'guardada'],
  en_exhibidor: ['regalo', 'defecto', 'guardada'],
  defecto: ['disponible'],
  guardada: ['disponible'],
};

export async function cambiarEstado(
  db: Ejecutor,
  d: { piezaId: string; version: number; aEstado: EstadoManual; nota?: string },
): Promise<void> {
  if (!ESTADOS_MANUALES.includes(d.aEstado)) {
    throw new ErrorNegocio('pieza_transicion', 'Ese cambio de estado no está permitido para la pieza.');
  }
  const nota = d.nota?.trim() || null;
  return conErroresDeNegocio(() =>
    db.transaction(async (tx) => {
      const [actual] = await tx
        .select({ estado: pieza.estado, version: pieza.version, exhibidorId: pieza.exhibidorId })
        .from(pieza)
        .where(eq(pieza.id, d.piezaId))
        .for('update');
      if (!actual) throw new ErrorNegocio('no_encontrada', 'La pieza no existe.');
      if (actual.version !== d.version) throw conflictoVersion();
      if (!PARES_MANUALES[actual.estado]?.includes(d.aEstado)) {
        throw new ErrorNegocio('pieza_transicion', 'Ese cambio de estado no está permitido para la pieza.');
      }
      await tx
        .update(pieza)
        .set({
          estado: d.aEstado,
          // Al salir de un exhibidor por regalo/defecto/guardada deja de estar ligada a él.
          exhibidorId: actual.estado === 'en_exhibidor' ? null : undefined,
          version: sql`${pieza.version} + 1`,
        })
        .where(and(eq(pieza.id, d.piezaId), eq(pieza.version, d.version)));
      await tx.insert(movimientoPieza).values({
        piezaId: d.piezaId,
        tipo: 'cambio_estado',
        deEstado: actual.estado,
        aEstado: d.aEstado,
        exhibidorId: actual.estado === 'en_exhibidor' ? actual.exhibidorId : null,
        nota,
      });
    }),
  );
}

export async function obtenerPiezaPorCodigo(db: Ejecutor, codigo: string) {
  const [f] = await db
    .select()
    .from(vPieza)
    .where(eq(vPieza.codigo, normalizarCodigo(codigo)))
    .limit(1);
  return f ?? null;
}
export type FichaPieza = NonNullable<Awaited<ReturnType<typeof obtenerPiezaPorCodigo>>>;

export function historial(db: Ejecutor, piezaId: string) {
  return db
    .select({
      id: vMovimientoPieza.id,
      tipo: vMovimientoPieza.tipo,
      deEstado: vMovimientoPieza.deEstado,
      aEstado: vMovimientoPieza.aEstado,
      nota: vMovimientoPieza.nota,
      fecha: vMovimientoPieza.fecha,
      exhibidorNombre: vMovimientoPieza.exhibidorNombre,
    })
    .from(vMovimientoPieza)
    .where(eq(vMovimientoPieza.piezaId, piezaId))
    .orderBy(desc(vMovimientoPieza.orden));
}
export type MovimientoFila = Awaited<ReturnType<typeof historial>>[number];

export function listarPiezas(
  db: Ejecutor,
  o: { q?: string; estado?: EstadoPieza; categoriaId?: string; limite?: number; offset?: number } = {},
): Promise<PiezaFila[]> {
  const q = normalizar(o.q ?? '');
  const filtros = [
    q
      ? or(
          sql`${vPieza.codigo} LIKE ${escaparLike(normalizarCodigo(q)) + '%'} ESCAPE '\\'`,
          sql`kz_normalizar(${vPieza.descripcion}) LIKE ${'%' + escaparLike(q) + '%'} ESCAPE '\\'`,
        )
      : undefined,
    o.estado ? eq(vPieza.estado, o.estado) : undefined,
    o.categoriaId ? eq(vPieza.categoriaId, o.categoriaId) : undefined,
  ];
  return db
    .select(filaPieza)
    .from(vPieza)
    .where(and(...filtros))
    .orderBy(asc(vPieza.codigo))
    .limit(Math.min(Math.max(Math.trunc(o.limite ?? 50), 1), 200))
    .offset(Math.max(Math.trunc(o.offset ?? 0), 0));
}
