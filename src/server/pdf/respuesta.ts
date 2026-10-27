/** Respuesta de descarga de un PDF: nunca se cachea (datos del negocio). */
export function respuestaPdf(bytes: Uint8Array, nombreArchivo: string): Response {
  return new Response(bytes as BodyInit, {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${nombreArchivo}"`,
    },
  });
}
