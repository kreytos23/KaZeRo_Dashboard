export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { status: 'ok', commit: process.env.KAZERO_COMMIT_SHA || 'local' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
