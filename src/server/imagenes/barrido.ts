import 'server-only';
import { claveDeRuta } from '@/domain/imagenes';
import type { AlmacenImagenes } from './almacen';

/** Solo conteos: es lo único que se registra (nunca rutas, claves ni tokens). */
export interface ResumenBarrido {
  revisados: number;
  referenciados: number;
  recientes: number;
  desconocidos: number;
  huerfanos: number;
  borrados: number;
  truncado: boolean;
  simulado: boolean;
}

/**
 * Borra blobs de fotos que la BD ya no referencia y que tienen más de `margenHoras` (Task 7).
 * El margen protege las subidas en curso; las claves nunca se reutilizan (D1), así que un blob viejo
 * no referenciado no puede volver a usarse. Si algo falla antes de borrar, no se borra nada.
 */
export async function barrerImagenesHuerfanas(o: {
  almacen: AlmacenImagenes;
  clavesReferenciadas: () => Promise<Set<string>>;
  ahora?: Date;
  margenHoras?: number;
  maxBorrados?: number;
  maxPaginas?: number;
  lote?: number;
  simular?: boolean;
}): Promise<ResumenBarrido> {
  const ahora = o.ahora ?? new Date();
  const limite = ahora.getTime() - (o.margenHoras ?? 24) * 3_600_000;
  const maxBorrados = o.maxBorrados ?? 500;
  const maxPaginas = o.maxPaginas ?? 20;
  const lote = o.lote ?? 100;
  const r: ResumenBarrido = {
    revisados: 0,
    referenciados: 0,
    recientes: 0,
    desconocidos: 0,
    huerfanos: 0,
    borrados: 0,
    truncado: false,
    simulado: Boolean(o.simular),
  };

  // 1. Listar (páginas con tope). 2. Leer las claves vigentes DESPUÉS de listar (una consulta).
  const objetos: { ruta: string; subidoEn: Date }[] = [];
  let cursor: string | undefined;
  for (let pagina = 0; ; pagina++) {
    if (pagina === maxPaginas) {
      r.truncado = true;
      break;
    }
    // Secuencial por diseño: cada página necesita el cursor de la anterior (no es N+1 por fila).
    const p = await o.almacen.listar('piezas/', cursor);
    objetos.push(...p.objetos);
    if (!p.siguiente) break;
    cursor = p.siguiente;
  }
  const vigentes = await o.clavesReferenciadas();

  const candidatos: string[] = [];
  for (const e of objetos) {
    r.revisados++;
    const clave = claveDeRuta(e.ruta);
    if (!clave) r.desconocidos++;
    else if (vigentes.has(clave)) r.referenciados++;
    else if (e.subidoEn.getTime() >= limite) r.recientes++;
    else candidatos.push(e.ruta);
  }
  r.huerfanos = candidatos.length;
  if (candidatos.length > maxBorrados) r.truncado = true;
  if (o.simular) return r;

  const aBorrar = candidatos.slice(0, maxBorrados);
  for (let i = 0; i < aBorrar.length; i += lote) {
    const parte = aBorrar.slice(i, i + lote);
    await o.almacen.borrar(parte); // un `del` por lote, no por blob
    r.borrados += parte.length;
  }
  return r;
}
