import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verificarRamaPrueba } from '../../scripts/lib/rama-prueba';

const host = 'ep-test-5.us-east-2.aws.neon.tech';
const owner = `postgresql://neondb_owner:a@${host}/neondb`;
const app = `postgresql://kazero_app:b@ep-test-5-pooler.us-east-2.aws.neon.tech/neondb`;

function archivo(contenido: object) {
  const dir = mkdtempSync(join(tmpdir(), 'kz-'));
  const ruta = join(dir, '.neon-prueba.json');
  writeFileSync(ruta, JSON.stringify(contenido));
  return ruta;
}

describe('verificarRamaPrueba', () => {
  it('acepta una rama test-* registrada por el runner', () => {
    const ruta = archivo({ rama: 'test-ci-1', host });
    const env = { KAZERO_RAMA_PRUEBA: 'test-ci-1', DATABASE_URL: app, DATABASE_URL_OWNER: owner };
    expect(verificarRamaPrueba(env, ruta)).toEqual({ rama: 'test-ci-1', host });
  });

  it('rechaza si no hay rama test-* (alguien corrió vitest directo)', () => {
    expect(() =>
      verificarRamaPrueba({ DATABASE_URL: app, DATABASE_URL_OWNER: owner }, 'no-existe.json'),
    ).toThrow(/pnpm test:integracion/);
  });

  it('rechaza si DATABASE_URL apunta a otro host que la rama creada', () => {
    const ruta = archivo({ rama: 'test-ci-1', host });
    const env = {
      KAZERO_RAMA_PRUEBA: 'test-ci-1',
      DATABASE_URL: 'postgresql://kazero_app:b@ep-dev-1.us-east-2.aws.neon.tech/neondb',
      DATABASE_URL_OWNER: owner,
    };
    expect(() => verificarRamaPrueba(env, ruta)).toThrow(/no apunta a la rama de prueba/);
  });
});
