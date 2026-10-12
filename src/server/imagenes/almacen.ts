import 'server-only';
import { isAbsolute } from 'node:path';
import { crearAlmacenBlob } from './almacen-blob';
import { crearAlmacenDisco } from './almacen-disco';
import { crearAlmacenMemoria } from './almacen-memoria';

export type ObjetoAlmacen = { ruta: string; subidoEn: Date; bytes: number };
export type PaginaAlmacen = { objetos: ObjetoAlmacen[]; siguiente: string | null };

/** Dónde viven los bytes de las fotos. Las pruebas inyectan uno en memoria; nunca tocan Blob real. */
export interface AlmacenImagenes {
  /** Crea la ruta; falla si ya existe (las rutas son inmutables, nunca se sobrescriben). */
  guardar(ruta: string, datos: Uint8Array): Promise<void>;
  /** `null` si no existe. */
  leer(ruta: string): Promise<{ cuerpo: ReadableStream<Uint8Array>; bytes: number | null } | null>;
  /** Por lotes; repetidas e inexistentes no fallan. Una ruta inválida rechaza todo el lote sin borrar nada. */
  borrar(rutas: readonly string[]): Promise<void>;
  /** Solo objetos que son fotos de pieza. `siguiente` es el cursor de la página siguiente (o null). */
  listar(prefijo: string, cursor?: string, limite?: number): Promise<PaginaAlmacen>;
}

export type ConfigAlmacen =
  { tipo: 'blob'; token: string } | { tipo: 'disco'; dir: string } | { tipo: 'memoria' };

/** Reglas de D5. Fail-closed: lo desconocido o incompleto lanza. Los mensajes nunca incluyen valores de variables. */
export function configuracionAlmacen(e: Readonly<Record<string, string | undefined>>): ConfigAlmacen {
  const tipo = e.KAZERO_ALMACEN_IMAGENES || 'blob';
  if (tipo === 'blob') {
    if (!e.BLOB_READ_WRITE_TOKEN) throw new Error('Falta BLOB_READ_WRITE_TOKEN para guardar fotos.');
    return { tipo, token: e.BLOB_READ_WRITE_TOKEN };
  }
  if (tipo === 'disco') {
    if (e.VERCEL) throw new Error('El almacén en disco no se usa en Vercel.');
    const dir = e.KAZERO_DIR_IMAGENES ?? '';
    if (!isAbsolute(dir)) throw new Error('KAZERO_DIR_IMAGENES debe ser una ruta absoluta.');
    return { tipo, dir };
  }
  if (tipo === 'memoria') {
    if (e.VERCEL) throw new Error('El almacén en memoria no se usa en Vercel.');
    if (e.NODE_ENV === 'production') throw new Error('El almacén en memoria no se usa en producción.');
    return { tipo };
  }
  throw new Error('KAZERO_ALMACEN_IMAGENES debe ser "blob", "disco" o "memoria".');
}

let almacen: AlmacenImagenes | undefined;

/** Perezoso: build, páginas sin fotos e integración no necesitan configuración de almacén. */
export function almacenImagenes(): AlmacenImagenes {
  if (almacen) return almacen;
  const c = configuracionAlmacen(process.env);
  almacen =
    c.tipo === 'blob'
      ? crearAlmacenBlob(c.token)
      : c.tipo === 'disco'
        ? crearAlmacenDisco(c.dir)
        : crearAlmacenMemoria();
  return almacen;
}
