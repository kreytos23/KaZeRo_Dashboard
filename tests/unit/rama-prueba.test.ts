import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nombresBases } from '../../scripts/lib/pg-directo';
import {
  MENSAJE_SIN_MODO,
  modoPruebas,
  verificarRamaPrueba,
  verificarUrlPgDirecto,
} from '../../scripts/lib/rama-prueba';

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

describe('verificarRamaPrueba en modo Postgres directo', () => {
  const pg = 'postgresql://postgres:x@postgres:5432/postgres';
  const url = (usuario: string, h: string, base: string) =>
    `postgresql://${usuario}:secreta@${h}:5432/${base}`;
  const env = (h: string, base: string, rama = base) => ({
    KAZERO_PG_PRUEBAS_URL: pg,
    KAZERO_RAMA_PRUEBA: rama,
    DATABASE_URL: url('kazero_app', h, base),
    DATABASE_URL_OWNER: url('kazero_owner', h, base),
  });

  it.each(['localhost', '127.0.0.1', 'postgres'])('acepta una base test_* en %s', (h) => {
    const ruta = archivo({ rama: 'test_ci_1_w1', host: h });
    expect(verificarRamaPrueba(env(h, 'test_ci_1_w1'), ruta)).toEqual({ rama: 'test_ci_1_w1', host: h });
  });

  it('rechaza un host que no es local ni el servicio de CI (p. ej. Neon), sin mostrar la contraseña', () => {
    const ruta = archivo({ rama: 'test_ci_1', host });
    expect(() => verificarRamaPrueba(env(host, 'test_ci_1'), ruta)).toThrow(/solo se aceptan/);
    expect(() => verificarRamaPrueba(env(host, 'test_ci_1'), ruta)).not.toThrow(/secreta/);
  });

  it('rechaza una base que no empieza por test_ (ni una rama Neon test-*)', () => {
    expect(() =>
      verificarRamaPrueba(env('postgres', 'kazero'), archivo({ rama: 'kazero', host: 'postgres' })),
    ).toThrow(/pnpm test:integracion/);
    expect(() =>
      verificarRamaPrueba(env('postgres', 'test-ci-1'), archivo({ rama: 'test-ci-1', host: 'postgres' })),
    ).toThrow(/pnpm test:integracion/);
  });

  it('rechaza si la URL apunta a otra base del mismo servidor', () => {
    const ruta = archivo({ rama: 'test_ci_1_w1', host: 'postgres' });
    expect(() => verificarRamaPrueba(env('postgres', 'postgres', 'test_ci_1_w1'), ruta)).toThrow(
      /no apunta a la base de prueba/,
    );
  });
});

describe('verificarUrlPgDirecto', () => {
  it('acepta el servicio de CI y rechaza cualquier otro host', () => {
    expect(verificarUrlPgDirecto(pgUrl('postgres'), 'X').host).toBe('postgres');
    expect(() => verificarUrlPgDirecto(pgUrl('db.example.com'), 'X')).toThrow(/solo se aceptan/);
    expect(() => verificarUrlPgDirecto(pgUrl(host), 'X')).toThrow(/solo se aceptan/);
  });
});

function pgUrl(h: string) {
  return `postgresql://postgres:x@${h}:5432/postgres`;
}

describe('modoPruebas', () => {
  it('sin KAZERO_PG_PRUEBAS_URL ni KAZERO_TEST_NEON=1 no elige modo (el runner sale con el mensaje)', () => {
    expect(modoPruebas({})).toBeNull();
    expect(modoPruebas({ KAZERO_TEST_NEON: 'true' })).toBeNull();
    expect(MENSAJE_SIN_MODO).toMatch(/corren en GitHub Actions/);
    expect(MENSAJE_SIN_MODO).toMatch(/KAZERO_TEST_NEON=1/);
  });

  it('Neon solo a propósito; Postgres directo gana si están ambos', () => {
    expect(modoPruebas({ KAZERO_TEST_NEON: '1' })).toBe('neon');
    expect(modoPruebas({ KAZERO_PG_PRUEBAS_URL: pgUrl('postgres'), KAZERO_TEST_NEON: '1' })).toBe('pg');
  });
});

describe('nombresBases', () => {
  it('genera test_<sufijo>[_wN] con solo [a-z0-9_]', () => {
    expect(nombresBases('ci-123-1-integracion', 2)).toEqual([
      'test_ci_123_1_integracion_w1',
      'test_ci_123_1_integracion_w2',
    ]);
    expect(nombresBases('Ana-1', 1)).toEqual(['test_ana_1']);
  });
});
