import 'server-only';
import { renderToBuffer } from '@react-pdf/renderer';
import type { ReporteComisiones } from '@/server/comisiones/lecturas';
import type { reporteDeudores } from '@/server/reportes/deudores';
import type { HojaExhibidor, ReporteExhibidores } from '@/server/reportes/exhibidores';
import { ComisionesPdf } from './ComisionesPdf';
import { DeudoresPdf } from './DeudoresPdf';
import { ExhibidoresPdf } from './ExhibidoresPdf';
import { logoPng } from './logo';

export async function pdfDeudores(
  r: Awaited<ReturnType<typeof reporteDeudores>>,
  filtroVendedora: string | null,
): Promise<Uint8Array> {
  const logo = await logoPng();
  return new Uint8Array(await renderToBuffer(<DeudoresPdf r={r} filtro={filtroVendedora} logo={logo} />));
}

export async function pdfComisiones(r: ReporteComisiones): Promise<Uint8Array> {
  const logo = await logoPng();
  return new Uint8Array(await renderToBuffer(<ComisionesPdf r={r} logo={logo} />));
}

export async function pdfExhibidores(
  r: ReporteExhibidores,
  hojas: HojaExhibidor[],
  o: { ventas?: boolean } = {},
): Promise<Uint8Array> {
  const logo = await logoPng();
  return new Uint8Array(
    await renderToBuffer(<ExhibidoresPdf r={r} hojas={hojas} logo={logo} ventas={o.ventas ?? false} />),
  );
}
