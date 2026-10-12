import type { NextConfig } from 'next';
import { cabecerasEstaticas } from './src/server/seguridad/cabeceras';

const config: NextConfig = {
  poweredByHeader: false,
  // Se inyecta en build: el smoke test compara este SHA con el commit desplegado
  // para saber que se sirve la versión nueva y no una vieja (lecciones §4).
  env: { KAZERO_COMMIT_SHA: process.env.KAZERO_COMMIT_SHA ?? 'local' },
  // Fotos de pieza (Plan 2.2, D4): el navegador las reduce a ≤ 2.5 MB y el servidor acepta ≤ 3 MiB por
  // archivo (MAX_BYTES_SUBIDA). El default de Next es 1 MB; Vercel corta cualquier cuerpo en 4.5 MB.
  // `sharp` no se declara: Next 16 ya lo trata como serverExternalPackages por defecto.
  experimental: { serverActions: { bodySizeLimit: '4mb' } },
  async headers() {
    const cabeceras = cabecerasEstaticas();
    // Next rechaza una regla con la lista de cabeceras vacía.
    return cabeceras.length > 0 ? [{ source: '/:path*', headers: cabeceras }] : [];
  },
};

export default config;
