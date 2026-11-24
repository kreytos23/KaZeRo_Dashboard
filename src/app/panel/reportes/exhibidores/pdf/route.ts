import { conDbLectura } from '@/db/client';
import { mesDeUrl } from '@/domain/comisiones';
import { incluirVentas } from '@/domain/reporte-exhibidor';
import { uuidOpcional } from '@/server/acciones';
import { sesionDeApi } from '@/server/auth/sesion-actual';
import { pdfExhibidores } from '@/server/pdf/generar';
import { nombreArchivoExhibidores } from '@/server/pdf/nombres';
import { respuestaPdf } from '@/server/pdf/respuesta';
import { reporteExhibidores } from '@/server/reportes/exhibidores';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const SIN_CACHE = { 'Cache-Control': 'private, no-store' };

export async function GET(req: Request) {
  const s = await sesionDeApi();
  if (!s) return Response.json({ error: 'no_autenticado' }, { status: 401, headers: SIN_CACHE });
  const url = new URL(req.url).searchParams;
  const mes = mesDeUrl(url.get('mes'));
  if (!mes) return Response.json({ error: 'mes_invalido' }, { status: 400, headers: SIN_CACHE });
  const exhibidorId = uuidOpcional(url.get('exhibidor')); // inválido → todos
  const ventas = incluirVentas(url.get('ventas'));
  const r = await conDbLectura((db) => reporteExhibidores(db, { mes }));
  const hojas = exhibidorId ? r.hojas.filter((h) => h.exhibidorId === exhibidorId) : r.hojas;
  const bytes = await pdfExhibidores(r, hojas, { ventas });
  return respuestaPdf(
    bytes,
    nombreArchivoExhibidores(mes.slice(0, 7), exhibidorId ? hojas[0]?.nombre : null),
  );
}
