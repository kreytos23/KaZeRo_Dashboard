// Comisiones por mes: fechas sobre la cadena ISO (sin zona) y porcentajes exactos con BigInt.

export type Mes = string; // 'AAAA-MM-01'

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

export function mesDe(fechaISO: string): Mes {
  return `${fechaISO.slice(0, 7)}-01`;
}

export function finDeMes(mes: Mes): string {
  const a = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

const MES_URL = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Mes de la URL ('AAAA-MM') → 'AAAA-MM-01'; null si falta o no es un mes válido. */
export function mesDeUrl(valor: string | null | undefined): Mes | null {
  return valor && MES_URL.test(valor) ? `${valor}-01` : null;
}

export function mesSiguiente(mes: Mes): Mes {
  const a = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  return new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 10);
}

export function mesCerrable(mes: Mes, hoy: string): boolean {
  return finDeMes(mes) < hoy;
}

/** D-2: tras un cierre, lo atrasado entra en el mes siguiente (C-4); sin cierres, el más antiguo con liquidaciones. */
export function mesAbierto(o: {
  ultimoCerrado: Mes | null;
  liquidacionMasAntigua: string | null;
  hoy: string;
}): Mes {
  if (o.ultimoCerrado) return mesSiguiente(o.ultimoCerrado);
  return mesDe(o.liquidacionMasAntigua ?? o.hoy);
}

/** D-6: base × % redondeado half-up, sin flotantes. */
export function comisionCentavos(baseCentavos: number, pctNumeric: string): number {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(pctNumeric.trim());
  if (!m || !Number.isSafeInteger(baseCentavos) || baseCentavos < 0)
    throw new Error('comision: dato inválido');
  const pctCent = BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0'));
  if (pctCent > 10000n) throw new Error('comision: % fuera de rango');
  const num = BigInt(baseCentavos) * pctCent;
  return Number((num + 5000n) / 10000n); // half-up, base y pct no negativos
}

export type EstadoPagoComision = 'pendiente' | 'pagado' | 'sin_comision' | 'estimado';

export interface LineaComision {
  vendedorId: string;
  vendedorNombre: string;
  pedidoId: string;
  folio: number;
  montoCentavos: number;
  baseCentavos: number;
}

export interface ResumenVendedora {
  vendedorId: string;
  vendedorNombre: string;
  pedidos: number;
  baseCentavos: number;
  comisionCentavos: number;
}

/** Suma los montos ya calculados por línea; nunca recalcula sobre el total. */
export function resumenPorVendedora(lineas: LineaComision[]): ResumenVendedora[] {
  const porVendedora = new Map<string, ResumenVendedora & { ids: Set<string> }>();
  for (const l of lineas) {
    const r = porVendedora.get(l.vendedorId) ?? {
      vendedorId: l.vendedorId,
      vendedorNombre: l.vendedorNombre,
      pedidos: 0,
      baseCentavos: 0,
      comisionCentavos: 0,
      ids: new Set<string>(),
    };
    r.ids.add(l.pedidoId);
    r.baseCentavos += l.baseCentavos;
    r.comisionCentavos += l.montoCentavos;
    porVendedora.set(l.vendedorId, r);
  }
  return [...porVendedora.values()]
    .map(({ ids, ...r }) => ({ ...r, pedidos: ids.size }))
    .sort((a, b) => a.vendedorNombre.localeCompare(b.vendedorNombre, 'es'));
}

export function nombreMes(mes: Mes): string {
  return `${MESES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}`;
}
