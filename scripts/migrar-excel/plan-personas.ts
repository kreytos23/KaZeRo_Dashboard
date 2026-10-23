import { porcentajeANumeric } from '../../src/domain/dinero';
import { uuidDeterminista } from './ids';
import { fechaDeCelda, llaveNombre, separarPrefijo } from './normalizar';
import { crearOrigen } from './origen';
import type { Celda, ClientePlan, Contexto, Libro, Mapeo, VendedorPlan } from './tipos';

export interface FilaPersona {
  clienteId: string | null;
  vendedorId: string | null;
}
export interface PersonasPlan {
  vendedores: VendedorPlan[];
  /** Se completa: `clienteGenerico()` agrega el cliente "sin nombre" al llamarla por primera vez. */
  clientes: ClientePlan[];
  /** llave del nombre o alias del vendedor → id del vendedor. */
  aliasVendedor: Map<string, string>;
  /** llave de cualquier nombre visto (incluidas las fusionadas) → id del cliente. */
  clientePorLlave: Map<string, string>;
  /** Pares de llaves parecidas para revisión manual (nunca se fusionan solas). */
  candidatasFusion: string[][];
  /** Fila del Concentrado → cliente y vendedor (prefijo o Comisión); filas rechazadas no aparecen. */
  filaCliente: Map<number, FilaPersona>;
  /** Fila del inventario → cliente y vendedor de esa pieza. */
  filaClienteInv: Map<number, FilaPersona>;
  /** Fila de la hoja de lealtad → cliente (null si el nombre viene vacío). */
  filaClienteLealtad: Map<number, string | null>;
  clienteGenerico: () => string;
}

/**
 * Vendedor que nombra la columna Comisión: `15% Nombre - mes`, `15% Nombre 05feb` o `Nombre - TBD`.
 * Sin porcentaje ni guion (un nombre suelto, "A favor:", "Realizada") no es un vendedor.
 */
export function vendedorDeComision(t: Celda): string | null {
  if (typeof t !== 'string') return null;
  const conPct = /^\s*\d{1,3}(?:[.,]\d+)?\s*%\s*(.+)$/.exec(t);
  const resto = conPct ? conPct[1]! : t.includes(' - ') ? t : null;
  if (!resto) return null;
  const m = /^([^\d\-–—]+?)\s*(?:[-–—]|\d|$)/.exec(resto.trim());
  const nombre = m?.[1]?.trim();
  return nombre ? nombre : null;
}

const distancia = (a: string, b: string): number => {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
};

const REDES: [RegExp, string][] = [
  [/^(ig|insta|instagram)$/, 'Instagram'],
  [/^(fb|face|facebook)$/, 'Facebook'],
];
const limpiarNombre = (t: string) => t.replace(/\s+/g, ' ').trim();
const FUENTES: Record<string, string> = {
  inventario: 'INVENTARIO',
  lealtad: 'Tarjeta de Lealtad',
  cumpleanos: 'Cumpleaños',
};

interface Acum {
  plan: ClientePlan;
  fuentes: Set<string>;
  filas: { hoja: string; fila: number }[];
  vendedores: Map<string, { n: number; ultimo: number }>;
  anioMarcador: boolean;
}

