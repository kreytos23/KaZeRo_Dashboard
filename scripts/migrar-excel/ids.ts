import { createHash } from 'node:crypto';

/** UUID determinista (versión 8, RFC 9562, formato propio) derivado del lote y de la clave de origen. */
export function uuidDeterminista(lote: string, clave: string): string {
  const h = createHash('sha256').update(`kazero:${lote}:${clave}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x80; // versión 8
  h[8] = (h[8]! & 0x3f) | 0x80; // variante RFC
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** Llaves ordenadas, sin undefined; rechaza NaN/Infinity (un plan con eso es un bug). */
export function jsonCanonico(v: unknown): string {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new TypeError('Número no finito en el plan.');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(jsonCanonico).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`)
      .join(',')}}`;
  }
  throw new TypeError(`Tipo no serializable en el plan: ${typeof v}`);
}

export const hashPlan = (plan: unknown) => createHash('sha256').update(jsonCanonico(plan)).digest('hex');
