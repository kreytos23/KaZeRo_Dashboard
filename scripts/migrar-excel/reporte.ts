import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { centavosANumeric } from '../../src/domain/dinero';
import type { PlanImportacion, ResultadoBd } from './tipos';

/** Celda CSV: escapa la inyección de fórmulas (`= + - @ \t \r` al inicio, spec §7) y las comillas. */
export function csvCelda(v: unknown): string {
  let t = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}
const csv = (filas: unknown[][]) => `${filas.map((f) => f.map(csvCelda).join(',')).join('\n')}\n`;
const pesos = (c: number) => centavosANumeric(Math.max(0, c));
const celdaMd = (t: string) => t.replace(/\|/g, '/').replace(/\s+/g, ' ');

function agrupar<T>(xs: T[], clave: (x: T) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const x of xs) m.set(clave(x), (m.get(clave(x)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * Escribe `reporte.md` y los CSV en `dir` (se crea). Lleva nombres reales porque quien migra debe cotejarlos:
 * solo debe apuntar a una carpeta ignorada por git. Devuelve las rutas escritas.
 */
export async function escribirReporte(
  dir: string,
  r: { plan: PlanImportacion; hash: string; modo: string; destino?: string; bd?: ResultadoBd },
): Promise<string[]> {
  const { plan } = r;
  const c = plan.conciliacion;
  const cliente = new Map(plan.clientes.map((x) => [x.id, x]));
  const vendedor = new Map(plan.vendedores.map((x) => [x.id, x]));
  const pagadoPor = new Map<string, number>();
  for (const p of plan.pagos) pagadoPor.set(p.pedidoId, (pagadoPor.get(p.pedidoId) ?? 0) + p.monto);
  const nombre = (id: string) => cliente.get(id)?.nombre ?? id;

  // --- reporte.md
  const md: string[] = [];
  md.push(`# Reporte de migración (${r.modo})`, '');
  md.push(`- Lote: \`${plan.lote}\``, `- Hash del plan: \`${r.hash}\``);
  if (r.destino) md.push(`- Destino: ${r.destino}`);
  for (const a of plan.archivos) md.push(`- Archivo ${a.rol}: SHA-256 \`${a.sha256}\` (${a.bytes} B)`);
  if (r.bd) {
    const v = r.bd.verificacion;
    md.push(`- Verificación en BD: ${v.ok ? 'correcta' : `con diferencias (${v.diferencias.length})`}`);
    md.push(`- Siguiente folio de la app: ${r.bd.siguienteFolio}`, `- Ya aplicados: ${r.bd.yaAplicados}`);
    md.push('', '## Resultado en la BD', '', '| Tabla | Insertadas |', '|---|---:|');
    for (const [k, v2] of Object.entries(r.bd.insertados)) md.push(`| ${k} | ${v2} |`);
    md.push('', '| Reutilizados de la app | Total |', '|---|---:|');
    for (const [k, v2] of Object.entries(r.bd.reutilizados)) md.push(`| ${k} | ${v2} |`);
    md.push('', `Filas cambiadas desde la última aplicación (no se aplican): ${r.bd.cambiados.length}`);
    md.push(
      '',
      `### Avisos y rechazos en la BD (${r.bd.rechazosEnBd.length})`,
      '',
      '| Motivo | Casos |',
      '|---|---:|',
    );
    for (const [k, v2] of agrupar(r.bd.rechazosEnBd, (x) => x.motivo)) md.push(`| ${celdaMd(k)} | ${v2} |`);
  }
  md.push('', '## Conteos', '', '| Entidad | Total |', '|---|---:|');
  for (const [k, v] of Object.entries(c.conteos)) md.push(`| ${k} | ${v} |`);
  md.push('', '## Piezas por estado', '', '| Estado | Piezas |', '|---|---:|');
  for (const [k, v] of Object.entries(c.piezasPorEstado)) md.push(`| ${k} | ${v} |`);
  md.push(
    '',
    '## Totales por mes',
    '',
    '| Mes | Pedidos | Total | Pagado | Saldo |',
    '|---|---:|---:|---:|---:|',
  );
  for (const x of c.porMes)
    md.push(`| ${x.mes} | ${x.pedidos} | ${pesos(x.total)} | ${pesos(x.pagado)} | ${pesos(x.saldo)} |`);
  md.push(
    '',
    `## Saldos`,
    '',
    `Σ saldo: **${pesos(c.saldoTotal)}** en ${c.saldoPorCliente.length} cliente(s).`,
    '',
  );
  md.push('Los 20 mayores:', '', '| Cliente | Saldo |', '|---|---:|');
  for (const s of c.saldoPorCliente.slice(0, 20))
    md.push(`| ${celdaMd(nombre(s.clienteId))} | ${pesos(s.saldo)} |`);
  md.push(
    '',
    '## Tarjeta de lealtad por cliente',
    '',
    '| Cliente | Ciclos | Contadas | Apartadas |',
    '|---|---:|---:|---:|',
  );
  const porCliente = new Map<string, { ciclos: number; contadas: number; apartadas: number }>();
  for (const t of c.tarjeta) {
    const x = porCliente.get(t.clienteId) ?? { ciclos: 0, contadas: 0, apartadas: 0 };
    porCliente.set(t.clienteId, {
      ciclos: Math.max(x.ciclos, t.ciclo),
      contadas: x.contadas + (t.estado === 'liquidado' ? 1 : 0),
      apartadas: x.apartadas + (t.estado === 'abierto' ? 1 : 0),
    });
  }
  for (const [id, x] of [...porCliente].sort((a, b) => nombre(a[0]).localeCompare(nombre(b[0]))))
    md.push(`| ${celdaMd(nombre(id))} | ${x.ciclos} | ${x.contadas} | ${x.apartadas} |`);
  md.push('', `## Rechazos (${plan.rechazos.length})`, '', '| Motivo | Filas |', '|---|---:|');
  for (const [k, v] of agrupar(plan.rechazos, (x) => x.motivo)) md.push(`| ${celdaMd(k)} | ${v} |`);
  md.push('', `## Avisos (${plan.avisos.length})`, '', '| Tipo | Casos |', '|---|---:|');
  for (const [k, v] of agrupar(plan.avisos, (x) => x.tipo)) md.push(`| ${celdaMd(k)} | ${v} |`);
  md.push('', `## Candidatas a fusión de clientes (${plan.candidatasFusion.length})`, '');
  for (const par of plan.candidatasFusion) md.push(`- ${par.map(celdaMd).join(' ↔ ')}`);
  if (r.bd?.verificacion.diferencias.length)
    md.push(
      '',
      '## Diferencias con la BD',
      '',
      ...r.bd.verificacion.diferencias.map((d) => `- ${celdaMd(d)}`),
    );

  // --- CSV
  const saldoCliente = new Map(c.saldoPorCliente.map((s) => [s.clienteId, s.saldo]));
  const pedidosCliente = new Map<string, number>();
  for (const p of plan.pedidos) pedidosCliente.set(p.clienteId, (pedidosCliente.get(p.clienteId) ?? 0) + 1);
  const archivos: [string, string][] = [
    ['reporte.md', `${md.join('\n')}\n`],
    [
      'rechazos.csv',
      csv([
        ['hoja', 'fila', 'clave', 'motivo'],
        ...plan.rechazos.map((x) => [x.hoja, x.fila, x.clave, x.motivo]),
      ]),
    ],
    [
      'avisos.csv',
      csv([
        ['hoja', 'fila', 'clave', 'tipo', 'detalle'],
        ...plan.avisos.map((x) => [x.hoja, x.fila, x.clave, x.tipo, x.detalle]),
      ]),
    ],
    [
      'pedidos.csv',
      csv([
        [
          'folio',
          'folio_original',
          'tipo',
          'cliente',
          'vendedor',
          'fecha',
          'estado',
          'cuenta_tarjeta',
          'ciclo',
          'posicion',
          'lineas',
          'total',
          'pagado',
          'saldo',
          'descuento_manual',
          'motivo',
          'notas',
        ],
        ...plan.pedidos.map((p) => {
          const pagado = pagadoPor.get(p.id) ?? 0;
          return [
            p.folio,
            p.folioOriginal,
            p.tipo,
            nombre(p.clienteId),
            vendedor.get(p.vendedorId)?.nombre,
            p.fecha,
            p.estado,
            p.cuentaTarjeta,
            p.ciclo,
            p.posicion,
            p.items.length,
            pesos(p.total),
            pesos(pagado),
            pesos(p.total - pagado),
            pesos(p.descuentoManual),
            p.descuentoManualMotivo,
            p.notas,
          ];
        }),
      ]),
    ],
    [
      'tarjeta.csv',
      csv([
        ['cliente', 'ciclo', 'posicion', 'estado', 'folio'],
        ...c.tarjeta.map((t) => [nombre(t.clienteId), t.ciclo, t.posicion, t.estado, t.folio]),
      ]),
    ],
    [
      'clientes.csv',
      csv([
        [
          'cliente',
          'referencia',
          'cumpleanos',
          'red_social',
          'usuario_red',
          'vendedor_habitual',
          'pedidos',
          'saldo',
          'notas',
        ],
        ...plan.clientes.map((x) => [
          x.nombre,
          x.referencia,
          x.cumpleanos,
          x.redSocial,
          x.usuarioRed,
          x.vendedorHabitualId ? vendedor.get(x.vendedorHabitualId)?.nombre : null,
          pedidosCliente.get(x.id) ?? 0,
          pesos(saldoCliente.get(x.id) ?? 0),
          x.notas,
        ]),
      ]),
    ],
  ];
  if (r.bd)
    archivos.push(
      [
        'rechazos-bd.csv',
        csv([
          ['hoja', 'fila', 'clave', 'motivo'],
          ...r.bd.rechazosEnBd.map((x) => [x.hoja, x.fila, x.clave, x.motivo]),
        ]),
      ],
      ['cambiados.csv', csv([['hoja', 'clave'], ...r.bd.cambiados.map((x) => [x.hoja, x.clave])])],
    );
  await mkdir(dir, { recursive: true });
  const rutas: string[] = [];
  for (const [nombreArchivo, contenido] of archivos) {
    const ruta = join(dir, nombreArchivo);
    await writeFile(ruta, contenido, 'utf8');
    rutas.push(ruta);
  }
  return rutas;
}
