export type Ubicacion = 'kazero' | 'exhibidor' | 'vendedora' | 'fuera';

/** Dónde está físicamente la pieza (reunión 2026-10-23, punto 5). */
export function etiquetaUbicacion(u: {
  ubicacion: Ubicacion;
  exhibidorNombre: string | null;
  vendedorNombre: string | null;
  estado: string;
}): string {
  switch (u.ubicacion) {
    case 'kazero':
      return 'Kazero';
    case 'exhibidor':
      return `Exhibidor ${u.exhibidorNombre ?? ''}`.trim();
    case 'vendedora':
      return `Con ${u.vendedorNombre ?? 'vendedora'}`;
    case 'fuera':
      return u.estado === 'regalo' ? 'Regalo' : u.estado === 'vendida' ? 'Vendida' : 'Fuera de Kazero';
  }
}
