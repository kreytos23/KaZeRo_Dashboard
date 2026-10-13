import { defineConfig, devices } from '@playwright/test';

// scripts/test-neon.ts lanza un proceso por proyecto (cada uno con su servidor, rama y datos) en puertos distintos.
const puerto = Number(process.env.KAZERO_E2E_PUERTO) || 3100;

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${puerto}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'escritorio', use: { ...devices['Desktop Chrome'] } },
    // Las pruebas con @escritorio no dependen del viewport (API, cabeceras, flujos idénticos en ambos): solo corren en escritorio.
    { name: 'movil', use: { ...devices['Pixel 7'] }, grepInvert: /@escritorio/ },
  ],
  // Requiere `pnpm build` previo. Hereda DATABASE_URL/KAZERO_TOTP_KEY de la rama test-* (scripts/test-neon.ts).
  webServer: {
    command: `pnpm start -p ${puerto}`,
    url: `http://localhost:${puerto}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
