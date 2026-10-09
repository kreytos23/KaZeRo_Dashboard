import { existsSync, readFileSync } from 'node:fs';
import { config, parse } from 'dotenv';
import { conDbUrl } from '../src/db/pool';
import { crearAdmin } from '../src/server/auth/admin';
import { prepararDestino, verificarSecreto } from './lib/guarda-bd';
import { pedirDatosAdmin } from './lib/pedir-admin';

// No pisa variables ya exportadas: si la terminal trae otra DATABASE_URL_OWNER, la guarda lo detecta.
config({ path: '.env.local', quiet: true });
const url = prepararDestino('DATABASE_URL_OWNER', 'Crear la cuenta de administrador (local/desarrollo)');
const llave = process.env.KAZERO_TOTP_KEY;
// Misma protección que con la URL: una KAZERO_TOTP_KEY exportada de antes cifraría el TOTP con otra llave.
verificarSecreto({
  variable: 'KAZERO_TOTP_KEY',
  efectiva: llave,
  delArchivo: existsSync('.env.local') ? parse(readFileSync('.env.local')).KAZERO_TOTP_KEY : undefined,
  confirmacion: process.env.KAZERO_OTRA_BD,
});
if (!llave) throw new Error('Falta KAZERO_TOTP_KEY del MISMO entorno que la BD de destino.');

const { email, password } = await pedirDatosAdmin('Correo del admin: ');

const a = await conDbUrl(url, (db) => crearAdmin(db, { email, password }, llave));
console.log('\nAgrega esta cuenta en tu app autenticadora (Google Authenticator, 1Password, etc.):');
console.log(`  ${a.uriTotp}`);
console.log('\nCódigos de recuperación (guárdalos fuera de la computadora; cada uno sirve una vez):');
for (const c of a.codigosRecuperacion) console.log(`  ${c}`);
console.log('\nEsta es la única vez que se muestran. Limpia la terminal (cls / clear).');
