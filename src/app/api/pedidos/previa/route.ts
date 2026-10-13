import { conDbLectura } from '@/db/client';
import { leerConsultaPrevia } from '@/features/pedidos/consulta-previa';
import { sesionDeApi } from '@/server/auth/sesion-actual';
import { previsualizarPedido } from '@/server/pedidos/lecturas';

export const dynamic = 'force-dynamic';
const SIN_CACHE = { 'Cache-Control': 'private, no-store' };

export async function GET(req: Request) {
  if (!(await sesionDeApi()))
    return Response.json(
      { error: 'no_autenticado' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  const consulta = leerConsultaPrevia(new URL(req.url).searchParams);
  if (!consulta) return Response.json({ error: 'consulta_invalida' }, { status: 400, headers: SIN_CACHE });
  const previa = await conDbLectura((db) => previsualizarPedido(db, consulta));
  return Response.json(previa, { headers: SIN_CACHE });
}
