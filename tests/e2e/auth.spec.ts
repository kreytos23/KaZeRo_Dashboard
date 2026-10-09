import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { codigoTotpNoUsado, datosAdmin } from './utilidades';

test('una ruta privada sin sesión manda a iniciar sesión', async ({ page }) => {
  await page.goto('/panel');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
});

test('una cookie de sesión inventada no abre el panel', async ({ page, context, baseURL }) => {
  // El proxy solo mira que la cookie exista: la validación real (layout del panel) debe rechazarla.
  await context.addCookies([
    {
      name: '__Host-kz_sesion',
      value: randomBytes(32).toString('base64url'),
      url: baseURL!,
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto('/panel');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
});

test('contraseña incorrecta muestra un error genérico', async ({ page }) => {
  const d = datosAdmin();
  await page.goto('/login');
  await page.getByLabel('Correo').fill(d.email);
  await page.getByLabel('Contraseña').fill('no-es-la-contraseña');
  await page.getByRole('button', { name: 'Continuar' }).click();
  // Next añade su propio role=alert (route announcer, vacío): se filtra por texto.
  await expect(page.getByRole('alert').filter({ hasText: 'Correo o contraseña incorrectos.' })).toBeVisible();
});

test('login con contraseña y TOTP llega al panel; cerrar sesión lo protege de nuevo', async ({ page }) => {
  const d = datosAdmin();
  const problemasCsp: string[] = [];
  const revisar = (texto: string) => {
    if (/content[- ]security[- ]policy|violates/i.test(texto)) problemasCsp.push(texto);
  };
  page.on('console', (m) => revisar(m.text()));
  page.on('pageerror', (e) => revisar(e.message));
  const nombresCookies = async () => (await page.context().cookies()).map((c) => c.name);

  await page.goto('/login');
  await page.getByLabel('Correo').fill(d.email);
  await page.getByLabel('Contraseña').fill(d.password);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Verificación en dos pasos' })).toBeVisible();

  await page.getByLabel('Código de 6 dígitos').fill(await codigoTotpNoUsado(d.secretoTotp));
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Panel Kazero' })).toBeVisible();
  const trasLogin = await nombresCookies();
  expect(trasLogin).toContain('__Host-kz_sesion');
  expect(trasLogin).not.toContain('__Host-kz_pre');

  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await nombresCookies()).not.toContain('__Host-kz_sesion');
  await page.goto('/panel');
  await expect(page).toHaveURL(/\/login$/);

  // El nonce de la CSP llega a los scripts de Next: no debe haber violaciones en /login, /login/verificar ni /panel.
  expect(problemasCsp).toEqual([]);
});
