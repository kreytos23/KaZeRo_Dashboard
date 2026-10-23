import {
  codigoDeCelda,
  fechaDeCelda,
  inferirFecha,
  fechasDeComentario,
  llaveNombre,
  proveedorCanonico,
  separarPrefijo,
} from './normalizar';
import { planPersonas, vendedorDeComision } from './plan-personas';
import { esquemaMapeo, nuevoContexto, type ClaseEstatus, type Libro, type MapeoEntrada } from './tipos';

const masFrecuente = (xs: string[]): string => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
};
const texto = (c: unknown): string | null => (typeof c === 'string' && c.trim() ? c.trim() : null);
const singular = (p: string) => p.replace(/(es|s)$/, '');

/** Clase propuesta para un estatus escrito a mano (se revisa en `mapeo.json`). */
export function claseSugerida(estatus: string): ClaseEstatus {
  const k = llaveNombre(estatus);
  if (/^vendid/.test(k)) return 'vendido';
  if (/por cobrar/.test(k)) return 'por_cobrar';
  if (/no se (cobr|pag)|no cobrad|no se cobra/.test(k)) return 'no_cobrado';
  if (/regalo|obsequio/.test(k)) return 'regalo';
  if (/rifa/.test(k)) return 'rifa';
  if (/defecto/.test(k)) return 'defecto';
  if (/guardad/.test(k)) return 'guardado';
  if (/disponible/.test(k)) return 'disponible';
  if (/^exhibidor/.test(k) || fechasDeComentario(k).length > 0) return 'exhibidor';
  return 'ignorar';
}

/**
 * Propone un `mapeo.json` a partir de los datos (vendedores, proveedores, categorías, estatus, exhibidores) y las
 * candidatas a fusión de clientes. No toca la BD; el resultado es local y se revisa a mano.
 */
