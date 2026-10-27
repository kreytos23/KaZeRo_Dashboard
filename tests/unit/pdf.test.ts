import { describe, expect, it, vi } from 'vitest';
import { fechaCorta } from '@/domain/fechas';
import { cacheControlPara, decidirAcceso } from '@/server/seguridad/acceso';
import type { ReporteComisiones } from '@/server/comisiones/lecturas';

vi.mock('server-only', () => ({}));

const { nombreArchivoComisiones, nombreArchivoDeudores } = await import('@/server/pdf/nombres');
const { textoCierre } = await import('@/server/pdf/ComisionesPdf');
const { pdfComisiones, pdfDeudores } = await import('@/server/pdf/generar');

describe('texto de cierre', () => {
  it('muestra el día en hora de México: un cierre a las 02:00 UTC cae el día anterior', () => {
    expect(textoCierre('2026-12-02T02:00:00.000Z')).toBe(`Mes cerrado el ${fechaCorta('2026-12-01')}`);
    expect(textoCierre('2026-12-02T10:00:00.000Z')).toBe(`Mes cerrado el ${fechaCorta('2026-12-02')}`);
    expect(textoCierre(null)).toBe('Mes cerrado');
  });
});

describe('nombres de archivo', () => {
  it('sin vendedora', () => {
    expect(nombreArchivoDeudores('2026-11-12')).toBe('deudores-2026-11-12.pdf');
    expect(nombreArchivoComisiones('2026-11')).toBe('comisiones-2026-11.pdf');
    expect(nombreArchivoDeudores('2026-11-12', null)).toBe('deudores-2026-11-12.pdf');
  });
  it('con vendedora: minúsculas, sin acentos ni ñ, solo [a-z0-9-]', () => {
    expect(nombreArchivoDeudores('2026-11-12', 'Nelly Zavala')).toBe('deudores-2026-11-12-nelly-zavala.pdf');
    expect(nombreArchivoComisiones('2026-11', 'María Ñandú  Pérez!')).toBe(
      'comisiones-2026-11-maria-nandu-perez.pdf',
    );
  });
  it('el slug se corta a 40 caracteres', () => {
    const n = nombreArchivoDeudores('2026-11-12', 'a'.repeat(100));
    expect(n).toBe(`deudores-2026-11-12-${'a'.repeat(40)}.pdf`);
  });
  it('una vendedora sin letras ni números no deja un guion colgado', () => {
    expect(nombreArchivoDeudores('2026-11-12', '!!!')).toBe('deudores-2026-11-12.pdf');
  });
});

const cabecera = (b: Uint8Array) => new TextDecoder().decode(b.slice(0, 5));

describe('PDF', () => {
  it('deudores: bytes de un PDF', async () => {
    const bytes = await pdfDeudores(
      {
        fecha: '2026-11-12',
        totalCentavos: 150000,
        numPedidos: 2,
        grupos: [
          {
            vendedorId: 'v1',
            vendedorNombre: 'Vendedora Ñandú',
            saldoCentavos: 150000,
            pedidos: [
              {
                pedidoId: 'p1',
                folio: 7,
                vendedorId: 'v1',
                vendedorNombre: 'Vendedora Ñandú',
                clienteNombre: 'Clienta Prueba',
                telefono: '5550000000',
                fecha: '2026-09-01',
                totalCentavos: 100000,
                pagadoCentavos: 0,
                saldoCentavos: 100000,
                dias: 72,
                atrasado: true,
              },
              {
                pedidoId: 'p2',
                folio: 8,
                vendedorId: 'v1',
                vendedorNombre: 'Vendedora Ñandú',
                clienteNombre: 'Otra Clienta',
                telefono: null,
                fecha: '2026-11-10',
                totalCentavos: 80000,
                pagadoCentavos: 30000,
                saldoCentavos: 50000,
                dias: 2,
                atrasado: false,
              },
            ],
          },
        ],
      },
      null,
    );
    expect(cabecera(bytes)).toBe('%PDF-');
  });

  it('comisiones: bytes de un PDF (mes cerrado y pagado)', async () => {
    const r: ReporteComisiones = {
      mes: '2026-11-01',
      corteId: 'corte-1',
      nombre: 'Noviembre 2026',
      cerrado: true,
      cerradoAt: '2026-12-02T10:00:00.000Z',
      cerrable: false,
      motivoNoCerrable: null,
      totalCentavos: 18000,
      numPedidos: 1,
      vendedoras: [
        {
          vendedorId: 'v1',
          vendedorNombre: 'Vendedora Prueba',
          pedidos: 1,
          baseCentavos: 100000,
          comisionCentavos: 18000,
          pct: '18.00',
          estadoPago: 'pagado',
          pago: { id: 'x', fecha: '2026-12-05', metodo: 'transferencia', nota: null, montoCentavos: 18000 },
          pedidosDetalle: [
            {
              pedidoId: 'p1',
              folio: 7,
              clienteNombre: 'Clienta Prueba',
              vendedorId: 'v1',
              vendedorNombre: 'Vendedora Prueba',
              fechaLiquidacion: '2026-11-20',
              baseCentavos: 100000,
              pct: '18.00',
              montoCentavos: 18000,
            },
          ],
        },
      ],
    };
    expect(cabecera(await pdfComisiones(r))).toBe('%PDF-');
    expect(cabecera(await pdfComisiones({ ...r, cerrado: false, vendedoras: [] }))).toBe('%PDF-');
  });
});

describe('acceso a las rutas de PDF', () => {
  it.each(['/panel/reportes/deudores/pdf', '/panel/reportes/comisiones/2026-11/pdf'])(
    '%s exige sesión y no se cachea',
    (ruta) => {
      expect(decidirAcceso(ruta, false)).toBe('redirigir_login');
      expect(decidirAcceso(ruta, true)).toBe('pasar');
      expect(cacheControlPara(ruta)).toBe('private, no-store');
    },
  );
});
