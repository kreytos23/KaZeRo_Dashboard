import { describe, expect, it } from 'vitest';
import { mesAnterior, mesesRecientes } from '@/domain/comisiones';
import {
  cuadreDinero,
  cuadrePiezas,
  hojaConActividad,
  notasVendidas,
  piezasAlCierre,
  type MovExhibidor,
} from '@/domain/reporte-exhibidor';

let orden = 0;
const mov = (
  piezaId: string,
  tipo: string,
  deEstado: string | null,
  aEstado: string,
  dia: string,
  pedidoId: string | null = null,
): MovExhibidor => ({ piezaId, tipo, deEstado, aEstado, dia, pedidoId, orden: ++orden });

const OCT = '2026-10-01';
const NOV = '2026-11-01';

describe('meses', () => {
  it('mesAnterior cruza el año', () => {
    expect(mesAnterior('2026-01-01')).toBe('2025-12-01');
    expect(mesAnterior('2026-11-01')).toBe('2026-10-01');
  });
  it('mesesRecientes empieza en el mes de hoy y va hacia atrás', () => {
    expect(mesesRecientes('2026-02-15', 3)).toEqual(['2026-02-01', '2026-01-01', '2025-12-01']);
  });
});

describe('cuadre de piezas', () => {
  const envio = (p: string, dia: string) => mov(p, 'envio_exhibidor', 'disponible', 'en_exhibidor', dia);

  it('cuadra envío, venta y regreso del mes', () => {
    const movs = [
      envio('a', '2026-09-20'),
      envio('b', '2026-10-02'),
      envio('c', '2026-10-03'),
      mov('a', 'apartado', 'en_exhibidor', 'apartada', '2026-10-05', 'p1'),
      mov('c', 'regreso', 'en_exhibidor', 'disponible', '2026-10-06'),
    ];
    expect(cuadrePiezas(movs, OCT)).toEqual({
      alInicio: 1,
      enviadas: 2,
      vendidas: 1,
      regresadas: 1,
      porCancelacion: 0,
      otros: 0,
      alCierre: 1,
    });
  });

  it('X-4: una cancelación posterior no cambia el mes de la venta y entra en el suyo', () => {
    const movs = [
      envio('a', '2026-09-20'),
      mov('a', 'apartado', 'en_exhibidor', 'apartada', '2026-10-05', 'p1'),
      mov('a', 'liberacion', 'apartada', 'en_exhibidor', '2026-11-02', 'p1'),
    ];
    expect(cuadrePiezas(movs, OCT)).toMatchObject({
      alInicio: 1,
      vendidas: 1,
      porCancelacion: 0,
      alCierre: 0,
    });
    expect(cuadrePiezas(movs, NOV)).toMatchObject({ alInicio: 0, porCancelacion: 1, alCierre: 1 });
  });

  it('la liquidación no cuenta: la pieza ya salió al apartarse', () => {
    const movs = [
      envio('a', '2026-09-20'),
      mov('a', 'apartado', 'en_exhibidor', 'apartada', '2026-10-05', 'p1'),
      mov('a', 'venta', 'apartada', 'vendida', '2026-11-02', 'p1'),
    ];
    expect(cuadrePiezas(movs, NOV)).toMatchObject({ alInicio: 0, vendidas: 0, alCierre: 0 });
  });

  it('liberar con el exhibidor cerrado no devuelve la pieza al exhibidor', () => {
    const movs = [
      envio('a', '2026-09-20'),
      mov('a', 'apartado', 'en_exhibidor', 'apartada', '2026-09-25', 'p1'),
      mov('a', 'liberacion', 'apartada', 'disponible', '2026-10-02', 'p1'),
    ];
    expect(cuadrePiezas(movs, OCT)).toMatchObject({ porCancelacion: 0, alCierre: 0 });
  });

  it('cambio manual y corrección van en «otros», con signo', () => {
    const movs = [
      envio('a', '2026-09-20'),
      mov('a', 'cambio_estado', 'en_exhibidor', 'defecto', '2026-10-02'),
      mov('a', 'correccion', 'defecto', 'en_exhibidor', '2026-11-02'),
    ];
    expect(cuadrePiezas(movs, OCT)).toMatchObject({ otros: -1, alCierre: 0 });
    expect(cuadrePiezas(movs, NOV)).toMatchObject({ otros: 1, alCierre: 1 });
  });

  it('un alta importada en el exhibidor cuenta como enviada', () => {
    expect(cuadrePiezas([mov('a', 'alta', null, 'en_exhibidor', '2026-10-02')], OCT)).toMatchObject({
      enviadas: 1,
      alCierre: 1,
    });
  });

  it('ignora movimientos de meses futuros', () => {
    expect(cuadrePiezas([envio('a', '2026-11-02')], OCT).alCierre).toBe(0);
  });
});

