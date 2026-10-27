import { describe, expect, it } from 'vitest';
import { ETIQUETA_ESTADO } from '@/app/panel/inventario/etiquetas';
import { ETIQUETA_ESTADO_PEDIDO } from '@/app/panel/pedidos/etiquetas';
import {
  vistaEstadoExhibidor,
  vistaEstadoPago,
  vistaEstadoPedido,
  vistaEstadoPieza,
  vistaSaldo,
  vistaUbicacion,
} from '@/features/ui/estado-visual';

describe('vistaEstadoPedido', () => {
  it('abierto, liquidado y cancelado se distinguen por tono, icono y texto', () => {
    const vistas = (['abierto', 'liquidado', 'cancelado'] as const).map(vistaEstadoPedido);
    expect(vistas.map((v) => v.tono)).toEqual(['aviso', 'exito', 'error']);
    expect(new Set(vistas.map((v) => v.icono)).size).toBe(3);
    expect(vistas.map((v) => v.texto)).toEqual(['Abierto', 'Liquidado', 'Cancelado']);
  });
  it('el texto coincide con las etiquetas de los filtros', () => {
    for (const [estado, texto] of Object.entries(ETIQUETA_ESTADO_PEDIDO))
      expect(vistaEstadoPedido(estado as keyof typeof ETIQUETA_ESTADO_PEDIDO).texto).toBe(texto);
  });
});

describe('vistaEstadoPieza', () => {
  it('cubre todos los estados con el mismo texto que las etiquetas', () => {
    for (const [estado, texto] of Object.entries(ETIQUETA_ESTADO))
      expect(vistaEstadoPieza(estado as keyof typeof ETIQUETA_ESTADO).texto).toBe(texto);
  });
  it('disponible es verde, defecto rojo y apartada ámbar; nunca comparten icono verde y rojo', () => {
    expect(vistaEstadoPieza('disponible').tono).toBe('exito');
    expect(vistaEstadoPieza('defecto').tono).toBe('error');
    expect(vistaEstadoPieza('apartada').tono).toBe('aviso');
    expect(vistaEstadoPieza('disponible').icono).not.toBe(vistaEstadoPieza('defecto').icono);
  });
});

describe('vistaUbicacion y exhibidor', () => {
  it('la ubicación conserva el texto armado y es neutra', () => {
    expect(vistaUbicacion('vendedora', 'Con Nelly')).toEqual({
      texto: 'Con Nelly',
      tono: 'neutro',
      icono: 'pin',
    });
    expect(vistaUbicacion('fuera', 'Vendida').icono).toBe('cuadro');
  });
  it('exhibidor abierto y cerrado difieren en tono e icono', () => {
    const a = vistaEstadoExhibidor('abierto');
    const c = vistaEstadoExhibidor('cerrado');
    expect(a.texto).toBe('Abierto');
    expect(c.texto).toBe('Cerrado');
    expect(a.tono).not.toBe(c.tono);
    expect(a.icono).not.toBe(c.icono);
  });
});

describe('vistaSaldo', () => {
  it('solo un pedido abierto con saldo > 0 se destaca', () => {
    expect(vistaSaldo('abierto', 34700).destacado).toBe(true);
    expect(vistaSaldo('abierto', 0).destacado).toBe(false);
    expect(vistaSaldo('liquidado', 0).destacado).toBe(false);
    expect(vistaSaldo('cancelado', 5000).destacado).toBe(false);
  });
});

describe('vistaEstadoPago', () => {
  it('pendiente (aviso), pagado (éxito), sin comisión (neutro) y estimado (informativo)', () => {
    const e = ['pendiente', 'pagado', 'sin_comision', 'estimado'] as const;
    const v = e.map(vistaEstadoPago);
    expect(v.map((x) => x.tono)).toEqual(['aviso', 'exito', 'neutro', 'secundario']);
    expect(v.map((x) => x.texto)).toEqual(['Pago pendiente', 'Pagado', 'Sin comisión', 'Estimado']);
  });
  it('cada estado con tono propio lleva un icono distinto', () => {
    const iconos = (['pendiente', 'pagado', 'estimado'] as const).map((e) => vistaEstadoPago(e).icono);
    expect(new Set(iconos).size).toBe(3);
  });
});
