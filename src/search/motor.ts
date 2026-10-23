import MiniSearch from 'minisearch';
import { normalizarCodigo } from '@/domain/codigos';
import { esFolioExplicito, formatoFolio, parsearFolio } from '@/domain/pedidos';
import { urlImagenPieza } from '@/domain/imagenes';
import { normalizar } from '@/domain/texto';
import type { IndiceBusqueda } from './tipos';

export interface Resultado {
  clave: string;
  tipo: 'pieza' | 'cliente' | 'vendedor' | 'pedido';
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
const ESTADOS_PEDIDO: Record<string, string> = {
  abierto: 'Abierto',
  liquidado: 'Liquidado',
  cancelado: 'Cancelado',
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
  // Los pedidos NO entran a MiniSearch (el token "kzr" emparejaría con todos): solo se resuelven por folio.
  const porFolio = new Map<number, Resultado>();

  for (const [id, codigo, descripcion, estado, imagen, ubicacion] of indice.piezas) {
    const r: Resultado = {
      clave: `pieza:${id}`,
      tipo: 'pieza',
      titulo: `${codigo} · ${descripcion}`,
      subtitulo: ubicacion ? `${ESTADOS[estado] ?? estado} · ${ubicacion}` : (ESTADOS[estado] ?? estado),
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

  for (const [id, folio, cliente, estado] of indice.pedidos) {
    const r: Resultado = {
      clave: `pedido:${id}`,
      tipo: 'pedido',
      titulo: `${formatoFolio(folio)} · ${cliente}`,
      subtitulo: ESTADOS_PEDIDO[estado] ?? estado,
      href: `/panel/pedidos/${folio}`,
      miniatura: null,
    };
    porFolio.set(folio, r);
    porClave.set(r.clave, r);
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
    buscar(
      consulta: string,
      recientes: readonly string[] = [],
      limite = LIMITE_DEFECTO,
      opciones: { tipos?: readonly Resultado['tipo'][] } = {},
    ): Resultado[] {
      const permitido = (r: Resultado) => !opciones.tipos || opciones.tipos.includes(r.tipo);
      const max = acotarLimite(limite);
      if (!consulta.trim()) {
        const lista: Resultado[] = [];
        for (const c of recientes) {
          const r = porClave.get(c);
          if (r && permitido(r)) lista.push(r);
        }
        return lista.slice(0, max);
      }
      const folio = parsearFolio(consulta);
      const pedido = folio === null ? undefined : porFolio.get(folio);
      const pieza = porCodigo.get(normalizarCodigo(consulta)) ?? porCodigoCompacto.get(compactar(consulta));
      // D-16: "KZR-34" es siempre el pedido; "34" es la pieza 34 si existe y si no, el pedido 34.
      const candidato = esFolioExplicito(consulta) ? (pedido ?? pieza) : (pieza ?? pedido);
      const exacto = candidato && permitido(candidato) ? candidato : undefined;
      const impulso = new Map(
        recientes.map((c, i) => [c, 1 + (recientes.length - i) / recientes.length] as const),
      );
      const hits = ms.search(consulta, {
        boostDocument: (id) => impulso.get(String(id)) ?? 1,
        filter: opciones.tipos ? (r) => opciones.tipos!.includes(r.tipo) : undefined,
      });
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
