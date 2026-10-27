import type { EstadoPieza } from '@/server/piezas/servicio';
import type { EstadoPedido } from '@/server/pedidos/comun';
import type { EstadoPagoComision } from '@/domain/comisiones';
import type { Ubicacion } from '@/domain/ubicacion';

/** Tono semántico: el color nunca va solo, siempre con un icono de forma distinta y el texto. */
export type Tono = 'exito' | 'aviso' | 'error' | 'primario' | 'secundario' | 'neutro';
export type Icono = 'check' | 'abierto' | 'cruz' | 'rombo' | 'cuadro' | 'pin';

export interface VistaEstado {
  texto: string;
  tono: Tono;
  icono: Icono;
}

/** Abierto = falta algo por cobrar (ámbar, círculo vacío); liquidado = listo (verde, palomita); cancelado = cruz roja. */
export function vistaEstadoPedido(estado: EstadoPedido): VistaEstado {
  switch (estado) {
    case 'abierto':
      return { texto: 'Abierto', tono: 'aviso', icono: 'abierto' };
    case 'liquidado':
      return { texto: 'Liquidado', tono: 'exito', icono: 'check' };
    case 'cancelado':
      return { texto: 'Cancelado', tono: 'error', icono: 'cruz' };
  }
}

const PIEZA: Record<EstadoPieza, VistaEstado> = {
  disponible: { texto: 'Disponible', tono: 'exito', icono: 'check' },
  en_exhibidor: { texto: 'En exhibidor', tono: 'secundario', icono: 'rombo' },
  apartada: { texto: 'Apartada', tono: 'aviso', icono: 'abierto' },
  vendida: { texto: 'Vendida', tono: 'primario', icono: 'cuadro' },
  regalo: { texto: 'Regalo', tono: 'primario', icono: 'rombo' },
  defecto: { texto: 'Defecto', tono: 'error', icono: 'cruz' },
  guardada: { texto: 'Guardada', tono: 'neutro', icono: 'cuadro' },
};

export const vistaEstadoPieza = (estado: EstadoPieza): VistaEstado => PIEZA[estado];

/** Dónde está la pieza: siempre neutro (es un dato, no una alerta); el texto ya viene armado por `etiquetaUbicacion`. */
export function vistaUbicacion(ubicacion: Ubicacion, etiqueta: string): VistaEstado {
  return { texto: etiqueta, tono: 'neutro', icono: ubicacion === 'fuera' ? 'cuadro' : 'pin' };
}

export function vistaEstadoExhibidor(estado: 'abierto' | 'cerrado'): VistaEstado {
  return estado === 'abierto'
    ? { texto: 'Abierto', tono: 'secundario', icono: 'abierto' }
    : { texto: 'Cerrado', tono: 'neutro', icono: 'cuadro' };
}

export interface VistaSaldo {
  /** Con saldo por cobrar el monto se destaca; sin saldo se atenúa. */
  destacado: boolean;
  /** Texto auxiliar para lector de pantalla: «Por cobrar» frente a «Sin saldo». */
  rotulo: string;
}

/** Solo un pedido abierto con saldo > 0 pide atención: liquidado y cancelado no deben nada. */
export function vistaSaldo(estado: EstadoPedido, saldoCentavos: number): VistaSaldo {
  const debe = estado === 'abierto' && saldoCentavos > 0;
  return { destacado: debe, rotulo: debe ? 'Por cobrar' : 'Sin saldo' };
}

const PAGO: Record<EstadoPagoComision, VistaEstado> = {
  pendiente: { texto: 'Pago pendiente', tono: 'aviso', icono: 'abierto' },
  pagado: { texto: 'Pagado', tono: 'exito', icono: 'check' },
  sin_comision: { texto: 'Sin comisión', tono: 'neutro', icono: 'cuadro' },
  estimado: { texto: 'Estimado', tono: 'secundario', icono: 'rombo' },
};

export const vistaEstadoPago = (estado: EstadoPagoComision): VistaEstado => PAGO[estado];
