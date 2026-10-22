import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GuardaBdError,
  describirUrl,
  prepararDestino,
  prepararDestinoDetallado,
  verificarDestino,
  verificarSecreto,
} from '../../scripts/lib/guarda-bd';

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

  it('falla si la variable de la terminal no coincide con .env.local (variable exportada de antes) sin incluir la contraseña', () => {
    expect(() =>
      verificarDestino({
        variable: 'DATABASE_URL_OWNER',
        efectiva: prod,
        delArchivo: dev,
        hostProduccion: hostProd,
      }),
    ).toThrow(/no coincide con la de \.env\.local/);
    const e = capturar(() =>
      verificarDestino({ variable: 'DATABASE_URL_OWNER', efectiva: prod, delArchivo: dev }),
    );
    expect(e).toBeInstanceOf(GuardaBdError);
    expect(String((e as Error).message)).not.toMatch(/:y@|:x@/);
  });

  it('una URL inválida no expone la cadena de conexión (describirUrl) y verificarDestino nombra la variable sin su valor', () => {
    const err = capturar(() => describirUrl('no es una url :secreto'));
    expect(err).toBeInstanceOf(GuardaBdError);
    expect((err as Error).message).not.toContain('secreto');
    expect(String(err)).not.toContain('secreto');
    expect(JSON.stringify(err)).not.toContain('secreto');
    expect((err as { cause?: unknown }).cause).toBeUndefined();

    const err2 = capturar(() =>
      verificarDestino({ variable: 'DATABASE_URL_OWNER', efectiva: 'no es una url :secreto' }),
    );
    expect(err2).toBeInstanceOf(GuardaBdError);
    expect((err2 as Error).message).toMatch(/DATABASE_URL_OWNER/);
    expect((err2 as Error).message).not.toContain('secreto');
    expect(String(err2)).not.toContain('secreto');
    expect(JSON.stringify(err2)).not.toContain('secreto');
  });

  it('producción (también por el host con -pooler) exige confirmación y con KAZERO_OTRA_BD=confirmo se acepta', () => {
    expect(() => verificarDestino({ variable: 'X', efectiva: prod, hostProduccion: hostProd })).toThrow(
      GuardaBdError,
    );
    expect(() => verificarDestino({ variable: 'X', efectiva: prod, hostProduccion: hostProd })).toThrow(
      /PRODUCCIÓN/,
    );
    const pooled = prod.replace('ep-prod-9', 'ep-prod-9-pooler');
    expect(() => verificarDestino({ variable: 'X', efectiva: pooled, hostProduccion: hostProd })).toThrow(
      /PRODUCCIÓN/,
    );
    const d = verificarDestino({
      variable: 'X',
      efectiva: prod,
      hostProduccion: hostProd,
      confirmacion: 'confirmo',
    });
    expect(d.esProduccion).toBe(true);
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

  it('no falla en CI cuando KAZERO_HOST_PROD está definida y el destino no es producción', () => {
    vi.stubEnv('CI', 'true');
    vi.stubEnv('KAZERO_HOST_PROD', hostProd);
    vi.stubEnv('DATABASE_URL_OWNER', dev);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(() => prepararDestino('DATABASE_URL_OWNER', 'prueba', 'no-existe.env')).not.toThrow();
    vi.restoreAllMocks();
  });
});

describe('prepararDestinoDetallado con exigirHostProduccion (migrador)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  it('falla cerrada fuera de CI si no se conoce el host de producción', () => {
    vi.stubEnv('CI', '');
    vi.stubEnv('KAZERO_HOST_PROD', '');
    vi.stubEnv('DATABASE_URL_OWNER', dev);
    expect(() =>
      prepararDestinoDetallado('DATABASE_URL_OWNER', 'prueba', 'no-existe.env', {
        exigirHostProduccion: true,
      }),
    ).toThrow(GuardaBdError);
    // Sin la opción, el comportamiento previo se conserva.
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(() => prepararDestinoDetallado('DATABASE_URL_OWNER', 'prueba', 'no-existe.env')).not.toThrow();
  });
  it('con el host conocido devuelve destino, base y si es producción', () => {
    vi.stubEnv('CI', '');
    vi.stubEnv('KAZERO_HOST_PROD', hostProd);
    vi.stubEnv('DATABASE_URL_OWNER', dev);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(
      prepararDestinoDetallado('DATABASE_URL_OWNER', 'prueba', 'no-existe.env', {
        exigirHostProduccion: true,
      }),
    ).toEqual({
      url: dev,
      esProduccion: false,
      host: 'ep-dev-1.us-east-2.aws.neon.tech',
      baseDatos: 'neondb',
    });
  });
});

describe('verificarSecreto', () => {
  it('pasa si coincide, si falta en la terminal o si hay confirmación', () => {
    expect(() => verificarSecreto({ variable: 'K', efectiva: 'a', delArchivo: 'a' })).not.toThrow();
    expect(() => verificarSecreto({ variable: 'K', efectiva: 'a' })).not.toThrow();
    expect(() =>
      verificarSecreto({ variable: 'K', efectiva: 'a', delArchivo: 'b', confirmacion: 'confirmo' }),
    ).not.toThrow();
  });

  it('falla si difiere de .env.local sin mostrar ningún valor', () => {
    const err = capturar(() =>
      verificarSecreto({ variable: 'K', efectiva: 'valor-terminal', delArchivo: 'valor-archivo' }),
    );
    expect(err).toBeInstanceOf(GuardaBdError);
    expect((err as Error).message).toMatch(/K/);
    expect((err as Error).message).not.toMatch(/valor-terminal|valor-archivo/);
  });
});
