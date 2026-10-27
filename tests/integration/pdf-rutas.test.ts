import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { hoyMX } from '@/domain/fechas';
import { crearAdmin } from '@/server/auth/admin';
import { iniciarLogin, verificarSegundoFactor } from '@/server/auth/servicio';
import { generarCodigoTotp } from '@/server/auth/totp';
import { crearCliente } from '@/server/clientes/servicio';
import { crearPedido } from '@/server/pedidos/servicio';
import { altaPieza } from '@/server/piezas/servicio';
import { crearVendedor } from '@/server/vendedores/servicio';
import { adminDePrueba, llaveTotp, truncarTodo, urlApp, urlOwner } from './utilidades';

let cookieActual: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (cookieActual && n === '__Host-kz_sesion' ? { value: cookieActual } : undefined),
  }),
}));
vi.mock('server-only', () => ({}));

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
beforeEach(async () => {
  cookieActual = undefined;
  await truncarTodo();
});

async function sesionCompleta() {
  const a = await conDbUrl(urlOwner(), (db) =>
    crearAdmin(db, { email: 'a@kazero.mx', password: 'contraseña-de-prueba-123' }, llaveTotp()),
  );
  const red = { ip: '203.0.113.7', userAgent: 'vitest' };
  const t = new Date();
  const pre = await app((db) =>
    iniciarLogin(db, { email: 'a@kazero.mx', password: 'contraseña-de-prueba-123', ...red }, t),
  );
  if (!pre.ok) throw new Error('login falló');
  const fin = await app((db) =>
    verificarSegundoFactor(
      db,
      { preToken: pre.preToken, codigo: generarCodigoTotp(a.secretoTotp, t), ...red },
      llaveTotp(),
      t,
    ),
  );
  if (!fin.ok) throw new Error('mfa falló');
  return fin.token;
}

async function pedidoDePrueba() {
  await app((db) =>
    altaPieza(db, {
      codigo: 'PD01',
      categoria: 'Anillos',
      descripcion: 'Aro',
      costoCentavos: 0,
      precioCentavos: 50000,
    }),
  );
  const adminId = await adminDePrueba();
  const clienteId = await app((db) => crearCliente(db, { nombre: 'Clienta Sintética' }));
  const vendedorId = await app((db) =>
    crearVendedor(db, { nombre: 'Perla Ejemplo', tipo: 'revendedora', comisionPct: '18.00' }),
  );
  await app((db) =>
    crearPedido(db, {
      key: randomUUID(),
      adminId,
      clienteId,
      vendedorId,
      codigos: ['PD01'],
      cuentaTarjeta: true,
      descuentoManualCentavos: 0,
    }),
  );
  return vendedorId;
}

const ctx = (mes: string) => ({ params: Promise.resolve({ mes }) });
const bytes = async (r: Response) => new TextDecoder().decode((await r.arrayBuffer()).slice(0, 5));

describe('PDF de deudores', () => {
  it('sin cookie → 401 JSON', async () => {
    const { GET } = await import('@/app/panel/reportes/deudores/pdf/route');
    const res = await GET(new Request('http://localhost/panel/reportes/deudores/pdf'));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'no_autenticado' });
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('con sesión → 200, application/pdf, adjunto y no-store', async () => {
    cookieActual = await sesionCompleta();
    await pedidoDePrueba();
    const { GET } = await import('@/app/panel/reportes/deudores/pdf/route');
    const res = await GET(new Request('http://localhost/panel/reportes/deudores/pdf'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="deudores-${hoyMX()}.pdf"`);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(await bytes(res)).toBe('%PDF-');
  });

  it('con filtro de vendedora el nombre del archivo la incluye; un uuid inválido se ignora', async () => {
    cookieActual = await sesionCompleta();
    const vid = await pedidoDePrueba();
    const { GET } = await import('@/app/panel/reportes/deudores/pdf/route');
    const f = await GET(new Request(`http://localhost/panel/reportes/deudores/pdf?vendedor=${vid}`));
    expect(f.headers.get('content-disposition')).toBe(
      `attachment; filename="deudores-${hoyMX()}-perla-ejemplo.pdf"`,
    );
    const x = await GET(new Request('http://localhost/panel/reportes/deudores/pdf?vendedor=nada'));
    expect(x.headers.get('content-disposition')).toBe(`attachment; filename="deudores-${hoyMX()}.pdf"`);
  });
});

describe('PDF de comisiones', () => {
  const mes = hoyMX().slice(0, 7);

  it('sin cookie → 401 JSON', async () => {
    const { GET } = await import('@/app/panel/reportes/comisiones/[mes]/pdf/route');
    const res = await GET(new Request('http://localhost/x'), ctx(mes));
    expect(res.status).toBe(401);
  });

  it('con sesión → 200 y nombre con el mes', async () => {
    cookieActual = await sesionCompleta();
    const { GET } = await import('@/app/panel/reportes/comisiones/[mes]/pdf/route');
    const res = await GET(new Request('http://localhost/x'), ctx(mes));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="comisiones-${mes}.pdf"`);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(await bytes(res)).toBe('%PDF-');
  });

  it('mes mal formado → 400; mes sin cierre → 404', async () => {
    cookieActual = await sesionCompleta();
    const { GET } = await import('@/app/panel/reportes/comisiones/[mes]/pdf/route');
    expect((await GET(new Request('http://localhost/x'), ctx('2026-13'))).status).toBe(400);
    expect((await GET(new Request('http://localhost/x'), ctx('2019-01'))).status).toBe(404);
  });
});
