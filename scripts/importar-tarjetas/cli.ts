/**
 * CLI de la importación de tarjetas. Uso:
 *   pnpm excel:tarjetas simular <archivo.xlsx>
 *   pnpm excel:tarjetas ensayo  <archivo.xlsx>
 *   pnpm excel:tarjetas aplicar <archivo.xlsx> --plan=<hash> [--confirmo-produccion --respaldo=<rama>]
 * Salida: 0 bien · 2 argumentos/guarda · 4 producción sin llaves · 6 plan con errores o cambiado.
 */
import { parseArgs } from 'node:util';
import { GuardaBdError, prepararDestinoDetallado } from '../lib/guarda-bd';
import { autorizarLimpieza } from '../lib/limpieza';
import { cadenaConexion, listarRamasDetalle, type RamaNeon } from '../lib/neon';
import { validarRespaldo } from '../importar-kzr/cli';
import { RUTA_ENV_LOCAL } from '../migrar-excel/cli';
import { aplicarTarjetas, ErrorPlanTarjetas, simularTarjetas } from './bd';
import { leerTarjetasArchivo } from './leer';
import { renderizarPlan } from './planificar';

export interface DependenciasTarjetas {
  leerArchivo: typeof leerTarjetasArchivo;
  prepararDestino: (
    variable: string,
    accion: string,
  ) => { url: string; esProduccion: boolean; host: string; baseDatos: string };
  simular: typeof simularTarjetas;
  aplicar: typeof aplicarTarjetas;
  ramas: () => RamaNeon[];
  hostProduccionNeon: () => string;
  ahora: () => Date;
  log: (m: string) => void;
}

export const dependenciasReales: DependenciasTarjetas = {
  leerArchivo: leerTarjetasArchivo,
  prepararDestino: (variable, accion) =>
    prepararDestinoDetallado(variable, accion, RUTA_ENV_LOCAL, { exigirHostProduccion: true }),
  simular: simularTarjetas,
  aplicar: aplicarTarjetas,
  ramas: listarRamasDetalle,
  hostProduccionNeon: () => cadenaConexion('production'),
  ahora: () => new Date(),
  log: (m) => console.log(m),
};

export async function ejecutarTarjetas(
  argv: string[],
  d: DependenciasTarjetas = dependenciasReales,
): Promise<number> {
  let a;
  try {
    a = parseArgs({
      args: argv.filter((x, i) => !(x === '--' && i === 0)),
      options: {
        plan: { type: 'string' },
        'confirmo-produccion': { type: 'boolean', default: false },
        respaldo: { type: 'string' },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (e) {
    d.log(e instanceof Error ? e.message : 'Argumentos inválidos.');
    return 2;
  }
  const [modo, archivo, ...sobran] = a.positionals;
  if (!['simular', 'ensayo', 'aplicar'].includes(modo ?? '') || !archivo || sobran.length) {
    d.log(
      'Uso: pnpm excel:tarjetas <simular|ensayo|aplicar> <archivo.xlsx> [--plan=<hash>] [--confirmo-produccion --respaldo=<rama>]',
    );
    return 2;
  }
  if (modo === 'aplicar' && !a.values.plan) {
    d.log('El modo aplicar exige --plan=<hash que dio simular>.');
    return 2;
  }
  try {
    const { filas, sha256 } = await d.leerArchivo(archivo);
    d.log(`Excel leído: ${filas.length} fila(s). SHA-256 ${sha256}`);
    const destino = d.prepararDestino('DATABASE_URL_OWNER', `Importar tarjetas (${modo})`);
    d.log(`Destino: ${destino.host}/${destino.baseDatos}${destino.esProduccion ? ' (PRODUCCIÓN)' : ''}`);
    if (modo === 'simular') {
      const plan = await d.simular(destino.url, filas);
      for (const l of renderizarPlan(plan)) d.log(l);
      d.log('Simulación de solo lectura: no se escribió nada.');
      return plan.errores.length ? 6 : 0;
    }
    if (modo === 'aplicar' && destino.esProduccion) {
      try {
        const ramas = a.values['confirmo-produccion'] && a.values.respaldo ? d.ramas() : [];
        autorizarLimpieza(
          { esProduccion: true, esDevelopment: false, otraBd: false, ramas: ramas.map((r) => r.name) },
          {
            confirmoProduccion: a.values['confirmo-produccion']!,
            confirmoDevelopment: false,
            respaldo: a.values.respaldo,
          },
        );
        validarRespaldo(ramas, a.values.respaldo!, {
          ahora: d.ahora(),
          hostDestino: destino.host,
          hostProduccionNeon: d.hostProduccionNeon(),
        });
      } catch (e) {
        if (!(e instanceof GuardaBdError)) throw e;
        d.log(
          `${e.message} (aplicar en producción exige --confirmo-produccion y --respaldo=<rama de las últimas 24 h>).`,
        );
        return 4;
      }
    }
    const r = await d.aplicar(destino.url, filas, {
      modo: modo as 'ensayo' | 'aplicar',
      hashEsperado: a.values.plan,
    });
    for (const l of renderizarPlan(r.plan)) d.log(l);
    d.log(
      `${modo === 'ensayo' ? 'Ensayo (deshecho con ROLLBACK)' : 'Aplicado'}: ${r.creadas} creadas, ${r.actualizadas} actualizadas.`,
    );
    return 0;
  } catch (e) {
    if (e instanceof GuardaBdError) {
      d.log(e.message);
      return 2;
    }
    if (e instanceof ErrorPlanTarjetas) {
      d.log(`${e.message} No se escribió nada.`);
      for (const l of renderizarPlan(e.plan)) d.log(l);
      return 6;
    }
    throw e;
  }
}
