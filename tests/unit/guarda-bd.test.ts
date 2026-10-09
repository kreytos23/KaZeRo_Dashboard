import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuardaBdError, describirUrl, prepararDestino, verificarDestino } from '../../scripts/lib/guarda-bd';

const dev = 'postgresql://neondb_owner:x@ep-dev-1.us-east-2.aws.neon.tech/neondb?sslmode=require';
const prod = 'postgresql://neondb_owner:y@ep-prod-9.us-east-2.aws.neon.tech/neondb?sslmode=require';
const hostProd = 'ep-prod-9.us-east-2.aws.neon.tech';

/** Devuelve el error lanzado por `fn`, o undefined si no lanzó nada. */
function capturar(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

describe('verificarDestino', () => {
  it('describe usuario, host y base sin exponer la contraseña', () => {
    expect(describirUrl(dev)).toEqual({
      usuario: 'neondb_owner',
      host: 'ep-dev-1.us-east-2.aws.neon.tech',
      baseDatos: 'neondb',
    });
  });

  it('pasa cuando la terminal coincide con .env.local y no es producción', () => {
    const d = verificarDestino({
      variable: 'DATABASE_URL_OWNER',
      efectiva: dev,
      delArchivo: dev,
      hostProduccion: hostProd,
    });
    expect(d.esProduccion).toBe(false);
  });

  it('falla si la variable de la terminal no coincide con .env.local (variable exportada de antes)', () => {
    expect(() =>
      verificarDestino({
        variable: 'DATABASE_URL_OWNER',
        efectiva: prod,
        delArchivo: dev,
        hostProduccion: hostProd,
      }),
    ).toThrow(/no coincide con la de \.env\.local/);
  });

  it('el mensaje no incluye la contraseña', () => {
    expect.assertions(2);
    try {
      verificarDestino({ variable: 'DATABASE_URL_OWNER', efectiva: prod, delArchivo: dev });
    } catch (e) {
      expect(e).toBeInstanceOf(GuardaBdError);
      expect(String((e as Error).message)).not.toMatch(/:y@|:x@/);
    }
  });

  it('describirUrl no expone la cadena de conexión si la URL es inválida', () => {
    const err = capturar(() => describirUrl('no es una url :secreto'));
    expect(err).toBeInstanceOf(GuardaBdError);
    expect((err as Error).message).not.toContain('secreto');
    expect(String(err)).not.toContain('secreto');
    expect(JSON.stringify(err)).not.toContain('secreto');
    expect((err as { cause?: unknown }).cause).toBeUndefined();
  });

  it('verificarDestino nombra la variable inválida sin mostrar su valor', () => {
    const err = capturar(() =>
      verificarDestino({ variable: 'DATABASE_URL_OWNER', efectiva: 'no es una url :secreto' }),
    );
    expect(err).toBeInstanceOf(GuardaBdError);
    expect((err as Error).message).toMatch(/DATABASE_URL_OWNER/);
    expect((err as Error).message).not.toContain('secreto');
    expect(String(err)).not.toContain('secreto');
    expect(JSON.stringify(err)).not.toContain('secreto');
  });

  it('exige confirmación para producción', () => {
    expect(() => verificarDestino({ variable: 'X', efectiva: prod, hostProduccion: hostProd })).toThrow(
      GuardaBdError,
    );
    expect(() => verificarDestino({ variable: 'X', efectiva: prod, hostProduccion: hostProd })).toThrow(
      /PRODUCCIÓN/,
    );
  });

  it('acepta producción con KAZERO_OTRA_BD=confirmo', () => {
    const d = verificarDestino({
      variable: 'X',
      efectiva: prod,
      hostProduccion: hostProd,
      confirmacion: 'confirmo',
    });
    expect(d.esProduccion).toBe(true);
  });

  it('detecta producción también por el host con -pooler', () => {
    const pooled = prod.replace('ep-prod-9', 'ep-prod-9-pooler');
    expect(() => verificarDestino({ variable: 'X', efectiva: pooled, hostProduccion: hostProd })).toThrow(
      /PRODUCCIÓN/,
    );
  });

  it('falla si la variable no existe', () => {
    expect(() => verificarDestino({ variable: 'DATABASE_URL_OWNER' })).toThrow(
      /DATABASE_URL_OWNER no está definida/,
    );
  });
});

describe('prepararDestino en CI', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('falla si CI no define KAZERO_HOST_PROD (sin esa variable la guarda no puede reconocer producción)', () => {
    vi.stubEnv('CI', 'true');
    vi.stubEnv('KAZERO_HOST_PROD', '');
    vi.stubEnv('DATABASE_URL_OWNER', 'postgresql://neondb_owner:x@ep-dev-1.us-east-2.aws.neon.tech/neondb');
    expect(() => prepararDestino('DATABASE_URL_OWNER', 'prueba', 'no-existe.env')).toThrow(
      /KAZERO_HOST_PROD/,
    );
  });
});
