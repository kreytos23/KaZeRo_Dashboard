import { esquemaMapeo, type Mapeo } from '../../scripts/migrar-excel/tipos';

/** Mapeo con datos inventados (ningún nombre real). */
export function mapeoSintetico(extra: Record<string, unknown> = {}): Mapeo {
  return esquemaMapeo.parse({
    lote: 'sintetico',
    fechaCorte: '2026-10-03',
    vendedores: [
      { nombre: 'Casa Prueba', tipo: 'casa', comisionPct: '0', alias: ['Kazero Prueba'] },
      { nombre: 'Vendedora A', tipo: 'revendedora', comisionPct: '15', alias: ['Vend A'] },
      { nombre: 'Vendedora B', tipo: 'consignacion', comisionPct: '15', alias: [] },
    ],
    proveedores: { 'prov uno': 'Proveedor Uno', 'prov raro': null },
    categoriasPorPalabra: { pulsera: 'Pulseras', anillo: 'Anillos', collar: 'Collares', huggie: 'Huggies' },
    categoriaSinDato: 'Sin categoría (histórico)',
    estatus: {
      Vendido: 'vendido',
      'Por cobrar': 'por_cobrar',
      'No se cobró': 'no_cobrado',
      Regalo: 'regalo',
      Rifa: 'rifa',
      'Exhibidor 06jul': 'exhibidor',
      'Vend A 06jul': 'exhibidor',
      Defecto: 'defecto',
      Guardado: 'guardado',
      Disponible: 'disponible',
      Cambio: 'ignorar',
    },
    exhibidores: [
      {
        texto: 'Exhibidor A - 16sep',
        vendedor: 'Vendedora A',
        fechaEnvio: '2026-09-16',
        nombre: 'Exhibidor A 16sep',
      },
      {
        texto: 'Exhibidor 06jul',
        vendedor: 'Vendedora A',
        fechaEnvio: '2026-07-06',
        nombre: 'Exhibidor A 06jul',
      },
      { texto: 'Vend A 06jul', vendedor: 'Vendedora A', fechaEnvio: '2026-07-06', nombre: 'Vend A 06jul' },
      {
        texto: 'Vitrina B - 05sep',
        vendedor: 'Vendedora B',
        fechaEnvio: '2026-09-05',
        nombre: 'Vitrina B 05sep',
      },
    ],
    fusiones: [],
    noFusionar: [],
    clienteSinNombre: 'Sin cliente (histórico)',
    ...extra,
  });
}
