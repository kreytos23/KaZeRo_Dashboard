/**
 * Migración del Excel (Plan 7a). Uso:
 *   pnpm excel:migrar -- --modo=sugerir|simular|ensayo|aplicar --inventario "<ruta>" --tracking "<ruta>"
 *                        [--mapeo docs/migracion/mapeo.json] [--plan=<hash>] [--salida <carpeta>]
 *
 * `sugerir` y `simular` no tocan ninguna BD. La consola solo imprime conteos, el hash y rutas: los nombres y
 * montos por persona van únicamente al reporte local (carpeta ignorada por git).
 */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { leerArchivos } from './migrar-excel/leer';
import { planificar } from './migrar-excel/planificar';
import { escribirReporte } from './migrar-excel/reporte';
import { sugerirMapeo } from './migrar-excel/sugerir';
import { esquemaMapeo } from './migrar-excel/tipos';

const MODOS = ['sugerir', 'simular', 'ensayo', 'aplicar'] as const;
const FECHA_CORTE_SUGERIDA = '2026-10-03';

function salir(codigo: number, mensaje: string): never {
  console.error(mensaje);
  process.exit(codigo);
}

/** El reporte lleva datos personales: solo se escribe donde git lo ignora. */
function exigirIgnorado(ruta: string) {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', ruta], { stdio: 'ignore' });
  } catch {
    salir(
      2,
      'La carpeta de salida no está ignorada por git: el reporte lleva datos personales. Usa una bajo docs/.',
    );
  }
}

async function main() {
  const argv = process.argv.slice(2).filter((a, i) => !(a === '--' && i === 0));
  const { values } = parseArgs({
    args: argv,
    options: {
      modo: { type: 'string' },
      inventario: { type: 'string' },
      tracking: { type: 'string' },
      mapeo: { type: 'string', default: 'docs/migracion/mapeo.json' },
      plan: { type: 'string' },
      salida: { type: 'string', default: 'docs/migracion/salida' },
    },
    strict: true,
  });
  const modo = MODOS.find((m) => m === values.modo);
  if (!modo) salir(2, `Falta --modo=${MODOS.join('|')}`);
  if (!values.inventario || !values.tracking) salir(2, 'Faltan --inventario y --tracking.');
  if (modo === 'ensayo' || modo === 'aplicar')
    salir(2, `El modo ${modo} llega con las tareas 6 y 7 del plan 7a.`);

  const libro = await leerArchivos({ inventario: values.inventario, tracking: values.tracking });
  console.log(
    `Libros leídos: inventario ${libro.inventario.length} filas, concentrado ${libro.concentrado.length}, ` +
      `tarjeta ${libro.lealtad.length}, cumpleaños ${libro.cumpleanos.length}, hojas de exhibidor ${Object.keys(libro.hojasExhibidor).length}.`,
  );
  for (const a of libro.archivos) console.log(`SHA-256 ${a.rol}: ${a.sha256}`);

  if (modo === 'sugerir') {
    const { mapeo, candidatasFusion } = sugerirMapeo(libro, FECHA_CORTE_SUGERIDA);
    const destino = resolve('docs/migracion/mapeo.sugerido.json');
    exigirIgnorado(destino);
    await mkdir(dirname(destino), { recursive: true });
    await writeFile(
      destino,
      `${JSON.stringify({ ...mapeo, _candidatasFusion: candidatasFusion }, null, 2)}\n`,
      'utf8',
    );
    console.log(
      `Mapeo sugerido: ${mapeo.vendedores.length} vendedores, ${Object.keys(mapeo.estatus).length} estatus, ` +
        `${mapeo.exhibidores.length} exhibidores, ${candidatasFusion.length} candidatas a fusión.`,
    );
    console.log(`Escrito en ${destino}`);
    return;
  }

  // simular
  let crudo: unknown;
  try {
    crudo = JSON.parse(await readFile(values.mapeo!, 'utf8'));
  } catch {
    salir(2, `No se pudo leer ${values.mapeo} (¿existe y es JSON válido?). Genera uno con --modo=sugerir.`);
  }
  const parsed = esquemaMapeo.safeParse(crudo);
  if (!parsed.success)
    salir(
      2,
      `Mapeo inválido:\n${parsed.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n')}`,
    );
  const { plan, hash } = planificar(libro, parsed.data);

  const sello = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
  const dir = resolve(values.salida!, `${plan.lote}-simular-${sello}`);
  exigirIgnorado(join(dir, 'reporte.md'));
  const rutas = await escribirReporte(dir, { plan, hash, modo: 'simular' });

  const c = plan.conciliacion;
  console.log('Conteos del plan:', JSON.stringify(c.conteos));
  console.log('Piezas por estado:', JSON.stringify(c.piezasPorEstado));
  console.log(`Σ saldo: ${c.saldoTotal} centavos en ${c.saldoPorCliente.length} cliente(s).`);
  const por = <T extends object>(xs: T[], k: keyof T) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(String(x[k]), (m.get(String(x[k])) ?? 0) + 1);
    return JSON.stringify(Object.fromEntries([...m].sort((a, b) => b[1] - a[1])));
  };
  console.log(`Rechazos (${plan.rechazos.length}) por motivo:`, por(plan.rechazos, 'motivo'));
  console.log(`Avisos (${plan.avisos.length}) por tipo:`, por(plan.avisos, 'tipo'));
  console.log(`Candidatas a fusión de clientes: ${plan.candidatasFusion.length}`);
  console.log(`Hash del plan: ${hash}`);
  console.log(`Reporte (local, con datos personales): ${rutas[0]}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : 'Error desconocido');
  process.exit(1);
});
