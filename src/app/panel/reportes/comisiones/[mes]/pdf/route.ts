import { z } from 'zod';
import { conDbLectura } from '@/db/client';
import { sesionDeApi } from '@/server/auth/sesion-actual';
import { reporteComisiones } from '@/server/comisiones/lecturas';
import { ErrorNegocio } from '@/server/errores';
import { pdfComisiones } from '@/server/pdf/generar';
import { nombreArchivoComisiones } from '@/server/pdf/nombres';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const SIN_CACHE = { 'Cache-Control': 'private, no-store' };

export async function GET(req: Request, { params }: { params: Promise<{ mes: string }> }) {
  const s = await sesionDeApi();
  if (!s) return Response.json({ error: 'no_autenticado' }, { status: 401, headers: SIN_CACHE });
  const { mes } = await params;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes))
    return Response.json({ error: 'mes_invalido' }, { status: 400, headers: SIN_CACHE });
  const v = z.uuid().safeParse(new URL(req.url).searchParams.get('vendedor'));
  const vendedorId = v.success ? v.data : null; // inválido → sin filtro
  try {
    const r = await conDbLectura((db) =>
      reporteComisiones(db, `${mes}-01`, { vendedorId: vendedorId ?? undefined }),
    );
    const nombre = vendedorId ? (r.vendedoras[0]?.vendedorNombre ?? null) : null;
    const bytes = await pdfComisiones(r);
    return new Response(bytes as BodyInit, {
      headers: {
        ...SIN_CACHE,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${nombreArchivoComisiones(mes, nombre)}"`,
      },
    });
  } catch (e) {
    if (e instanceof ErrorNegocio && e.codigo === 'no_encontrado')
      return Response.json({ error: 'no_encontrado' }, { status: 404, headers: SIN_CACHE });
    throw e;
  }
}
