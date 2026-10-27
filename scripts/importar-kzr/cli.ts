/**
 * CLI de la importación de notas KZR históricas, con dependencias inyectables para probarla sin BD.
 * Uso: pnpm excel:kzr <simular|ensayo|aplicar> <archivo.xlsx> [--plan=<hash>] [--confirmo-produccion --respaldo=<rama>]
 * Códigos de salida: 0 bien · 1 error inesperado · 2 argumentos/guarda/ensayo no aprobado · 3 el plan cambió
 * · 4 producción sin las llaves (--confirmo-produccion y --respaldo=<rama existente>) · 5 la verificación no cuadró
 * · 6 el plan tiene errores (nada se escribió).
 * `aplicar` exige --plan=<hash de simular> y un ensayo correcto de ese mismo plan contra ESTE destino
 * (marcador `<salida>/ensayo-kzr-<destino>.json`, sin datos personales). La consola solo lleva destino, ids
 * cortos, iniciales, conteos y el hash: el reporte no se escribe en ningún archivo.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { hoyMX } from '../../src/domain/fechas';
import { GuardaBdError, hostNormalizado, prepararDestinoDetallado } from '../lib/guarda-bd';
import { autorizarLimpieza } from '../lib/limpieza';
import { listarRamas } from '../lib/neon';
import { exigirIgnoradoGit, RUTA_ENV_LOCAL } from '../migrar-excel/cli';
import {
  aplicarKzr,
  ErrorPlanCambio,
  ErrorPlanConErrores,
  ErrorVerificacionKzr,
  simular,
  type ResultadoKzr,
} from './bd';
import { leerFilasArchivo } from './leer';
import { renderizarReporte } from './planificar';
import type { FilaExcel, PlanKzr } from './tipos';

export const MODOS = ['simular', 'ensayo', 'aplicar'] as const;
export type Modo = (typeof MODOS)[number];

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
  archivo: string;
  plan?: string;
  salida: string;
  confirmoProduccion: boolean;
  respaldo?: string;
}

export function parsearArgumentos(argv: string[]): Argumentos {
  let r;
  try {
    r = parseArgs({
      args: argv.filter((a, i) => !(a === '--' && i === 0)),
      options: {
        plan: { type: 'string' },
        salida: { type: 'string', default: 'docs/importacion/salida' },
        'confirmo-produccion': { type: 'boolean', default: false },
        respaldo: { type: 'string' },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (e) {
    throw new ErrorCli(2, e instanceof Error ? e.message : 'Argumentos inválidos.');
  }
  const [modoTexto, archivo, ...sobran] = r.positionals;
  const modo = MODOS.find((m) => m === modoTexto);
  if (!modo || !archivo || sobran.length)
    throw new ErrorCli(2, `Uso: pnpm excel:kzr <${MODOS.join('|')}> <archivo.xlsx> [opciones]`);
  if (modo === 'aplicar' && !r.values.plan)
    throw new ErrorCli(
      2,
      'El modo aplicar exige --plan=<hash del plan aprobado> (sale de simular y de ensayo).',
    );
  return {
    modo,
    archivo,
    plan: r.values.plan,
    salida: r.values.salida!,
    confirmoProduccion: r.values['confirmo-produccion']!,
    respaldo: r.values.respaldo,
  };
}

/** Lo que deja un ensayo correcto para su destino (sin secretos ni datos personales). */
export interface EnsayoGuardado {
  hashPlan: string;
  fecha: string;
}

export interface Dependencias {
  leerArchivo: (ruta: string) => Promise<{ filas: FilaExcel[]; sha256: string }>;
  prepararDestino: (
    variable: string,
    accion: string,
  ) => { url: string; esProduccion: boolean; host: string; baseDatos: string };
  simular: typeof simular;
  aplicar: typeof aplicarKzr;
  ramas: () => string[];
  leerEnsayo: (ruta: string) => Promise<EnsayoGuardado | null>;
  guardarEnsayo: (ruta: string, datos: EnsayoGuardado) => Promise<void>;
  exigirIgnorado: (ruta: string) => void;
  hoy: () => string;
  log: (mensaje: string) => void;
}