export function sugerirMapeo(
  l: Libro,
  fechaCorte: string,
): { mapeo: MapeoEntrada; candidatasFusion: string[][] } {
  // --- Vendedores: Comisión, inventario y prefijos de cliente que coinciden con alguno de ellos
  const vistos = new Map<string, { crudos: string[]; pct: string | null; prefijos: number }>();
  const ver = (crudo: string) => {
    const k = llaveNombre(crudo).replace(/s$/, '');
    const v = vistos.get(k) ?? { crudos: [], pct: null, prefijos: 0 };
    v.crudos.push(crudo.trim());
    vistos.set(k, v);
    return v;
  };
  for (const f of l.concentrado) {
    const n = vendedorDeComision(f.comision);
    if (!n) continue;
    const v = ver(n);
    const pct = typeof f.comision === 'string' ? /^\s*(\d{1,3})(?:[.,]\d+)?\s*%/.exec(f.comision)?.[1] : null;
    if (pct) v.pct = pct;
  }
  for (const f of l.inventario) if (texto(f.vendedor)) ver(texto(f.vendedor)!);
  for (const f of l.concentrado) {
    const c = texto(f.cliente);
    const sep = c ? separarPrefijo(c, new Map()) : null;
    if (sep?.referencia && vistos.has(llaveNombre(sep.referencia).replace(/s$/, '')))
      ver(sep.referencia).prefijos++;
  }
  const ubicaciones = l.inventario.map((f) => texto(f.ubicacion)).filter((x): x is string => !!x);
  const ubicacionCasa = ubicaciones.length ? masFrecuente(ubicaciones) : 'Casa';
  const casaLlave = llaveNombre(ubicacionCasa).replace(/s$/, '');
  if (!vistos.has(casaLlave)) ver(ubicacionCasa);
  const principal = [...vistos]
    .filter(([k]) => k !== casaLlave)
    .sort((a, b) => b[1].prefijos - a[1].prefijos)[0]?.[0];
  const vendedores = [...vistos].map(([k, v]) => {
    const nombre = masFrecuente(v.crudos);
    const alias = [...new Set(v.crudos)].filter((x) => x !== nombre);
    return {
      nombre,
      tipo:
        k === casaLlave
          ? ('casa' as const)
          : k === principal
            ? ('revendedora' as const)
            : ('consignacion' as const),
      comisionPct: k === casaLlave ? '0' : (v.pct ?? '15'),
      alias,
    };
  });

  // --- Proveedores
  const crudosProv = [...l.inventario.map((f) => f.proveedor), ...l.concentrado.map((f) => f.proveedor)];
  const porLlave = new Map<string, string[]>();
  for (const c of crudosProv) {
    const t = texto(c) ?? (typeof c === 'number' ? String(c) : null);
    if (t) porLlave.set(llaveNombre(t), [...(porLlave.get(llaveNombre(t)) ?? []), t]);
  }
  const mapaVacio = { estatus: {}, proveedores: {}, categoriasPorPalabra: {}, categoriaSinDato: '' };
  const proveedores: Record<string, string | null> = {};
  for (const [k, crudos] of porLlave) {
    const raro = crudos.some(
      (c) => proveedorCanonico(/^\d+$/.test(c) ? Number(c) : c, mapaVacio).aviso !== null,
    );
    proveedores[k] = raro ? null : masFrecuente(crudos);
  }

  // --- Categorías por primera palabra de la descripción (del inventario)
  const porPalabra = new Map<string, string[]>();
  for (const f of l.inventario) {
    const cat = texto(f.categoria);
    const palabra = llaveNombre(texto(f.producto) ?? '').split(' ')[0];
    if (cat && palabra)
      porPalabra.set(singular(palabra), [...(porPalabra.get(singular(palabra)) ?? []), cat]);
  }
  const categoriasPorPalabra: Record<string, string> = {};
  for (const [p, cats] of porPalabra) categoriasPorPalabra[p] = masFrecuente(cats);

  // --- Estatus y exhibidores
  const estatus: Record<string, ClaseEstatus> = {};
  for (const f of l.concentrado) {
    const e = texto(f.estatus);
    if (e) estatus[e] = claseSugerida(e);
  }
  const textos = new Set<string>();
  for (const u of ubicaciones)
    if (llaveNombre(u) !== casaLlave && llaveNombre(u) !== 'defecto') textos.add(u);
  for (const [e, c] of Object.entries(estatus)) if (c === 'exhibidor') textos.add(e);
  const principalNombre = vendedores.find((v) => v.tipo === 'revendedora')?.nombre ?? vendedores[0]!.nombre;
  const exhibidores = [...textos].sort().map((t) => {
    const k = ` ${llaveNombre(t)} `;
    const dueno = vendedores.find((v) =>
      [v.nombre, ...v.alias].some((a) => k.includes(` ${llaveNombre(a)} `)),
    );
    const dm = fechasDeComentario(t)[0];
    let fechaEnvio = dm ? inferirFecha(dm, { desde: null, hasta: fechaCorte }) : null;
    if (!fechaEnvio) {
      // Sin fecha en el texto (p. ej. "DH Studio"): la de su primera pieza registrada, o el corte.
      const codigosInv = new Set(
        l.inventario.filter((f) => texto(f.ubicacion) === t).map((f) => codigoDeCelda(f.id)),
      );
      const ultimaPorCodigo = new Map<string, (typeof l.concentrado)[number]>();
      for (const f of l.concentrado) {
        const c = codigoDeCelda(f.id);
        if (c && codigosInv.has(c)) ultimaPorCodigo.set(c, f);
      }
      const compras = [...l.concentrado.filter((f) => texto(f.estatus) === t), ...ultimaPorCodigo.values()]
        .map((f) => fechaDeCelda(f.fechaCompra, fechaCorte))
        .filter((x): x is string => !!x)
        .sort();
      fechaEnvio = compras[0] ?? fechaCorte;
    }
    return { texto: t, vendedor: dueno?.nombre ?? principalNombre, fechaEnvio, nombre: t.slice(0, 120) };
  });

  const mapeo: MapeoEntrada = {
    lote: 'excel-f1',
    fechaCorte,
    vendedores,
    proveedores,
    categoriasPorPalabra,
    categoriaSinDato: 'Sin categoría (histórico)',
    estatus,
    exhibidores,
    fusiones: [],
    noFusionar: [],
    clienteSinNombre: 'Sin cliente (histórico)',
  };
  const candidatasFusion = planPersonas(l, esquemaMapeo.parse(mapeo), nuevoContexto()).candidatasFusion;
  return { mapeo, candidatasFusion };
}
