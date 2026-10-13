import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { conDbUrl } from '@/db/pool';
import { pieza, sesion } from '@/db/schema';
import { crearAdmin } from '@/server/auth/admin';
import { iniciarLogin, verificarSegundoFactor } from '@/server/auth/servicio';
import { generarCodigoTotp } from '@/server/auth/totp';
import { construirIndice } from '@/server/busqueda/indice';
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

const app = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(urlApp(), fn);
beforeEach(async () => {
  cookieActual = undefined;
  await truncarTodo();
});

describe('índice de búsqueda', () => {
  it('incluye piezas, clientes y vendedores en forma compacta', async () => {
    const pid = await app((db) =>
      altaPieza(db, {
        codigo: 'IX01',
        categoria: 'Anillos',
        descripcion: 'Anillo luna',
        costoCentavos: 0,
        precioCentavos: 100,
      }),
    );
    const cid = await app((db) => crearCliente(db, { nombre: 'Danya', referencia: '5to norte' }));
    const vid = await app((db) =>
      crearVendedor(db, { nombre: 'Nelly', tipo: 'revendedora', comisionPct: '18.00' }),
    );
    expect(await app((db) => construirIndice(db))).toEqual({
      v: 3,
      piezas: [[pid.id, 'IX01', 'Anillo luna', 'disponible', null]],
      clientes: [[cid, 'Danya', '5to norte']],
      vendedores: [[vid, 'Nelly']],
      pedidos: [],
    });
  });

  it('v3: conserva la miniatura de la pieza y trae pedidos [id, folio, cliente, estado] sin montos', async () => {
    const pid = await app((db) =>
      altaPieza(db, {
        codigo: 'IX03',
        categoria: 'Anillos',
        descripcion: 'Aro',
        costoCentavos: 0,
        precioCentavos: 77700,
      }),
    );
    const adminId = await adminDePrueba();
    const clave = randomUUID();
    await app((db) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('kazero.admin_id', ${adminId}, true)`);
        await tx.update(pieza).set({ imagenClave: clave }).where(eq(pieza.id, pid.id));
      }),
    );
    const clienteId = await app((db) => crearCliente(db, { nombre: 'Gloria' }));
    const vendedorId = await app((db) =>
      crearVendedor(db, { nombre: 'Kazero', tipo: 'casa', comisionPct: '0.00' }),
    );
    const p = await app((db) =>
      crearPedido(db, {
        key: randomUUID(),
        adminId,
        clienteId,
        vendedorId,
        codigos: ['IX03'],
        cuentaTarjeta: true,
        descuentoManualCentavos: 0,
      }),
    );
    const idx = await app((db) => construirIndice(db));
    expect(idx.v).toBe(3);
    expect(idx.piezas[0]).toHaveLength(5);
    expect(idx.piezas[0]![4]).toBe(clave);
    expect(idx.pedidos).toEqual([[p.id, p.folio, 'Gloria', 'abierto']]);
    expect(JSON.stringify(idx)).not.toMatch(/777\.00|77700/);
  });

  it('solo expone las columnas de la interfaz (sin costo, precio ni teléfono)', async () => {
    await app((db) =>
      altaPieza(db, {
        codigo: 'IX02',
        categoria: 'Anillos',
        descripcion: 'Aro',
        costoCentavos: 5000,
        precioCentavos: 9900,
      }),
    );
    await app((db) => crearCliente(db, { nombre: 'Ana', telefono: '5551234567' }));
    const txt = JSON.stringify(await app((db) => construirIndice(db)));
    expect(txt).not.toMatch(/5551234567|50\.00|99\.00/);
  });
});

describe('GET /api/busqueda/indice', () => {
  async function sesionCon(nivel: 'completa' | 'pre_mfa') {
    const a = await conDbUrl(urlOwner(), (db) =>
      crearAdmin(db, { email: 'a@kazero.mx', password: 'contraseña-de-prueba-123' }, llaveTotp()),
    );
    const red = { ip: '203.0.113.7', userAgent: 'vitest' };
    const t = new Date();
    const pre = await app((db) =>
      iniciarLogin(db, { email: 'a@kazero.mx', password: 'contraseña-de-prueba-123', ...red }, t),
    );
    if (!pre.ok) throw new Error('login falló');
    if (nivel === 'pre_mfa') return pre.preToken;
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

  it('sin cookie → 401 JSON', async () => {
    const { GET } = await import('@/app/api/busqueda/indice/route');
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'no_autenticado' });
  });

  it('sesión pre_mfa → 401, no recibe el índice', async () => {
    cookieActual = await sesionCon('pre_mfa');
    const { GET } = await import('@/app/api/busqueda/indice/route');
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'no_autenticado' });
  });

  it('sesión revocada → 401', async () => {
    cookieActual = await sesionCon('completa');
    await conDbUrl(urlOwner(), (db) => db.update(sesion).set({ revocadaAt: new Date() }));
    const { GET } = await import('@/app/api/busqueda/indice/route');
    expect((await GET()).status).toBe(401);
  });

  it('sesión expirada → 401', async () => {
    cookieActual = await sesionCon('completa');
    await conDbUrl(urlOwner(), (db) => db.update(sesion).set({ expiraAt: new Date(Date.now() - 1000) }));
    const { GET } = await import('@/app/api/busqueda/indice/route');
    expect((await GET()).status).toBe(401);
  });

  it('sesión completa → 200, JSON y private, no-store', async () => {
    cookieActual = await sesionCon('completa');
    await app((db) => crearVendedor(db, { nombre: 'Nelly', tipo: 'revendedora', comisionPct: '18.00' }));
    const { GET } = await import('@/app/api/busqueda/indice/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect((await res.json()).vendedores).toHaveLength(1);
  });
});
