import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { config } from 'dotenv';
import { conDbUrl } from '../src/db/pool';
import { crearAdmin } from '../src/server/auth/admin';
import { prepararDestino } from './lib/guarda-bd';

// No pisa variables ya exportadas: si la terminal trae otra DATABASE_URL_OWNER, la guarda lo detecta.
config({ path: '.env.local', quiet: true });
const url = prepararDestino('DATABASE_URL_OWNER', 'Crear la cuenta de administrador (local/desarrollo)');
const llave = process.env.KAZERO_TOTP_KEY;
if (!llave) throw new Error('Falta KAZERO_TOTP_KEY del MISMO entorno que la BD de destino.');

const rl = createInterface({ input: stdin, output: stdout });
const email = (await rl.question('Correo del admin: ')).trim();
const password = await rl.question('Contraseña (mín. 12; se verá al teclear, limpia la terminal después): ');
rl.close();

const a = await conDbUrl(url, (db) => crearAdmin(db, { email, password }, llave));
console.log('\nAgrega esta cuenta en tu app autenticadora (Google Authenticator, 1Password, etc.):');
console.log(`  ${a.uriTotp}`);
console.log('\nCódigos de recuperación (guárdalos fuera de la computadora; cada uno sirve una vez):');
for (const c of a.codigosRecuperacion) console.log(`  ${c}`);
console.log('\nEsta es la única vez que se muestran. Limpia la terminal (cls / clear).');
