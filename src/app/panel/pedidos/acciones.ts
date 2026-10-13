'use server';

import { redirect } from 'next/navigation';
import { conDb } from '@/db/client';
import { pesosACentavos } from '@/domain/dinero';
import { MAX_PIEZAS_PEDIDO, parsearFolio } from '@/domain/pedidos';
import { partirCodigos } from '@/features/exhibidores/codigos';
import type { EstadoAccion } from '@/features/ui/estado';
import { ejecutarAccion, texto, uuidDe, versionDe } from '@/server/acciones';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { crearCliente } from '@/server/clientes/servicio';
import { ErrorNegocio } from '@/server/errores';
import { registrarPagoDePedido, type MetodoPago } from '@/server/pagos/servicio';
import { cancelarPedido, crearPedido, editarPedido } from '@/server/pedidos/servicio';
import { revalidarPedido } from './revalidar';

function centavosDe(fd: FormData, campo: string): number {
  const t = texto(fd, campo).trim();
  if (!t) return 0;
  const c = pesosACentavos(t);
  if (c === null)
    throw new ErrorNegocio('monto_invalido', 'Escribe un monto válido, por ejemplo 149 o 149.50.', campo);
  return c;
}

function folioDe(fd: FormData): number {
  const f = parsearFolio(texto(fd, 'folio'));
  if (f === null) throw new ErrorNegocio('no_encontrado', 'Registro no encontrado.');
  return f;
}

export async function accionCrearPedido(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    if (!texto(fd, 'clienteId'))
      throw new ErrorNegocio('cliente_requerido', 'Elige un cliente.', 'clienteId');
    const codigos = fd.getAll('codigo').filter((c): c is string => typeof c === 'string');
    if (codigos.length > MAX_PIEZAS_PEDIDO)
      throw new ErrorNegocio(
        'demasiadas_piezas',
        `Máximo ${MAX_PIEZAS_PEDIDO} piezas por pedido.`,
        'codigos',
      );
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

export async function accionRegistrarPago(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    const folio = folioDe(fd);
    const pagador = texto(fd, 'pagador') === 'vendedor' ? 'vendedor' : 'cliente';
    const r = await conDb((db) =>
      registrarPagoDePedido(db, {
        key: uuidDe(fd, 'key'),
        adminId,
        pedidoId: uuidDe(fd, 'pedidoId'),
        fecha: texto(fd, 'fecha').slice(0, 20),
        montoCentavos: centavosDe(fd, 'monto'),
        metodo: texto(fd, 'metodo') as MetodoPago, // el servicio valida contra METODOS_PAGO
        pagador,
        nota: texto(fd, 'nota').slice(0, 400),
      }),
    );
    revalidarPedido(folio);
    return r.estado === 'liquidado' ? 'Pago registrado. El pedido quedó liquidado.' : 'Pago registrado.';
  });
}

export async function accionCancelarPedido(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    const folio = folioDe(fd);
    // Acción irreversible: la casilla `required` del formulario no basta, un POST directo la saltaría.
    if (texto(fd, 'confirmo') !== 'on')
      throw new ErrorNegocio(
        'confirmacion',
        'Marca la casilla para confirmar que entiendes que no se puede deshacer.',
      );
    await conDb((db) =>
      cancelarPedido(db, {
        key: uuidDe(fd, 'key'),
        adminId,
        pedidoId: uuidDe(fd, 'pedidoId'),
        version: versionDe(fd),
        motivo: texto(fd, 'motivo').slice(0, 400),
      }),
    );
    revalidarPedido(folio);
    return 'Pedido cancelado.';
  });
}

export async function accionEditarPedido(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    const folio = folioDe(fd);
    await conDb((db) =>
      editarPedido(db, {
        key: uuidDe(fd, 'key'),
        adminId,
        pedidoId: uuidDe(fd, 'pedidoId'),
        version: versionDe(fd),
        vendedorId: uuidDe(fd, 'vendedorId'),
        fecha: texto(fd, 'fecha').slice(0, 20),
        descuentoManualCentavos: centavosDe(fd, 'descuentoManual'),
        descuentoManualMotivo: texto(fd, 'descuentoMotivo').slice(0, 400),
        notas: texto(fd, 'notas').slice(0, 1000),
        agregar: partirCodigos(texto(fd, 'agregar')),
        quitar: fd.getAll('quitar').filter((c): c is string => typeof c === 'string'),
        motivo: texto(fd, 'motivo').slice(0, 400),
      }),
    );
    revalidarPedido(folio);
    redirect(`/panel/pedidos/${folio}?editado=1`);
  });
}
