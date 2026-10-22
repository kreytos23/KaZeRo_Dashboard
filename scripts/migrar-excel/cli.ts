/**
 * Lógica de la CLI de migración (Plan 7a, Task 7), con dependencias inyectables para probarla sin BD.
 * Códigos de salida: 0 bien · 1 error inesperado · 2 argumentos/mapeo/guarda · 3 el plan cambió desde el reporte
 * aprobado · 4 producción sin --confirmo-produccion · 5 la verificación no cuadró (ROLLBACK).
 * La consola solo lleva destino (de la guarda), conteos, hash y rutas: nombres y montos por persona van al reporte.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { GuardaBdError, prepararDestinoDetallado } from '../lib/guarda-bd';
import { aplicarPlan, ErrorVerificacion } from './aplicar';
import { leerArchivos } from './leer';
import { planificar } from './planificar';
import { escribirReporte } from './reporte';
import { sugerirMapeo } from './sugerir';
import { esquemaMapeo, type Libro, type Mapeo, type ResultadoBd } from './tipos';

export const MODOS = ['sugerir', 'simular', 'ensayo', 'aplicar'] as const;
export type Modo = (typeof MODOS)[number];
const FECHA_CORTE_SUGERIDA = '2026-10-03';

export class ErrorCli extends Error {
  override name = 'ErrorCli';
  constructor(
    readonly codigo: number,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

export interface Argumentos {
  modo: Modo;
  inventario: string;
  tracking: string;
  mapeo: string;
  plan?: string;
  salida: string;
  confirmoProduccion: boolean;
}

export function parsearArgumentos(argv: string[]): Argumentos {
  const args = argv.filter((a, i) => !(a === '--' && i === 0));
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        modo: { type: 'string' },
        inventario: { type: 'string' },
        tracking: { type: 'string' },
        mapeo: { type: 'string', default: 'docs/migracion/mapeo.json' },
        plan: { type: 'string' },
        salida: { type: 'string', default: 'docs/migracion/salida' },
        'confirmo-produccion': { type: 'boolean', default: false },
      },
      strict: true,
    }));
  } catch (e) {
    throw new ErrorCli(2, e instanceof Error ? e.message : 'Argumentos inválidos.');
  }
  const modo = MODOS.find((m) => m === values.modo);
  if (!modo) throw new ErrorCli(2, `Falta --modo=${MODOS.join('|')}`);
  if (!values.inventario || !values.tracking) throw new ErrorCli(2, 'Faltan --inventario y --tracking.');
  if (modo === 'aplicar' && !values.plan)
    throw new ErrorCli(
      2,
      'El modo aplicar exige --plan=<hash del reporte aprobado> (sale de --modo=simular).',
    );
  return {
    modo,
    inventario: values.inventario,
    tracking: values.tracking,
    mapeo: values.mapeo!,
    plan: values.plan,
    salida: values.salida!,
    confirmoProduccion: values['confirmo-produccion']!,
  };
}

export interface Dependencias {
  leerArchivos: (o: { inventario: string; tracking: string }) => Promise<Libro>;
  cargarMapeo: (ruta: string) => Promise<Mapeo>;
  prepararDestino: (variable: string, accion: string) => { url: string; esProduccion: boolean };
  aplicarPlan: typeof aplicarPlan;
  escribirReporte: typeof escribirReporte;
  exigirIgnorado: (ruta: string) => void;
  escribirMapeoSugerido: (contenido: unknown) => Promise<string>;
  log: (mensaje: string) => void;
}

/** El reporte lleva datos personales: solo se escribe donde git lo ignora. */
function exigirIgnoradoGit(ruta: string) {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', ruta], { stdio: 'ignore' });
  } catch {
    throw new ErrorCli(
      2,
      'La carpeta de salida no está ignorada por git: el reporte lleva datos personales. Usa una bajo docs/.',
    );
  }
}

async function cargarMapeoArchivo(ruta: string): Promise<Mapeo> {
  let crudo: unknown;
  try {
    crudo = JSON.parse(await readFile(ruta, 'utf8'));
  } catch {
    throw new ErrorCli(
      2,
      `No se pudo leer ${ruta} (¿existe y es JSON válido?). Genera uno con --modo=sugerir.`,
    );
  }
  const parsed = esquemaMapeo.safeParse(crudo);
  if (!parsed.success)
    throw new ErrorCli(
      2,
      `Mapeo inválido:\n${parsed.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n')}`,
    );
  return parsed.data;
}

export const dependenciasReales: Dependencias = {
  leerArchivos,
  cargarMapeo: cargarMapeoArchivo,
  prepararDestino: (variable, accion) => prepararDestinoDetallado(variable, accion),
  aplicarPlan,
  escribirReporte,
  exigirIgnorado: exigirIgnoradoGit,
  escribirMapeoSugerido: async (contenido) => {
    const destino = resolve('docs/migracion/mapeo.sugerido.json');
    exigirIgnoradoGit(destino);
    await mkdir(dirname(destino), { recursive: true });
    await writeFile(destino, `${JSON.stringify(contenido, null, 2)}\n`, 'utf8');
    return destino;
  },
  log: (m) => console.log(m),
};

const porClave = <T extends object>(xs: T[], k: keyof T) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(String(x[k]), (m.get(String(x[k])) ?? 0) + 1);
  return JSON.stringify(Object.fromEntries([...m].sort((a, b) => b[1] - a[1])));
};

