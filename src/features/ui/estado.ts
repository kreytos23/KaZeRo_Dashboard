export type EstadoAccion = {
  error?: string;
  ok?: string;
  campos?: Record<string, string>;
  /** Alta de pieza: "otra" = el formulario sigue en la misma pantalla para capturar la siguiente. */
  siguiente?: 'otra';
};
