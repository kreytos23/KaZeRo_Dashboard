'use server';

import { redirect } from 'next/navigation';
import { conDb } from '@/db/client';
import { pesosACentavos } from '@/domain/dinero';
import { MAX_PIEZAS_PEDIDO } from '@/domain/pedidos';
import type { EstadoAccion } from '@/features/ui/estado';
import { ejecutarAccion, texto, uuidDe } from '@/server/acciones';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { crearCliente } from '@/server/clientes/servicio';
import { ErrorNegocio } from '@/server/errores';
import { crearPedido } from '@/server/pedidos/servicio';
import { revalidarPedido } from './revalidar';

function centavosDe(fd: FormData, campo: string): number {
  const t = texto(fd, campo).trim();
  if (!t) return 0;
  const c = pesosACentavos(t);
  if (c === null)
    throw new ErrorNegocio('monto_invalido', 'Escribe un monto válido, por ejemplo 149 o 149.50.', campo);
  return c;
}

export async function accionCrearPedido(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    if (!texto(fd, 'clienteId'))
      throw new ErrorNegocio('cliente_requerido', 'Elige un cliente.', 'clienteId');
    const codigos = fd.getAll('codigo').filter((c): c is string => typeof c === 'string');
    if (codigos.length > MAX_PIEZAS_PEDIDO)
      throw new ErrorNegocio('sin_piezas', `Máximo ${MAX_PIEZAS_PEDIDO} piezas por pedido.`, 'codigos');
    const r = await conDb((db) =>
      crearPedido(db, {
        key: uuidDe(fd, 'key'),
        adminId,
        clienteId: uuidDe(fd, 'clienteId'),
        vendedorId: uuidDe(fd, 'vendedorId'),
        fecha: texto(fd, 'fecha').slice(0, 20),
        codigos: codigos.map((c) => c.slice(0, 40)),
        cuentaTarjeta: fd.get('cuentaTarjeta') === 'on',
        descuentoManualCentavos: centavosDe(fd, 'descuentoManual'),
        descuentoManualMotivo: texto(fd, 'descuentoMotivo').slice(0, 400),
        notas: texto(fd, 'notas').slice(0, 1000),
      }),
    );
    revalidarPedido(r.folio);
    // Redirige desde el servidor: el botón nunca se rehabilita entre el éxito y la navegación (minor del Plan 2).
    redirect(`/panel/pedidos/${r.folio}?creado=1`);
  });
}

/** Alta en línea desde el selector de cliente (spec §8). Se llama como función, no como <form> (no se anidan). */
export async function accionClienteRapido(
  nombre: string,
): Promise<{ id?: string; nombre?: string; error?: string }> {
  await requerirSesion();
  const r = await ejecutarAccion(async () => {
    const id = await conDb((db) => crearCliente(db, { nombre: String(nombre).slice(0, 200) }));
    return id;
  });
  if (r.error) return { error: r.error };
  return { id: r.ok, nombre: String(nombre).trim().replace(/\s+/g, ' ') };
}
