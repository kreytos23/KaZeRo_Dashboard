import 'server-only';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { link, mkdir, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { AlmacenImagenes } from './almacen';
import { exigirLimite, exigirPrefijo, exigirRuta, LIMITE_LISTA, paginarRutas } from './ruta';

const noExiste = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT';

/** Solo E2E y desarrollo (configuracionAlmacen lo prohíbe en Vercel). Misma semántica que Blob. */
export function crearAlmacenDisco(dir: string): AlmacenImagenes {
  const base = resolve(dir);
  const archivo = (ruta: string) => {
    const destino = resolve(base, ...exigirRuta(ruta).split('/'));
    const rel = relative(base, destino);
    // Además de la regex del dominio: el destino resuelto debe quedar dentro del directorio base.
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new RangeError('Ruta de imagen inválida');
    return destino;
  };
  return {
    async guardar(ruta, datos) {
      const destino = archivo(ruta);
      await mkdir(dirname(destino), { recursive: true });
      // Atómico y sin sobrescribir: se escribe completo en un temporal y se publica con un enlace duro
      // (falla con EEXIST si la ruta ya existe). Un lector nunca ve un archivo a medias.
      const temporal = join(dirname(destino), `.tmp-${randomUUID()}`);
      try {
        await writeFile(temporal, datos, { flag: 'wx' });
        await link(temporal, destino);
      } finally {
        await unlink(temporal).catch(() => undefined);
      }
    },
    async leer(ruta) {
      const origen = archivo(ruta);
      try {
        const s = await stat(origen);
        return {
          cuerpo: Readable.toWeb(createReadStream(origen)) as ReadableStream<Uint8Array>,
          bytes: s.size,
        };
      } catch (e) {
        if (noExiste(e)) return null;
        throw e;
      }
    },
    async borrar(rutas) {
      const archivos = [...new Set(rutas.map(archivo))];
      await Promise.all(archivos.map((a) => rm(a, { force: true })));
    },
    async listar(prefijo, cursor, limite = LIMITE_LISTA) {
      exigirPrefijo(prefijo);
      exigirLimite(limite);
      const rutas: string[] = [];
      try {
        for (const pieza of await readdir(join(base, 'piezas'))) {
          try {
            for (const f of await readdir(join(base, 'piezas', pieza))) rutas.push(`piezas/${pieza}/${f}`);
          } catch (e) {
            if (!noExiste(e) && (e as NodeJS.ErrnoException).code !== 'ENOTDIR') throw e;
          }
        }
      } catch (e) {
        if (!noExiste(e)) throw e;
      }
      const { pagina, siguiente } = paginarRutas(rutas, prefijo, cursor, limite);
      const objetos = await Promise.all(
        pagina.map(async (ruta) => {
          const s = await stat(archivo(ruta));
          return { ruta, subidoEn: s.mtime, bytes: s.size };
        }),
      );
      return { objetos, siguiente };
    },
  };
}
