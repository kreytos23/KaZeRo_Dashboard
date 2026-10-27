/** Importador de notas KZR históricas desde Excel (fresh restart, reunión 2026-10-23). Tipos compartidos. */

/** Lote de `origen_excel` de esta importación; la clave de cada nota es `kzr:<folio>`. */
export const LOTE_KZR = 'kzr-historico';
export const HOJA_KZR = 'Hoja1';
export const MOTIVO_KZR = 'Importación de notas KZR históricas';

/** Una fila del Excel (una pieza), con las celdas ya convertidas a texto recortado. */
export interface FilaExcel {
  /** Número de fila en la hoja (1 = encabezado). */
  fila: number;
  nota: string | null;
  id: string | null;
  descripcion: string | null;
  tarjeta: string | null;
  cliente: string | null;
  vendedor: string | null;
  estatus: string | null;
}

export type CodigoProblema =
  | 'nota_invalida'
  | 'campo_vacio'
  | 'nota_inconsistente'
  | 'tarjeta_formato_no_soportado'
  | 'tarjeta_fecha_futura'
  | 'estatus_no_soportado'
  | 'cliente_no_encontrado'
  | 'cliente_ambiguo'
  | 'cliente_nombre_invalido'
  | 'vendedor_por_prefijo'
  | 'vendedor_no_encontrado'
  | 'vendedor_inactivo'
  | 'vendedor_ambiguo'
  | 'pieza_faltante'
  | 'pieza_no_disponible'
  | 'pieza_de_otra_vendedora'
  | 'pieza_repetida'
  | 'lugar_ocupado'
  | 'total_cero'
  | 'demasiadas_piezas'
  | 'folio_existente'
  | 'origen_cambiado'
  | 'descripcion_distinta';

/** Sin datos personales: se identifica por folio y fila del Excel (el operador abre el archivo y la ve). */
export interface Problema {
  codigo: CodigoProblema;
  folio: number | null;
  filas: number[];
  mensaje: string;
}

export interface PiezaSnapshot {
  id: string;
  codigo: string;
  descripcion: string;
  estado: string;
  exhibidorId: string | null;
  vendedorCustodiaId: string | null;
  /** numeric(12,2) tal cual lo guarda la BD. */
  precio: string;
  precioCentavos: number;
}

/** Lo que la importación necesita saber de la BD (se lee en una sola pasada, bajo los bloqueos al aplicar). */
export interface Snapshot {
  clientes: { id: string; nombre: string }[];
  vendedores: { id: string; nombre: string; activo: boolean }[];
  piezas: PiezaSnapshot[];
  /** Folios del Excel que ya existen como pedido. */
  pedidosPorFolio: { folio: number; id: string }[];
  /** `origen_excel` con las claves de las notas del Excel (en cualquier lote). */
  origenes: {
    lote: string;
    clave: string;
    hash: string;
    pedidoId: string | null;
    clienteId: string | null;
  }[];
  /** Posiciones de tarjeta ocupadas (pedidos no cancelados que cuentan). */
  tarjetas: { clienteId: string; ciclo: number; posicion: number }[];
  maxFolio: number;
  /** Último folio entregado por la secuencia (0 si aún no se ha usado). */
  folioSecuencia: number;
}

export interface ItemPlan {
  piezaId: string;
  codigo: string;
  precioCentavos: number;
  precioFinalCentavos: number;
}

export interface NotaNueva {
  estado: 'nueva';
  folio: number;
  clave: string;
  hashFuente: string;
  filas: number[];
  fecha: string;
  /** null si el cliente no existe y se crea en esta importación (`clienteNuevo` es su clave). */
  clienteId: string | null;
  clienteNuevo: string | null;
  vendedorId: string;
  /** Etiquetas cortas para el reporte (id corto + iniciales). */
  clienteEtiqueta: string;
  vendedorEtiqueta: string;
  ciclo: number;
  posicion: number;
  pctBps: number;
  items: ItemPlan[];
  subtotal: number;
  descuentoLealtad: number;
  total: number;
}

export interface NotaYaAplicada {
  estado: 'ya_aplicada';
  folio: number;
  clave: string;
  hashFuente: string;
  filas: number[];
  pedidoId: string;
}

export type NotaPlan = NotaNueva | NotaYaAplicada;

/** Cliente que no existe en la BD y se crea con el nombre del Excel (sin espacios de más). */
export interface ClientePorCrear {
  /** `kzr-cliente:<sha256 del nombre normalizado>`: clave en origen_excel. */
  clave: string;
  nombre: string;
}

export interface PlanKzr {
  clientesPorCrear: ClientePorCrear[];
  notas: NotaPlan[];
  errores: Problema[];
  avisos: Problema[];
  /** Folio que entregará la secuencia tras aplicar (máximo existente o planeado + 1). */
  siguienteFolio: number;
  /** SHA-256 del plan resuelto contra la BD (ids, precios, lugares): cambia si cambian el Excel o la BD. */
  hash: string;
}
