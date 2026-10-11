import { conDbLectura } from '@/db/client';
import { sesionDeApi } from '@/server/auth/sesion-actual';
import { construirIndice } from '@/server/busqueda/indice';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await sesionDeApi())) {
    return Response.json(
      { error: 'no_autenticado' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const indice = await conDbLectura((db) => construirIndice(db));
  return Response.json(indice, { headers: { 'Cache-Control': 'private, no-store' } });
}
