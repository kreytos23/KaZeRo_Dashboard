import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { conDbUrl } from '../../src/db/pool';
import { generarCodigoTotp } from '../../src/server/auth/totp';

// Cada proceso de Playwright (uno por proyecto, ver scripts/test-neon.ts) usa su propio directorio de datos.
export const DIR_DATOS = process.env.KAZERO_E2E_DATOS ?? 'playwright/.datos';
export const RUTA_DATOS = `${DIR_DATOS}/admin.json`;
export const RUTA_ESTADO = `${DIR_DATOS}/estado.json`;
export const RUTA_ESTADO_REGEN = `${DIR_DATOS}/estado-regen.json`;
export const RUTA_DATOS_REGEN = `${DIR_DATOS}/admin-regen.json`;
export const RUTA_PASO = `${DIR_DATOS}/ultimo-paso`;

export function datosAdmin(): { adminId: string; email: string; password: string; secretoTotp: string } {
  return JSON.parse(readFileSync(RUTA_DATOS, 'utf8'));
}

/** El servidor rechaza reutilizar un paso TOTP: si el actual ya se usó, espera al siguiente (≤30 s). */
export async function codigoTotpNoUsado(secreto: string): Promise<string> {
  const ultimo = existsSync(RUTA_PASO) ? Number(readFileSync(RUTA_PASO, 'utf8')) : 0;
  let paso = Math.floor(Date.now() / 30_000);
  while (paso <= ultimo) {
    await new Promise((r) => setTimeout(r, 1_000));
    paso = Math.floor(Date.now() / 30_000);
  }
  writeFileSync(RUTA_PASO, String(paso));
  // El código se genera para el paso ANOTADO: si el reloj cruzara al siguiente paso entre medias, sin esto
  // el código sería de paso+1 y la siguiente llamada lo repetiría (rechazado por reutilizar el paso).
  return generarCodigoTotp(secreto, new Date(paso * 30_000));
}

/** Admin aparte para regenerar el TOTP: la acción revoca sus otras sesiones y cambia su secreto. */
export function datosAdminRegen(): { email: string; password: string } {
  return JSON.parse(readFileSync(RUTA_DATOS_REGEN, 'utf8'));
}

/** En pantallas < md la navegación y el cierre de sesión viven en el menú: se abre (no-op en escritorio). */
export async function abrirMenuSiMovil(page: Page) {
  const boton = page.getByRole('button', { name: 'Menú' });
  if (!(await boton.isVisible())) return;
  // Hasta hidratar, el clic no hace nada: se reintenta hasta ver el menú abierto.
  await expect(async () => {
    if ((await boton.getAttribute('aria-expanded')) !== 'true') await boton.click();
    await expect(boton).toHaveAttribute('aria-expanded', 'true', { timeout: 500 });
  }).toPass();
}

/**
 * Los formularios con `onSubmit` nacen con el botón deshabilitado y `data-hidratado="no"`; React los marca "si"
 * al hidratar. Hay que esperar antes de interactuar: un envío previo sería nativo (campos en la URL).
 */
export async function esperarHidratado(page: Page) {
  await page.waitForFunction(() => !document.querySelector('form[data-hidratado="no"]'));
}

/** `goto` seguido de la espera a la hidratación de los formularios de la página. */
export async function irA(page: Page, ruta: string) {
  await page.goto(ruta);
  await esperarHidratado(page);
}

// ---------------------------------------------------------------------------------------------------------------
// Siembra de datos de prueba con los servicios reales (nunca datos reales; las altas por UI ya las cubre
// panel.spec.ts). Se conectan como dueño a la rama de prueba de este proyecto.
// ---------------------------------------------------------------------------------------------------------------

let hookListo = false;
/** `server-only` lanza fuera de Next: en este proceso de pruebas se resuelve a un módulo vacío (como en Vitest). */
function permitirServerOnly() {
  if (hookListo) return;
  hookListo = true;
  const hooks = `export async function resolve(s, c, next) {
    if (s === 'server-only') return { url: 'data:text/javascript,export {}', shortCircuit: true };
    return next(s, c);
  }`;
  register(`data:text/javascript,${encodeURIComponent(hooks)}`);
}

