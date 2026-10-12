import 'server-only';
import { del, get, list, put } from '@vercel/blob';
import { esRutaImagen } from '@/domain/imagenes';
import type { AlmacenImagenes } from './almacen';
import { exigirLimite, exigirPrefijo, exigirRuta, LIMITE_LISTA } from './ruta';

const UN_ANIO = 31_536_000;

/** Store privado (D5): solo el servidor con el token lee; la app sirve las fotos por su propia ruta. */
export function crearAlmacenBlob(token: string): AlmacenImagenes {
  return {
    async guardar(ruta, datos) {
      // Rutas con clave nueva por subida: nunca se sobrescribe nada (allowOverwrite: false).
      await put(exigirRuta(ruta), Buffer.from(datos), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: 'image/webp',
        cacheControlMaxAge: UN_ANIO,
        token,
      });
    },
    async leer(ruta) {
      const r = await get(exigirRuta(ruta), { access: 'private', token });
      if (!r || r.statusCode !== 200) return null;
      return { cuerpo: r.stream, bytes: r.blob.size };
    },
    async borrar(rutas) {
      const validas = [...new Set(rutas.map(exigirRuta))];
      if (validas.length) await del(validas, { token });
    },
    async listar(prefijo, cursor, limite = LIMITE_LISTA) {
      const r = await list({ prefix: exigirPrefijo(prefijo), cursor, limit: exigirLimite(limite), token });
      return {
        objetos: r.blobs
          .filter((b) => esRutaImagen(b.pathname))
          .map((b) => ({ ruta: b.pathname, subidoEn: b.uploadedAt, bytes: b.size })),
        siguiente: r.hasMore && r.cursor ? r.cursor : null,
      };
    },
  };
}
