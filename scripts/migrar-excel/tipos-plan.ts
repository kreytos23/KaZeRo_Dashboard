import { z } from 'zod';
import { llaveNombre } from './llave';
import type { Libro } from './tipos';

/** Clases de estatus del Concentrado (clasificación local en el mapeo). */
export const CLASES_ESTATUS = [
  'vendido',
  'por_cobrar',
  'no_cobrado',
  'regalo',
  'rifa',
  'exhibidor',
  'defecto',
  'guardado',
  'disponible',
  'ignorar',
] as const;
export type ClaseEstatus = (typeof CLASES_ESTATUS)[number];

const llavesNormalizadas = <T>(r: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [llaveNombre(k), v]));

/** Mapeo local (`docs/migracion/mapeo.json`, ignorado por git). Las llaves de los registros se normalizan al leer. */
export const esquemaMapeo = z
  .object({
    lote: z.string().regex(/^[a-z0-9-]{1,40}$/),
    fechaCorte: z.iso.date(),
    vendedores: z
      .array(
        z.object({
          nombre: z.string().min(1).max(80),
          tipo: z.enum(['casa', 'revendedora', 'consignacion']),
          comisionPct: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/),
          alias: z.array(z.string()).default([]),
        }),
      )
      .refine(
        (v) => v.filter((x) => x.tipo === 'casa').length === 1,
        'Debe haber exactamente un vendedor casa',
      ),
    proveedores: z.record(z.string(), z.string().nullable()),
    categoriasPorPalabra: z.record(z.string(), z.string()),
    categoriaSinDato: z.string().min(1).max(80),
    estatus: z.record(z.string(), z.enum(CLASES_ESTATUS)),
    /** Ubicación del inventario que no es un exhibidor (llave normalizada → estado de la pieza). */
    ubicaciones: z
      .record(z.string(), z.enum(['disponible', 'defecto', 'guardada']))
      .default({ kazero: 'disponible', defecto: 'defecto' }),
    exhibidores: z.array(
      z.object({
        texto: z.string(),
        vendedor: z.string(),
        fechaEnvio: z.iso.date(),
        nombre: z.string().min(1).max(120),
      }),
    ),
    fusiones: z.array(z.array(z.string()).min(2)).default([]),
    noFusionar: z.array(z.array(z.string()).min(2)).default([]),
    clienteSinNombre: z.string().min(1).max(120),
    folioHistoricoDesde: z.number().int().min(1000).default(100001),
  })
  .transform((m) => ({
    ...m,
    proveedores: llavesNormalizadas(m.proveedores),
    categoriasPorPalabra: llavesNormalizadas(m.categoriasPorPalabra),
    estatus: llavesNormalizadas(m.estatus),
    ubicaciones: llavesNormalizadas(m.ubicaciones),
  }));
export type Mapeo = z.output<typeof esquemaMapeo>;
export type MapeoEntrada = z.input<typeof esquemaMapeo>;

/** Parte del mapeo que usan los normalizadores. */
export type MapeoNormalizacion = Pick<
  Mapeo,
  'estatus' | 'proveedores' | 'categoriasPorPalabra' | 'categoriaSinDato'
>;

// ---------------------------------------------------------------------------------------------------------------
// Plan de importación (todos los montos en centavos, fechas ISO, ids de `uuidDeterminista`).

export interface Origen {
  clave: string;
  hoja: string;
  filas: number[];
  hash: string;
  datos: unknown;
}
export interface CatalogoPlan {
  id: string;
  nombre: string;
  llave: string;
  origen: Origen;
}
export interface VendedorPlan extends CatalogoPlan {
  tipo: 'casa' | 'revendedora' | 'consignacion';
  comisionPct: string;
}
export interface ClientePlan {
  id: string;
  nombre: string;
  llave: string;
  referencia: string | null;
  cumpleanos: string | null;
  redSocial: string | null;
  usuarioRed: string | null;
  vendedorHabitualId: string | null;
  notas: string;
  origen: Origen;
}
export interface ExhibidorPlan {
  id: string;
  vendedorId: string;
  nombre: string;
  fechaEnvio: string;
  origen: Origen;
}
export type EstadoPiezaPlan =
  'disponible' | 'en_exhibidor' | 'apartada' | 'vendida' | 'regalo' | 'defecto' | 'guardada';
