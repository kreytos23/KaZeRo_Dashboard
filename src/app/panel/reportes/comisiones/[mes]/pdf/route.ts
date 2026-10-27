import { conDbLectura } from '@/db/client';
import { mesDeUrl } from '@/domain/comisiones';
import { uuidOpcional } from '@/server/acciones';
import { sesionDeApi } from '@/server/auth/sesion-actual';
import { reporteComisiones } from '@/server/comisiones/lecturas';
import { ErrorNegocio } from '@/server/errores';
import { pdfComisiones } from '@/server/pdf/generar';
import { nombreArchivoComisiones } from '@/server/pdf/nombres';
import { respuestaPdf } from '@/server/pdf/respuesta';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const SIN_CACHE = { 'Cache-Control': 'private, no-store' };

export async function GET(req: Request, { params }: { params: Promise<{ mes: string }> }) {
  const s = await sesionDeApi();
  if (!s) return Response.json({ error: 'no_autenticado' }, { status: 401, headers: SIN_CACHE });
  const { mes: mesUrl } = await params;
  const mes = mesDeUrl(mesUrl);
  if (!mes) return Response.json({ error: 'mes_invalido' }, { status: 400, headers: SIN_CACHE });
  const vendedorId = uuidOpcional(new URL(req.url).searchParams.get('vendedor')); // inválido → sin filtro
  try {
    const r = await conDbLectura((db) => reporteComisiones(db, mes, { vendedorId: vendedorId ?? undefined }));
    const nombre = vendedorId ? (r.vendedoras[0]?.vendedorNombre ?? null) : null;
    const bytes = await pdfComisiones(r);
    return respuestaPdf(bytes, nombreArchivoComisiones(mesUrl, nombre));
  } catch (e) {
    if (e instanceof ErrorNegocio && e.codigo === 'no_encontrado')
      return Response.json({ error: 'no_encontrado' }, { status: 404, headers: SIN_CACHE });
    throw e;
  }
}
