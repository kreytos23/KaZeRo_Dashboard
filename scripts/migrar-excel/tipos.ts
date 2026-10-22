/** Valor de una celda ya limpiado: fórmulas → su resultado, richText → texto, errores (#N/A…) → null. */
export type Celda = string | number | Date | null;

export interface FilaInventario {
  fila: number;
  id: Celda;
  categoria: Celda;
  producto: Celda;
  material: Celda;
  proveedor: Celda;
  costo: Celda;
  precio: Celda;
  ubicacion: Celda;
  cliente: Celda;
  vendedor: Celda;
}

export interface FilaConcentrado {
  fila: number;
  fechaCompra: Celda;
  costo: Celda;
  venta: Celda;
  cliente: Celda;
  estatus: Celda;
  id: Celda;
  descripcion: Celda;
  comentarios: Celda;
  comision: Celda;
  proveedor: Celda;
  tarjeta: Celda;
  nota: Celda;
}

export interface FilaLealtad {
  fila: number;
  cliente: Celda;
  /** Posiciones 1..10 de la tarjeta. */
  celdas: Celda[];
}

export interface FilaCumple {
  fila: number;
  bloque: 'A' | 'B';
  red: Celda;
  nombre: Celda;
  fecha: Celda;
}

export interface FilaHojaExhibidor {
  fila: number;
  id: Celda;
  descripcion: Celda;
  precio: Celda;
  fechaVenta: Celda;
}

export interface ArchivoLeido {
  rol: 'inventario' | 'tracking';
  sha256: string;
  bytes: number;
}

export interface Libro {
  archivos: ArchivoLeido[];
  inventario: FilaInventario[];
  concentrado: FilaConcentrado[];
  lealtad: FilaLealtad[];
  cumpleanos: FilaCumple[];
  hojasExhibidor: Record<string, FilaHojaExhibidor[]>;
}

/** Clases de estatus del Concentrado (clasificación local en el mapeo). */
export type ClaseEstatus =
  | 'vendido'
  | 'por_cobrar'
  | 'no_cobrado'
  | 'regalo'
  | 'rifa'
  | 'exhibidor'
  | 'defecto'
  | 'guardado'
  | 'disponible'
  | 'ignorar';

/**
 * Parte del mapeo local que usan los normalizadores. Las llaves de `estatus`, `proveedores` y
 * `categoriasPorPalabra` ya vienen normalizadas (`llaveNombre`).
 */
export interface Mapeo {
  estatus: Record<string, ClaseEstatus>;
  proveedores: Record<string, string>;
  categoriasPorPalabra: Record<string, string>;
  categoriaSinDato: string;
}
