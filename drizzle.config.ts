import { defineConfig } from 'drizzle-kit';

// Solo `generate` usa este archivo (no se conecta a ninguna BD). Las migraciones las aplica
// scripts/db-migrar.ts, que pasa por la guarda de destino.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
});
