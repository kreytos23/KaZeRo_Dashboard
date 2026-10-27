const slug = (t: string) =>
  t
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');

function nombre(base: string, vendedora?: string | null) {
  const s = vendedora ? slug(vendedora) : '';
  return `${base}${s ? `-${s}` : ''}.pdf`;
}

/** 'deudores-2026-11-12.pdf' | 'deudores-2026-11-12-nelly-zavala.pdf' */
export const nombreArchivoDeudores = (fecha: string, vendedora?: string | null) =>
  nombre(`deudores-${fecha}`, vendedora);

/** 'comisiones-2026-11.pdf' | 'comisiones-2026-11-nelly-zavala.pdf' */
export const nombreArchivoComisiones = (mes: string, vendedora?: string | null) =>
  nombre(`comisiones-${mes}`, vendedora);