export const dependenciasReales: Dependencias = {
  leerArchivo: leerFilasArchivo,
  prepararDestino: (variable, accion) =>
    prepararDestinoDetallado(variable, accion, RUTA_ENV_LOCAL, { exigirHostProduccion: true }),
  simular,
  aplicar: aplicarKzr,
  ramas: listarRamas,
  leerEnsayo: async (ruta) => {
    try {
      const x = JSON.parse(await readFile(ruta, 'utf8')) as Partial<EnsayoGuardado>;
      return typeof x.hashPlan === 'string' ? { hashPlan: x.hashPlan, fecha: String(x.fecha ?? '') } : null;
    } catch {
      return null;
    }
  },
  guardarEnsayo: async (ruta, datos) => {
    await mkdir(dirname(ruta), { recursive: true });
    await writeFile(ruta, `${JSON.stringify(datos, null, 2)}\n`, 'utf8');
  },
  exigirIgnorado: exigirIgnoradoGit,
  hoy: () => hoyMX(),
  log: (m) => console.log(m),
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
    if (e instanceof ErrorPlanConErrores) {
      d.log(`${e.message} Corrige el Excel o los datos y vuelve a simular.`);
      for (const l of renderizarReporte(e.plan)) d.log(l);
      return 6;
    }
    if (e instanceof ErrorPlanCambio) {
      d.log(`${e.message} (esperado ${e.esperado}, calculado ${e.calculado}). Vuelve a simular y ensayar.`);
      return 3;
    }
    if (e instanceof ErrorVerificacionKzr) {
      d.log(`${e.message}`);
      for (const x of e.diferencias) d.log(`  - ${x}`);
      return 5;
    }
    throw e;
  }
}

async function correr(a: Argumentos, d: Dependencias): Promise<number> {
  const { filas, sha256 } = await d.leerArchivo(a.archivo);
  d.log(`Excel leído: ${filas.length} fila(s) de piezas. SHA-256 ${sha256}`);

  const destino = d.prepararDestino('DATABASE_URL_OWNER', `Importar notas KZR (${a.modo})`);
  const hoy = d.hoy();

  if (a.modo === 'simular') {
    const plan = await d.simular(destino.url, filas, hoy);
    for (const l of renderizarReporte(plan)) d.log(l);
    d.log('Simulación de solo lectura: no se escribió nada.');
    return plan.errores.length ? 6 : 0;
  }

  // Producción exige las dos llaves (bandera + rama de respaldo que exista) para aplicar; el ensayo hace ROLLBACK.
  if (a.modo === 'aplicar' && destino.esProduccion) {
    try {
      autorizarLimpieza(
        {
          esProduccion: true,
          esDevelopment: false,
          otraBd: false,
          ramas: a.confirmoProduccion && a.respaldo ? d.ramas() : [],
        },
        { confirmoProduccion: a.confirmoProduccion, confirmoDevelopment: false, respaldo: a.respaldo },
      );
    } catch (e) {
      if (!(e instanceof GuardaBdError)) throw e;
      d.log(
        `${e.message} (aplicar en producción exige --confirmo-produccion y --respaldo=<rama Neon existente>).`,
      );
      return 4;
    }
  }

  const rutaEnsayo = resolve(
    a.salida,
    `ensayo-kzr-${createHash('sha256')
      .update(`${hostNormalizado(destino.host)}/${destino.baseDatos}`)
      .digest('hex')
      .slice(0, 16)}.json`,
  );
  d.exigirIgnorado(rutaEnsayo);
  if (a.modo === 'aplicar') {
    const guardado = await d.leerEnsayo(rutaEnsayo);
    if (!guardado || guardado.hashPlan !== a.plan) {
      d.log(
        'No hay un ensayo correcto de este plan contra este mismo destino. ' +
          'Corre ensayo contra este destino (el hash debe ser el de --plan) antes de aplicar.',
      );
      return 2;
    }
  }

  const r: ResultadoKzr = await d.aplicar(destino.url, filas, {
    modo: a.modo,
    hoy,
    ...(a.plan ? { hashEsperado: a.plan } : {}),
  });
  return terminar(a, d, r, rutaEnsayo);
}

async function terminar(
  a: Argumentos,
  d: Dependencias,
  r: ResultadoKzr,
  rutaEnsayo: string,
): Promise<number> {
  for (const l of renderizarReporte(r.plan)) d.log(l);
  d.log(
    `Insertados (${a.modo === 'ensayo' ? 'y deshechos con ROLLBACK' : 'confirmados'}): ${JSON.stringify(r.insertados)} · ` +
      `ya importadas: ${r.yaAplicadas}`,
  );
  d.log(
    `Verificación: ${r.verificacion.ok ? 'correcta' : 'con diferencias'} · siguiente folio ${r.siguienteFolio}` +
      (a.modo === 'ensayo' ? ' (esperado: el ensayo no toca la secuencia)' : ' (secuencia ya ajustada)'),
  );
  if (a.modo === 'ensayo') {
    await d.guardarEnsayo(rutaEnsayo, { hashPlan: r.plan.hash, fecha: new Date().toISOString() });
    d.log(`Para aplicar en este mismo destino: pnpm excel:kzr aplicar <archivo.xlsx> --plan=${r.plan.hash}`);
  }
  return 0;
}

export type { PlanKzr };
