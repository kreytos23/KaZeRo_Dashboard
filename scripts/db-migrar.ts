import { prepararDestino } from './lib/guarda-bd';
import { migrar } from './lib/migrar';

const url = prepararDestino('DATABASE_URL_OWNER', 'Aplicar migraciones pendientes de ./drizzle');
await migrar(url);
console.log('[db-migrar] Migraciones aplicadas.');
