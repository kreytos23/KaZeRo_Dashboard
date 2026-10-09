import { describe, expect, it } from 'vitest';
import { esquemaCorreo, validarAltaAdmin } from '@/server/auth/validacion';

const BUENA = 'contraseña-suficientemente-larga';

describe('esquemaCorreo (el mismo del login)', () => {
  it('acepta un correo normal y rechaza basura o más de 200 caracteres', () => {
    expect(esquemaCorreo.safeParse('duena@kazero.mx').success).toBe(true);
    expect(esquemaCorreo.safeParse('no-es-correo').success).toBe(false);
    expect(esquemaCorreo.safeParse(`${'a'.repeat(195)}@kazero.mx`).success).toBe(false);
  });
});

describe('validarAltaAdmin', () => {
  it('acepta datos válidos', () => {
    expect(validarAltaAdmin({ email: 'a@kazero.mx', password: BUENA, confirmacion: BUENA })).toBeNull();
  });
  it('rechaza un correo inválido', () => {
    expect(validarAltaAdmin({ email: 'a@', password: BUENA, confirmacion: BUENA })).toMatch(/correo/i);
  });
  it('rechaza contraseñas que no coinciden', () => {
    expect(validarAltaAdmin({ email: 'a@kazero.mx', password: BUENA, confirmacion: `${BUENA}x` })).toMatch(
      /no coinciden/,
    );
  });
  it('rechaza una contraseña corta', () => {
    expect(validarAltaAdmin({ email: 'a@kazero.mx', password: 'corta', confirmacion: 'corta' })).toMatch(
      /12/,
    );
  });
});