/** Corre la CLI y devuelve el código de salida (no llama a process.exit). */
export async function ejecutar(argv: string[], d: Dependencias = dependenciasReales): Promise<number> {
  try {
    return await correr(parsearArgumentos(argv), d);
  } catch (e) {
    if (e instanceof ErrorCli) {
      d.log(e.message);
      return e.codigo;
    }
    if (e instanceof GuardaBdError) {
      d.log(e.message);
      return 2;
    }
    throw e;
  }
}

async function correr(a: Argumentos, d: Dependencias): Promise<number> {
  const libro = await d.leerArchivos({ inventario: a.inventario, tracking: a.tracking });
  d.log(
    `Libros leídos: inventario ${libro.inventario.length} filas, concentrado ${libro.concentrado.length}, ` +
      `tarjeta ${libro.lealtad.length}, cumpleaños ${libro.cumpleanos.length}, hojas de exhibidor ${Object.keys(libro.hojasExhibidor).length}.`,
  );
  for (const x of libro.archivos) d.log(`SHA-256 ${x.rol}: ${x.sha256}`);

  if (a.modo === 'sugerir') {
    const { mapeo, candidatasFusion } = sugerirMapeo(libro, FECHA_CORTE_SUGERIDA);
    const destino = await d.escribirMapeoSugerido({ ...mapeo, _candidatasFusion: candidatasFusion });
    d.log(
      `Mapeo sugerido: ${mapeo.vendedores.length} vendedores, ${Object.keys(mapeo.estatus).length} estatus, ` +
        `${mapeo.exhibidores.length} exhibidores, ${candidatasFusion.length} candidatas a fusión.`,
    );
    d.log(`Escrito en ${destino}`);
    return 0;
  }

  const { plan, hash } = planificar(libro, await d.cargarMapeo(a.mapeo));
  const c = plan.conciliacion;
  d.log(`Conteos del plan: ${JSON.stringify(c.conteos)}`);
  d.log(`Piezas por estado: ${JSON.stringify(c.piezasPorEstado)}`);
  d.log(`Σ saldo: ${c.saldoTotal} centavos en ${c.saldoPorCliente.length} cliente(s).`);
  d.log(`Rechazos (${plan.rechazos.length}) por motivo: ${porClave(plan.rechazos, 'motivo')}`);
  d.log(`Avisos (${plan.avisos.length}) por tipo: ${porClave(plan.avisos, 'tipo')}`);
  d.log(`Candidatas a fusión de clientes: ${plan.candidatasFusion.length}`);
  d.log(`Hash del plan: ${hash}`);

  const sello = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
  const dir = resolve(a.salida, `${plan.lote}-${a.modo}-${sello}`);
  d.exigirIgnorado(join(dir, 'reporte.md'));

  if (a.modo === 'simular') {
    const rutas = await d.escribirReporte(dir, { plan, hash, modo: a.modo });
    d.log(`Reporte (local, con datos personales): ${rutas[0]}`);
    return 0;
  }

  // ensayo / aplicar: el plan aprobado (por hash) antes de abrir cualquier conexión.
  if (a.modo === 'aplicar' && a.plan !== hash) {
    d.log(
      `El plan cambió desde el reporte aprobado (esperado ${a.plan}, calculado ${hash}). Vuelve a simular y aprobar.`,
    );
    return 3;
  }
  const destino = d.prepararDestino('DATABASE_URL_OWNER', `Migración Excel ${a.modo} (lote ${plan.lote})`);
  if (destino.esProduccion && a.modo === 'aplicar' && !a.confirmoProduccion) {
    d.log(
      'Destino = PRODUCCIÓN: aplicar exige además --confirmo-produccion (dos llaves: variable y bandera).',
    );
    return 4;
  }

  let bd: ResultadoBd;
  let codigo = 0;
  try {
    bd = await d.aplicarPlan(destino.url, plan, { modo: a.modo });
  } catch (e) {
    if (!(e instanceof ErrorVerificacion)) throw e;
    d.log(
      `La verificación no cuadró: ${e.diferencias.length} diferencia(s). ROLLBACK: no quedó nada en la BD.`,
    );
    if (!e.resultado) return 5;
    bd = e.resultado;
    codigo = 5;
  }
  const t = (x: Record<string, number>) => JSON.stringify(x);
  d.log(
    `Insertados (${a.modo === 'ensayo' ? 'y deshechos con ROLLBACK' : 'confirmados'}): ${t(bd.insertados)}`,
  );
  d.log(`Ya aplicados: ${bd.yaAplicados} · cambiados (no se aplican): ${bd.cambiados.length}`);
  d.log(`Reutilizados de la app: ${t(bd.reutilizados)}`);
  d.log(
    `Avisos y rechazos en BD (${bd.rechazosEnBd.length}) por motivo: ${porClave(bd.rechazosEnBd, 'motivo')}`,
  );
  d.log(
    `Verificación: ${bd.verificacion.ok ? 'correcta' : 'con diferencias'} · siguiente folio ${bd.siguienteFolio}`,
  );
  const rutas = await d.escribirReporte(dir, { plan, hash, modo: a.modo, bd });
  d.log(`Reporte (local, con datos personales): ${rutas[0]}`);
  return codigo;
}