export function planPersonas(l: Libro, m: Mapeo, ctx: Contexto): PersonasPlan {
  // --- Vendedores y alias
  const vendedores: VendedorPlan[] = [];
  const aliasVendedor = new Map<string, string>();
  for (const v of m.vendedores) {
    const llave = llaveNombre(v.nombre);
    const pct = porcentajeANumeric(v.comisionPct);
    if (pct === null) throw new RangeError('Comisión inválida en el mapeo.');
    const id = uuidDeterminista(m.lote, `vend:${llave}`);
    vendedores.push({
      id,
      nombre: v.nombre.trim(),
      llave,
      tipo: v.tipo,
      comisionPct: pct,
      origen: crearOrigen(`vend:${llave}`, 'mapeo', [], v),
    });
    for (const a of [v.nombre, ...v.alias])
      if (!aliasVendedor.has(llaveNombre(a))) aliasVendedor.set(llaveNombre(a), id);
  }

  // --- Fusiones del mapeo (unión de llaves); noFusionar solo filtra candidatas
  const padre = new Map<string, string>();
  const raiz = (x: string): string => {
    let r = x;
    while (padre.has(r) && padre.get(r) !== r) r = padre.get(r)!;
    return r;
  };
  for (const g of m.fusiones) {
    const ll = g.map(llaveNombre);
    for (const x of ll) if (!padre.has(x)) padre.set(x, x);
    for (const x of ll.slice(1)) padre.set(raiz(x), raiz(ll[0]!));
  }

  // Vendedores que aparecen en Comisión (para distinguir "vendedor sin mapeo" de una simple referencia)
  const nombresComision = new Set<string>();
  for (const f of l.concentrado) {
    const n = vendedorDeComision(f.comision);
    if (n) nombresComision.add(llaveNombre(n));
  }

  // --- Clientes
  const clientes: ClientePlan[] = [];
  const acum = new Map<string, Acum>(); // por llave raíz
  const clientePorLlave = new Map<string, string>();

  function obtener(llaveOriginal: string, nombre: string, fuente: string, hoja: string, fila: number): Acum {
    const r = raiz(llaveOriginal);
    let a = acum.get(r);
    if (!a) {
      const id = uuidDeterminista(m.lote, `cli:${r}`);
      const plan: ClientePlan = {
        id,
        nombre: nombre.slice(0, 120),
        llave: r,
        referencia: null,
        cumpleanos: null,
        redSocial: null,
        usuarioRed: null,
        vendedorHabitualId: null,
        notas: '',
        origen: crearOrigen(`cli:${r}`, hoja, [fila], { nombre }),
      };
      a = { plan, fuentes: new Set(), filas: [], vendedores: new Map(), anioMarcador: false };
      acum.set(r, a);
      clientes.push(plan);
    }
    clientePorLlave.set(llaveOriginal, a.plan.id);
    clientePorLlave.set(r, a.plan.id);
    a.fuentes.add(fuente);
    a.filas.push({ hoja, fila });
    return a;
  }

  /** Cliente de una celda de nombre; `rechazada` si el prefijo parece un vendedor sin mapeo. */
  function resolver(
    celda: Celda,
    fuente: string,
    hoja: string,
    fila: number,
  ): { acum: Acum | null; vendedorId: string | null; rechazada: boolean } {
    if (typeof celda !== 'string') return { acum: null, vendedorId: null, rechazada: false };
    const sep = separarPrefijo(celda, aliasVendedor);
    if (sep.referencia && fuente === 'concentrado' && nombresComision.has(llaveNombre(sep.referencia))) {
      ctx.rechazos.push({ hoja, fila, clave: null, motivo: 'vendedor sin mapeo' });
      return { acum: null, vendedorId: null, rechazada: true };
    }
    const nombre = limpiarNombre(sep.nombre);
    const llave = llaveNombre(nombre);
    if (!llave) return { acum: null, vendedorId: null, rechazada: false };
    if (nombre.length > 120)
      ctx.avisos.push({
        hoja,
        fila,
        clave: null,
        tipo: 'nombre_recortado',
        detalle: 'Nombre de más de 120 caracteres.',
      });
    const a = obtener(llave, nombre, fuente, hoja, fila);
    if (sep.referencia && !a.plan.referencia) a.plan.referencia = sep.referencia.slice(0, 120);
    return { acum: a, vendedorId: sep.vendedor, rechazada: false };
  }

  const filaCliente = new Map<number, FilaPersona>();
  const filaClienteInv = new Map<number, FilaPersona>();
  const sumarVendedor = (a: Acum, vendedorId: string | null, orden: number) => {
    if (!vendedorId) return;
    const v = a.vendedores.get(vendedorId) ?? { n: 0, ultimo: 0 };
    a.vendedores.set(vendedorId, { n: v.n + 1, ultimo: orden });
  };

  l.concentrado.forEach((f, i) => {
    const r = resolver(f.cliente, 'concentrado', 'Concentrado', f.fila);
    if (r.rechazada) {
      ctx.filasRechazadas.add(f.fila);
      return;
    }
    const nom = vendedorDeComision(f.comision);
    const deComision = nom ? (aliasVendedor.get(llaveNombre(nom)) ?? null) : null;
    if (r.vendedorId && deComision && r.vendedorId !== deComision)
      ctx.avisos.push({
        hoja: 'Concentrado',
        fila: f.fila,
        clave: null,
        tipo: 'vendedor_conflicto',
        detalle:
          'El prefijo del cliente y la columna Comisión nombran vendedores distintos; gana el prefijo.',
      });
    const vendedorId = r.vendedorId ?? deComision;
    filaCliente.set(f.fila, { clienteId: r.acum?.plan.id ?? null, vendedorId });
    if (r.acum) sumarVendedor(r.acum, vendedorId, i);
  });

  for (const f of l.inventario) {
    const r = resolver(f.cliente, 'inventario', 'INVENTARIO', f.fila);
    const nom = typeof f.vendedor === 'string' ? aliasVendedor.get(llaveNombre(f.vendedor)) : undefined;
    if (typeof f.vendedor === 'string' && !nom)
      ctx.avisos.push({
        hoja: 'INVENTARIO',
        fila: f.fila,
        clave: null,
        tipo: 'vendedor_sin_mapeo',
        detalle: 'El vendedor del inventario no está en el mapeo.',
      });
    filaClienteInv.set(f.fila, {
      clienteId: r.acum?.plan.id ?? null,
      vendedorId: r.vendedorId ?? nom ?? null,
    });
  }

  const filaClienteLealtad = new Map<number, string | null>();
  for (const f of l.lealtad)
    filaClienteLealtad.set(
      f.fila,
      resolver(f.cliente, 'lealtad', 'Tarjeta de Lealtad', f.fila).acum?.plan.id ?? null,
    );

  // --- Cumpleaños: primero el bloque B (nombres), luego el A (usuarios de red)
  const poner = (a: Acum, f: Celda, hoja: string, fila: number) => {
    if (f == null) return;
    const iso = fechaDeCelda(f, '2100-01-01');
    if (!iso) {
      ctx.avisos.push({
        hoja,
        fila,
        clave: null,
        tipo: 'cumpleanos_invalido',
        detalle: 'La fecha de cumpleaños no es una fecha válida.',
      });
      return;
    }
    if (a.plan.cumpleanos && a.plan.cumpleanos !== iso) {
      ctx.avisos.push({
        hoja,
        fila,
        clave: null,
        tipo: 'cumpleanos_conflicto',
        detalle: 'El cliente ya tenía otra fecha de cumpleaños.',
      });
      return;
    }
    a.plan.cumpleanos = iso;
    if (iso.startsWith('2024-')) a.anioMarcador = true;
  };
  for (const f of l.cumpleanos.filter((x) => x.bloque === 'B')) {
    const r = resolver(f.nombre, 'cumpleanos', 'Cumpleaños', f.fila);
    if (r.acum) poner(r.acum, f.fecha, 'Cumpleaños', f.fila);
  }
  for (const f of l.cumpleanos.filter((x) => x.bloque === 'A')) {
    const r = resolver(f.nombre, 'cumpleanos', 'Cumpleaños', f.fila);
    if (!r.acum || typeof f.nombre !== 'string') continue;
    const redLlave = typeof f.red === 'string' ? llaveNombre(f.red) : '';
    const red =
      REDES.find(([p]) => p.test(redLlave))?.[1] ??
      (typeof f.red === 'string' ? f.red.trim().slice(0, 40) || null : null);
    if (red) r.acum.plan.redSocial = red;
    r.acum.plan.usuarioRed = f.nombre.trim().slice(0, 80);
    poner(r.acum, f.fecha, 'Cumpleaños', f.fila);
  }

  // --- Cierre de cada cliente: vendedor habitual (R-70) y notas
  for (const a of acum.values()) {
    const mejor = [...a.vendedores.entries()].sort((x, y) => y[1].n - x[1].n || y[1].ultimo - x[1].ultimo)[0];
    a.plan.vendedorHabitualId = mejor?.[0] ?? null;
    const notas: string[] = [];
    if (!a.fuentes.has('concentrado')) {
      const nombres = [...a.fuentes].map((f) => FUENTES[f] ?? f);
      notas.push(`Solo en ${nombres.join(' y ')} (Excel)`);
      ctx.avisos.push({
        hoja: a.filas[0]!.hoja,
        fila: a.filas[0]!.fila,
        clave: `cli:${a.plan.llave}`,
        tipo: 'cliente_sin_ventas',
        detalle: `Cliente que no aparece en el Concentrado: ${nombres.join(', ')}.`,
      });
    }
    if (a.anioMarcador) notas.push('Año de cumpleaños desconocido (marcador 2024 en el Excel).');
    a.plan.notas = notas.join(' ').slice(0, 2000);
  }

  // --- Candidatas a fusión (revisión manual)
  const excluidas = new Set<string>();
  for (const g of m.noFusionar) {
    const ll = g.map((x) => raiz(llaveNombre(x)));
    for (const x of ll) for (const y of ll) if (x !== y) excluidas.add(`${x}|${y}`);
  }
  const llaves = [...acum.keys()].filter((k) => k.includes(' ')).sort();
  const palabras = new Map(llaves.map((k) => [k, k.split(' ')]));
  const contenido = (a: string[], b: string[]) => a.every((p) => b.includes(p));
  const candidatasFusion: string[][] = [];
  for (let i = 0; i < llaves.length; i++)
    for (let j = i + 1; j < llaves.length; j++) {
      const a = llaves[i]!;
      const b = llaves[j]!;
      if (excluidas.has(`${a}|${b}`)) continue;
      const pa = palabras.get(a)!;
      const pb = palabras.get(b)!;
      const parecidas = pa[0] === pb[0] && distancia(a, b) <= 2;
      if (parecidas || contenido(pa, pb) || contenido(pb, pa)) candidatasFusion.push([a, b]);
    }

  const generica = llaveNombre(m.clienteSinNombre);
  const clienteGenerico = () => {
    const existente = acum.get(raiz(generica));
    if (existente) return existente.plan.id;
    const a = obtener(generica, m.clienteSinNombre.trim(), 'generico', 'mapeo', 0);
    a.plan.notas = 'Cliente genérico para ventas sin cliente (Excel).';
    return a.plan.id;
  };

  return {
    vendedores,
    clientes,
    aliasVendedor,
    clientePorLlave,
    candidatasFusion,
    filaCliente,
    filaClienteInv,
    filaClienteLealtad,
    clienteGenerico,
  };
}