async function servicios() {
  permitirServerOnly();
  const [pedidos, pagos, piezas, clientes, vendedores, exhibidores] = await Promise.all([
    import('../../src/server/pedidos/servicio'),
    import('../../src/server/pagos/servicio'),
    import('../../src/server/piezas/servicio'),
    import('../../src/server/clientes/servicio'),
    import('../../src/server/vendedores/servicio'),
    import('../../src/server/exhibidores/servicio'),
  ]);
  return { pedidos, pagos, piezas, clientes, vendedores, exhibidores };
}
const dueno = <T>(fn: Parameters<typeof conDbUrl<T>>[1]) => conDbUrl(process.env.DATABASE_URL_OWNER!, fn);

export async function sembrarVendedor(nombre: string): Promise<string> {
  const s = await servicios();
  return dueno((db) => s.vendedores.crearVendedor(db, { nombre, tipo: 'casa', comisionPct: '0.00' }));
}

/** Vendedora que no es la casa: puede tener piezas en su poder (Plan 3.1). */
export async function sembrarVendedora(nombre: string): Promise<string> {
  const s = await servicios();
  return dueno((db) => s.vendedores.crearVendedor(db, { nombre, tipo: 'revendedora', comisionPct: '10.00' }));
}

export async function sembrarCliente(nombre: string): Promise<string> {
  const s = await servicios();
  return dueno((db) => s.clientes.crearCliente(db, { nombre }));
}

/** Altas en serie (comparten catálogo "Anillos": en paralelo chocarían al crearlo). */
export async function sembrarPiezas(
  codigos: string[],
  precioCentavos: number,
  categoria: (codigo: string) => string = () => 'Anillos',
): Promise<void> {
  const s = await servicios();
  for (const codigo of codigos)
    await dueno((db) =>
      s.piezas.altaPieza(db, {
        codigo,
        categoria: categoria(codigo),
        descripcion: `Anillo ${codigo}`,
        costoCentavos: 0,
        precioCentavos,
      }),
    );
}

async function pedidoDe(clienteId: string, vendedorId: string, codigos: string[]) {
  const s = await servicios();
  const { adminId } = datosAdmin();
  return dueno((db) =>
    s.pedidos.crearPedido(db, {
      key: randomUUID(),
      adminId,
      clienteId,
      vendedorId,
      codigos,
      cuentaTarjeta: true,
      descuentoManualCentavos: 0,
    }),
  );
}

/** n pedidos liquidados al instante (piezas de precio 0, D-8): llenan n casillas ● de la tarjeta. */
export async function sembrarCompras(clienteId: string, vendedorId: string, n: number, prefijo: string) {
  const codigos = Array.from({ length: n }, (_, i) => `${prefijo}${i + 1}`);
  await sembrarPiezas(codigos, 0);
  for (const c of codigos) await pedidoDe(clienteId, vendedorId, [c]);
}

/** Un pedido abierto (saldo pendiente) con una pieza de $149 que se crea aquí. */
export async function sembrarPedidoAbierto(
  clienteId: string,
  vendedorId: string,
  codigo: string,
): Promise<{ id: string; folio: number }> {
  await sembrarPiezas([codigo], 14900);
  const { id, folio } = await pedidoDe(clienteId, vendedorId, [codigo]);
  return { id, folio };
}

/** Exhibidor abierto de un vendedor nuevo con una pieza enviada. */
export async function sembrarExhibidorConPieza(
  m: string,
  codigo: string,
  precioCentavos = 14900,
): Promise<{ exhibidorId: string; vendedorId: string }> {
  const s = await servicios();
  const vendedorId = await sembrarVendedor(`Vend ${codigo}`);
  await sembrarPiezas([codigo], precioCentavos);
  const exhibidorId = await dueno((db) =>
    s.exhibidores.crearExhibidor(db, { vendedorId, nombre: `Exh ${m} ${codigo}`, fechaEnvio: '2026-10-01' }),
  );
  await dueno((db) => s.exhibidores.enviarPiezas(db, { exhibidorId, codigos: [codigo] }));
  return { exhibidorId, vendedorId };
}

/** Crea vendedor, exhibidor, la pieza `X{m}01` enviada a él y un pedido abierto con ella. */
export async function sembrarPedidoConExhibidor(
  m: string,
  etiqueta = 'X',
): Promise<{ exhibidorId: string; codigo: string; folio: number; clienteId: string }> {
  const codigo = `${etiqueta}${m}01`;
  const { exhibidorId, vendedorId } = await sembrarExhibidorConPieza(m, codigo);
  const clienteId = await sembrarCliente(`Cliente ${codigo}`);
  const { folio } = await pedidoDe(clienteId, vendedorId, [codigo]);
  return { exhibidorId, codigo, folio, clienteId };
}
