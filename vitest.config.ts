import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const ruta = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': ruta('./src'),
      // `server-only` lanza fuera de React Server Components; en pruebas es un módulo vacío.
      'server-only': ruta('./tests/stubs/server-only.ts'),
    },
  },
  test: {
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node' } },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['tests/integration/setup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
