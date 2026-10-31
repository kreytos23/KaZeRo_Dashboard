export type EstadoAccion = {
  error?: string;
  ok?: string;
  campos?: Record<string, string>;
  /** Código del ErrorNegocio (p. ej. 'posible_duplicado': la pantalla pide confirmar «no es un duplicado»). */
  codigo?: string;
  /** Datos del error para la pantalla (p. ej. la lista de pagos parecidos). */
  detalle?: unknown;
  /** Alta de pieza: "otra" = el formulario sigue en la misma pantalla para capturar la siguiente. */
  siguiente?: 'otra';
};
