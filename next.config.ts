import type { NextConfig } from 'next';
import { cabecerasEstaticas } from './src/server/seguridad/cabeceras';

const config: NextConfig = {
  poweredByHeader: false,
  // Se inyecta en build: el smoke test compara este SHA con el commit desplegado
  // para saber que se sirve la versión nueva y no una vieja (lecciones §4).
  env: { KAZERO_COMMIT_SHA: process.env.KAZERO_COMMIT_SHA ?? 'local' },
  async headers() {
    const cabeceras = cabecerasEstaticas();
    // Next rechaza una regla con la lista de cabeceras vacía.
    return cabeceras.length > 0 ? [{ source: '/:path*', headers: cabeceras }] : [];
  },
};

export default config;
