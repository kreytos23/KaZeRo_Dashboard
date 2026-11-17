/** Plan puro de la importación de tarjetas (2026-11-16, L-0 a L-6). Errores por número de fila: sin nombres. */
import { createHash } from 'node:crypto';
import { normalizar } from '../../src/domain/texto';
import type { FilaTarjeta } from './leer';

export interface ClienteBd {
  id: string;
  nombre: string;
  comprasPrevias: number;
  vendedorHabitualId: string | null;
  conNotasCiclo1: boolean;
}
export interface VendedoraBd {
  id: string;
  nombre: string;
  activo: boolean;
}
export interface PlanTarjetas {
  crear: { nombre: string; comprasPrevias: number; vendedorId: string }[];
  actualizar: { clienteId: string; comprasPrevias: number; vendedorId: string }[];
  sinCambios: number;
  errores: string[];
  vendedoras: { excel: string; vendedorId: string; nombre: string; clientas: number }[];
  hash: string;
}

const primerNombre = (t: string) => normalizar(t).split(' ')[0] ?? '';

export function planificarTarjetas(
  filas: readonly FilaTarjeta[],
  bd: { clientes: readonly ClienteBd[]; vendedoras: readonly VendedoraBd[] },
): PlanTarjetas {
  const errores: string[] = [];
  const crear: PlanTarjetas['crear'] = [];
  const actualizar: PlanTarjetas['actualizar'] = [];
  let sinCambios = 0;
  const vistos = new Map<string, number>();
  const usoVendedora = new Map<
    string,
    { excel: string; vendedorId: string; nombre: string; clientas: number }
  >();
  const clientesPorNombre = new Map<string, ClienteBd[]>();
  for (const c of bd.clientes) {
    const nombreNormalizado = normalizar(c.nombre);
    clientesPorNombre.set(nombreNormalizado, [...(clientesPorNombre.get(nombreNormalizado) ?? []), c]);
  }
  const activas = bd.vendedoras.filter((v) => v.activo);

  for (const f of filas) {
    const nombre = [f.nombre, f.apellido].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (!nombre || nombre.length > 120) {
      errores.push(`fila ${f.fila}: falta el nombre o pasa de 120 caracteres.`);
      continue;
    }
    const clave = normalizar(nombre);
    if (vistos.has(clave)) {
      errores.push(`fila ${f.fila}: nombre repetido (igual que la fila ${vistos.get(clave)}).`);
      continue;
    }
    vistos.set(clave, f.fila);
    const compras = typeof f.compras === 'number' ? f.compras : NaN;
    if (!Number.isInteger(compras) || compras < 0 || compras > 9) {
      errores.push(`fila ${f.fila}: «# de compra» debe ser un entero de 0 a 9.`);
      continue;
    }
    const excel = f.vendedor ?? '';
    const candidatas = activas.filter((v) => primerNombre(v.nombre) === primerNombre(excel));
    if (candidatas.length !== 1) {
      errores.push(
        candidatas.length === 0
          ? `fila ${f.fila}: la vendedora «${excel}» no existe o no está activa.`
          : `fila ${f.fila}: «${excel}» coincide con más de una vendedora.`,
      );
      continue;
    }
    const v = candidatas[0]!;
    const uso = usoVendedora.get(normalizar(excel)) ?? {
      excel,
      vendedorId: v.id,
      nombre: v.nombre,
      clientas: 0,
    };
    uso.clientas += 1;
    usoVendedora.set(normalizar(excel), uso);

    const existentes = clientesPorNombre.get(clave) ?? [];
    if (existentes.length > 1) {
      errores.push(`fila ${f.fila}: hay más de una clienta con ese nombre en la BD.`);
      continue;
    }
    const c = existentes[0];
    if (!c) {
      crear.push({ nombre, comprasPrevias: compras, vendedorId: v.id });
      continue;
    }
    if (c.comprasPrevias === compras && c.vendedorHabitualId === v.id) {
      sinCambios += 1;
      continue;
    }
    if (c.comprasPrevias !== compras && c.conNotasCiclo1) {
      errores.push(`fila ${f.fila}: la clienta ya tiene notas en su primera tarjeta (L-5).`);
      continue;
    }
    actualizar.push({ clienteId: c.id, comprasPrevias: compras, vendedorId: v.id });
  }

  const orden = <T>(xs: T[], k: (x: T) => string) =>
    [...xs].sort((a, b) => {
      const x = k(a);
      const y = k(b);
      return x < y ? -1 : x > y ? 1 : 0;
    });
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        crear: orden(crear, (x) => normalizar(x.nombre)),
        actualizar: orden(actualizar, (x) => x.clienteId),
      }),
    )
    .digest('hex')
    .slice(0, 16);
  return {
    crear,
    actualizar,
    sinCambios,
    errores,
    vendedoras: orden([...usoVendedora.values()], (x) => normalizar(x.excel)),
    hash,
  };
}

/** Reporte de consola: conteos, vendedoras y errores por fila. Nunca nombres de clientas. */
export function renderizarPlan(p: PlanTarjetas): string[] {
  return [
    `Crear: ${p.crear.length} · Actualizar: ${p.actualizar.length} · Sin cambios: ${p.sinCambios} · Errores: ${p.errores.length}`,
    'Vendedoras (Excel → sistema):',
    ...p.vendedoras.map((v) => `  ${v.excel} → ${v.nombre} (${v.clientas} clientas)`),
    ...(p.errores.length ? ['Errores:', ...p.errores.map((e) => `  ${e}`)] : []),
    `Plan ${p.hash}`,
  ];
}
