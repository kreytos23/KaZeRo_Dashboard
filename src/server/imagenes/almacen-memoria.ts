import 'server-only';
import type { AlmacenImagenes, PaginaAlmacen } from './almacen';
import { exigirLimite, exigirPrefijo, exigirRuta, LIMITE_LISTA, paginarRutas } from './ruta';

export type OpcionesAlmacenMemoria = {
  fallarAlGuardar?: boolean;
  fallarAlBorrar?: boolean;
  fallarAlListar?: boolean;
  /** Reloj inyectable para fechas deterministas en pruebas. */
  ahora?: () => Date;
  /** Tope de objetos por página de listar() (por defecto el límite del contrato). */
  tamPagina?: number;
};

/** Almacén en memoria: mismo contrato que Blob, con fallas a pedido. Pruebas e integración; nunca producción. */
export function crearAlmacenMemoria(o: OpcionesAlmacenMemoria = {}) {
  const ahora = o.ahora ?? (() => new Date());
  const datos = new Map<string, { bytes: Uint8Array; subidoEn: Date }>();
  const almacen: AlmacenImagenes & {
    rutas(): string[];
    bytes(ruta: string): Uint8Array | undefined;
    /** Pone un blob con una fecha de subida dada (pruebas del barrido). */
    sembrar(ruta: string, subidoEn: Date): void;
  } = {
    async guardar(ruta, d) {
      exigirRuta(ruta);
      if (o.fallarAlGuardar) throw new Error('BlobServiceNotAvailable');
      if (datos.has(ruta)) throw new Error('BlobAlreadyExists');
      datos.set(ruta, { bytes: d.slice(), subidoEn: ahora() });
    },
    async leer(ruta) {
      const d = datos.get(exigirRuta(ruta));
      return d ? { cuerpo: new Blob([d.bytes.slice()]).stream(), bytes: d.bytes.length } : null;
    },
    async borrar(rutas) {
      const validas = rutas.map(exigirRuta);
      if (o.fallarAlBorrar) throw new Error('BlobServiceNotAvailable');
      for (const r of validas) datos.delete(r);
    },
    async listar(prefijo, cursor, limite = LIMITE_LISTA): Promise<PaginaAlmacen> {
      exigirPrefijo(prefijo);
      exigirLimite(limite);
      if (o.fallarAlListar) throw new Error('BlobServiceNotAvailable');
      const { pagina, siguiente } = paginarRutas(
        [...datos.keys()],
        prefijo,
        cursor,
        Math.min(limite, o.tamPagina ?? LIMITE_LISTA),
      );
      return {
        objetos: pagina.map((ruta) => ({
          ruta,
          subidoEn: datos.get(ruta)!.subidoEn,
          bytes: datos.get(ruta)!.bytes.length,
        })),
        siguiente,
      };
    },
    sembrar(ruta, subidoEn) {
      datos.set(exigirRuta(ruta), { bytes: Uint8Array.of(1), subidoEn });
    },
    rutas: () => [...datos.keys()].sort(),
    bytes: (ruta) => datos.get(ruta)?.bytes,
  };
  return almacen;
}