export interface PiezaPlan {
  id: string;
  codigo: string;
  categoriaId: string;
  materialId: string | null;
  proveedorId: string | null;
  descripcion: string;
  costo: number;
  precio: number;
  fechaAlta: string;
  estado: EstadoPiezaPlan;
  exhibidorId: string | null;
  pedidoId: string | null;
  fechaMovimiento: string;
  notaMovimiento: string;
  origen: Origen;
}
export interface Rechazo {
  hoja: string;
  fila: number | null;
  clave: string | null;
  /** Texto fijo (nunca lleva datos del cliente): sirve para agrupar. */
  motivo: string;
}
export interface Aviso {
  hoja: string;
  fila: number | null;
  clave: string | null;
  /** Código fijo del aviso; `detalle` puede llevar datos y solo va al reporte local. */
  tipo: string;
  detalle: string;
}

/** Estado compartido de una planificación: una sola instancia por corrida. */
export interface Contexto {
  rechazos: Rechazo[];
  avisos: Aviso[];
  /** Códigos de pieza ya asignados (únicos en el plan). */
  usados: Set<string>;
  /** Filas del Concentrado descartadas por completo (no deben crear pieza ni pedido). */
  filasRechazadas: Set<number>;
}
export const nuevoContexto = (): Contexto => ({
  rechazos: [],
  avisos: [],
  usados: new Set(),
  filasRechazadas: new Set(),
});

export interface ItemPlan {
  piezaId: string;
  precioLista: number;
  precioFinal: number;
}
export interface PedidoPlan {
  id: string;
  folio: number;
  folioOriginal: number | null;
  clienteId: string;
  vendedorId: string;
  fecha: string;
  estado: 'abierto' | 'liquidado';
  cuentaTarjeta: boolean;
  ciclo: number | null;
  posicion: number | null;
  descuentoManual: number;
  descuentoManualMotivo: string | null;
  total: number;
  notas: string;
  liquidadoEn: string | null;
  items: ItemPlan[];
  tipo: 'kzr' | 'historico' | 'posicion' | 'inventario';
  origen: Origen;
}
export interface PagoPlan {
  id: string;
  idempotencyKey: string;
  pedidoId: string;
  fecha: string;
  monto: number;
  pagadorClienteId: string | null;
  pagadorVendedorId: string | null;
  nota: string;
  origen: Origen;
}

export interface Conciliacion {
  conteos: Record<
    | 'categorias'
    | 'materiales'
    | 'proveedores'
    | 'vendedores'
    | 'clientes'
    | 'exhibidores'
    | 'piezas'
    | 'pedidos'
    | 'items'
    | 'pagos',
    number
  >;
  piezasPorEstado: Record<EstadoPiezaPlan, number>;
  porMes: { mes: string; pedidos: number; total: number; pagado: number; saldo: number }[];
  saldoTotal: number;
  saldoPorCliente: { clienteId: string; saldo: number }[];
  tarjeta: {
    clienteId: string;
    ciclo: number;
    posicion: number;
    estado: 'abierto' | 'liquidado';
    folio: number;
  }[];
  exhibidores: { exhibidorId: string; piezas: number }[];
}
export interface PlanImportacion {
  lote: string;
  archivos: Libro['archivos'];
  categorias: CatalogoPlan[];
  materiales: CatalogoPlan[];
  proveedores: CatalogoPlan[];
  vendedores: VendedorPlan[];
  clientes: ClientePlan[];
  exhibidores: ExhibidorPlan[];
  piezas: PiezaPlan[];
  pedidos: PedidoPlan[];
  pagos: PagoPlan[];
  conciliacion: Conciliacion;
  rechazos: Rechazo[];
  avisos: Aviso[];
  candidatasFusion: string[][];
}
/** Verificación dentro de la transacción: las cifras del plan contra lo que quedó en la BD. */
export interface VerificacionBd {
  ok: boolean;
  /** Solo agregados e ids (nunca nombres): se imprimen en el reporte local. */
  diferencias: string[];
}
/** Resultado de `aplicarPlan` (modos ensayo/aplicar). */
export interface ResultadoBd {
  modo: 'ensayo' | 'aplicar';
  /** Filas insertadas por tabla (en `ensayo`, las que se insertaron antes del ROLLBACK). */
  insertados: Record<string, number>;
  /** Entidades del plan cuya clave de origen ya estaba en la BD con el mismo hash. */
  yaAplicados: number;
  /** Clave presente con otro hash: NO se aplica (aviso). */
  cambiados: { clave: string; hoja: string }[];
  reutilizados: Record<'categorias' | 'materiales' | 'proveedores' | 'vendedores' | 'clientes', number>;
  /** Choques con datos de la app: código existente, folio movido, posición de tarjeta ocupada… */
  rechazosEnBd: Rechazo[];
  verificacion: VerificacionBd;
  siguienteFolio: number;
  /** Huella de las decisiones contra la BD (atada a destino y plan): `aplicar` exige la del ensayo. */
  huella: string;
}
