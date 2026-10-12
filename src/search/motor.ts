import MiniSearch from 'minisearch';
import { normalizarCodigo } from '@/domain/codigos';
import { urlImagenPieza } from '@/domain/imagenes';
import { normalizar } from '@/domain/texto';
import type { IndiceBusqueda } from './tipos';

export interface Resultado {
  clave: string;
  tipo: 'pieza' | 'cliente' | 'vendedor';
  titulo: string;
  subtitulo: string;
  href: string;
  /** URL de la miniatura (solo piezas con foto). */
  miniatura: string | null;
}
type Doc = Resultado & { texto: string };

const LIMITE_DEFECTO = 8;
const LIMITE_MAXIMO = 50;

const ESTADOS: Record<string, string> = {
  disponible: 'Disponible',
  en_exhibidor: 'En exhibidor',
  apartada: 'Apartada',
  vendida: 'Vendida',
  regalo: 'Regalo',
  defecto: 'Defecto',
  guardada: 'Guardada',
};

/** "af-12" debe encontrar AF12: se compara también sin guiones. */
function compactar(c: string): string {
  return normalizarCodigo(c).replace(/-/g, '');
}

function acotarLimite(limite: number): number {
  if (!Number.isFinite(limite)) return LIMITE_DEFECTO;
  return Math.min(Math.max(Math.floor(limite), 1), LIMITE_MAXIMO);
}

export function crearMotor(indice: IndiceBusqueda) {
  const docs: Doc[] = [];
  const porCodigo = new Map<string, Resultado>();
  const porCodigoCompacto = new Map<string, Resultado>();
  const porClave = new Map<string, Resultado>();

  for (const [id, codigo, descripcion, estado, imagen] of indice.piezas) {
    const r: Resultado = {
      clave: `pieza:${id}`,
      tipo: 'pieza',
      titulo: `${codigo} · ${descripcion}`,
      subtitulo: ESTADOS[estado] ?? estado,
      href: `/panel/inventario/${encodeURIComponent(codigo)}`,
      miniatura: imagen ? urlImagenPieza(id, imagen, 'mini') : null,
    };
    porCodigo.set(normalizarCodigo(codigo), r);
    porCodigoCompacto.set(compactar(codigo), r);
    porClave.set(r.clave, r);
    docs.push({ ...r, texto: `${codigo} ${descripcion}` });
  }
  for (const [id, nombre, referencia] of indice.clientes) {
    const r: Resultado = {
      clave: `cliente:${id}`,
      tipo: 'cliente',
      titulo: nombre,
      subtitulo: referencia ?? 'Cliente',
      href: `/panel/clientes/${encodeURIComponent(id)}`,
      miniatura: null,
    };
    porClave.set(r.clave, r);
    docs.push({ ...r, texto: `${nombre} ${referencia ?? ''}` });
  }
  for (const [id, nombre] of indice.vendedores) {
    const r: Resultado = {
      clave: `vendedor:${id}`,
      tipo: 'vendedor',
      titulo: nombre,
      subtitulo: 'Vendedor',
      href: `/panel/vendedores/${encodeURIComponent(id)}`,
      miniatura: null,
    };
    porClave.set(r.clave, r);
    docs.push({ ...r, texto: nombre });
  }

  const ms = new MiniSearch<Doc>({
    idField: 'clave',
    fields: ['texto'],
    storeFields: ['clave', 'tipo', 'titulo', 'subtitulo', 'href', 'miniatura'],
    // Mismo normalizador que el resto del sistema: sin acentos ni mayúsculas, en índice y consulta.
    processTerm: (t) => normalizar(t) || null,
    searchOptions: {
      prefix: true,
      // Un error solo en palabras de 4+ letras: en palabras cortas genera ruido.
      fuzzy: (term) => (term.length >= 4 ? 1 : false),
      combineWith: 'AND',
    },
  });
  ms.addAll(docs);

  return {
    /** Consulta vacía: devuelve los recientes que sigan existiendo (o nada). */
    buscar(consulta: string, recientes: readonly string[] = [], limite = LIMITE_DEFECTO): Resultado[] {
      const max = acotarLimite(limite);
      if (!consulta.trim()) {
        const lista: Resultado[] = [];
        for (const c of recientes) {
          const r = porClave.get(c);
          if (r) lista.push(r);
        }
        return lista.slice(0, max);
      }
      const exacto = porCodigo.get(normalizarCodigo(consulta)) ?? porCodigoCompacto.get(compactar(consulta));
      const impulso = new Map(
        recientes.map((c, i) => [c, 1 + (recientes.length - i) / recientes.length] as const),
      );
      const hits = ms.search(consulta, { boostDocument: (id) => impulso.get(String(id)) ?? 1 });
      const lista: Resultado[] = hits.map((h) => ({
        clave: h.clave,
        tipo: h.tipo,
        titulo: h.titulo,
        subtitulo: h.subtitulo,
        href: h.href,
        miniatura: h.miniatura,
      }));
      const ordenada = exacto ? [exacto, ...lista.filter((r) => r.clave !== exacto.clave)] : lista;
      return ordenada.slice(0, max);
    },
  };
}
