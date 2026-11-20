import { expect, test, type Page } from '@playwright/test';
import {
  irA,
  marcaDe,
  RUTA_ESTADO,
  sembrarCliente,
  sembrarCompras,
  sembrarPedidoAbierto,
  sembrarPiezas,
  sembrarVendedor,
  sembrarVendedora,
} from './utilidades';

// Selector de piezas para lotes: el buscador solo ofrece elegibles y regresar es con casillas.
test.use({ storageState: RUTA_ESTADO });

const estadoCon = (page: Page, texto: string) => page.getByRole('status').filter({ hasText: texto });

test('entregar a un asociado: solo se ofrecen disponibles, se quitan etiquetas y se regresa con «Seleccionar todas»', async ({
  page,
}, info) => {
  const m = marcaDe(info);
  const nombre = `Nelly ${m}`;
  const vendedoraId = await sembrarVendedora(nombre);
  const casa = await sembrarVendedor(`Casa LP${m}`);
  const cliente = await sembrarCliente(`Clienta LP ${m}`);
  const [a, b, c] = [`LP${m}A1`, `LP${m}A2`, `LP${m}A3`];
  await sembrarPiezas([a, b, c], 10000);
  await sembrarCompras(cliente, casa, 1, `LP${m}V`); // `LP{m}V1`: vendida
  await sembrarPedidoAbierto(cliente, casa, `LP${m}P1`); // apartada
  await irA(page, `/panel/vendedores/${vendedoraId}`);

  const entrega = page.getByRole('form', { name: `Entregar a ${nombre}` });
  const buscar = entrega.getByRole('combobox', { name: 'Buscar pieza' });
  const opciones = entrega.getByRole('listbox', { name: 'Piezas disponibles' }).getByRole('option');

  // La vendida y la apartada no aparecen; las disponibles sí.
  await buscar.fill(`LP${m}V1`);
  await expect(opciones).toHaveCount(0);
  await expect(entrega.getByText(`Ninguna pieza disponible coincide con «LP${m}V1».`)).toBeVisible();
  await buscar.fill(`LP${m}P1`);
  await expect(opciones).toHaveCount(0);
  await expect(entrega.getByText(`Ninguna pieza disponible coincide con «LP${m}P1».`)).toBeVisible();
  await buscar.fill(`lp${m}a`);
  await expect(opciones).toHaveCount(3);

  // Tres al lote; una ya elegida no se vuelve a ofrecer; «×» la quita.
  await entrega.getByRole('option', { name: new RegExp(a) }).click();
  await buscar.fill(`lp${m}a`);
  await expect(opciones).toHaveCount(2);
  await entrega.getByRole('option', { name: new RegExp(b) }).click();
  await buscar.fill(c);
  await buscar.press('Enter');
  const lote = entrega.getByRole('list', { name: 'Piezas del lote' });
  await expect(lote.getByRole('listitem')).toHaveCount(3);
  await entrega.getByRole('button', { name: `Quitar ${b}` }).click();
  await expect(lote.getByRole('listitem')).toHaveCount(2);
  await entrega.getByRole('button', { name: `Entregar 2 piezas a ${nombre}` }).click();
  await expect(estadoCon(page, '2 piezas entregadas.')).toBeVisible();
  await expect(lote).toHaveCount(0); // la selección se limpia al guardar
  await expect(entrega.getByRole('button', { name: `Entregar a ${nombre}` })).toBeDisabled();

  // Ya no se le ofrecen (las tiene ella); la que se quitó, sí.
  await buscar.fill(`lp${m}a`);
  await expect(opciones).toHaveCount(1);
  await expect(opciones).toContainText(b);
  await buscar.press('Escape');

  const regreso = page.getByRole('form', { name: 'Regresar a Kazero' });
  const enPoder = regreso.getByRole('list', { name: 'Piezas en su poder' });
  await expect(enPoder.getByRole('link', { name: a })).toBeVisible();
  await expect(enPoder.getByRole('link', { name: c })).toBeVisible();
  await regreso.getByRole('checkbox', { name: 'Seleccionar todas' }).check();
  await regreso.getByRole('button', { name: 'Regresar 2 piezas' }).click();
  await expect(estadoCon(page, '2 piezas regresadas.')).toBeVisible();
  await expect(regreso.getByText(`${nombre} no tiene piezas en su poder.`)).toBeVisible();
});