describe('piezas al cierre', () => {
  it('solo las que siguen en el exhibidor al terminar el mes', () => {
    const movs = [
      mov('a', 'envio_exhibidor', 'disponible', 'en_exhibidor', '2026-10-02'),
      mov('b', 'envio_exhibidor', 'disponible', 'en_exhibidor', '2026-10-02'),
      mov('b', 'regreso', 'en_exhibidor', 'disponible', '2026-10-03'),
      mov('a', 'regreso', 'en_exhibidor', 'disponible', '2026-11-03'),
    ];
    expect(piezasAlCierre(movs, OCT)).toEqual(['a']);
    expect(piezasAlCierre(movs, NOV)).toEqual([]);
  });
});

describe('notas vendidas', () => {
  it('cuenta las piezas que salieron del exhibidor en el mes, por nota', () => {
    const movs = [
      mov('a', 'apartado', 'en_exhibidor', 'apartada', '2026-10-05', 'p1'),
      mov('b', 'apartado', 'en_exhibidor', 'apartada', '2026-10-05', 'p1'),
      mov('c', 'apartado', 'en_exhibidor', 'apartada', '2026-11-05', 'p2'),
      mov('d', 'apartado', 'apartada', 'apartada', '2026-10-05', 'p3'),
    ];
    expect([...notasVendidas(movs, OCT)]).toEqual([['p1', 2]]);
  });
});

describe('cuadre de dinero', () => {
  const movs = [
    { tipo: 'cobro' as const, fecha: '2026-09-10', centavos: 50000 },
    { tipo: 'entrega' as const, fecha: '2026-09-20', centavos: 20000 },
    { tipo: 'cobro' as const, fecha: '2026-10-05', centavos: 10000 },
    { tipo: 'entrega' as const, fecha: '2026-10-06', centavos: 30000 },
    { tipo: 'ajuste' as const, fecha: '2026-10-07', centavos: -500 },
    { tipo: 'cobro' as const, fecha: '2026-11-01', centavos: 99999 },
  ];
  it('E-5 con saldo inicial; el mes siguiente no cuenta', () => {
    expect(cuadreDinero(movs, OCT)).toEqual({
      alInicio: 30000,
      cobrado: 10000,
      entregado: 30000,
      ajustes: -500,
      alCierre: 9500,
    });
  });
});

describe('hoja con actividad', () => {
  const p = {
    alInicio: 0,
    enviadas: 0,
    vendidas: 0,
    regresadas: 0,
    porCancelacion: 0,
    otros: 0,
    alCierre: 0,
  };
  const d = { alInicio: 0, cobrado: 0, entregado: 0, ajustes: 0, alCierre: 0 };
  it('sin nada no hay hoja', () => expect(hojaConActividad(p, d)).toBe(false));
  it('piezas al inicio o dinero pendiente sí', () => {
    expect(hojaConActividad({ ...p, alInicio: 1 }, d)).toBe(true);
    expect(hojaConActividad(p, { ...d, alInicio: 100 })).toBe(true);
    expect(hojaConActividad(p, { ...d, ajustes: -5 })).toBe(true);
  });
});
