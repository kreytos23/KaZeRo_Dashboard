import type { EstadoAccion } from '@/features/ui/estado';

/** Resultado del alta por lote: además del mensaje, la lista de errores por línea. */
export type EstadoLote = EstadoAccion & { lineas?: string[] };
