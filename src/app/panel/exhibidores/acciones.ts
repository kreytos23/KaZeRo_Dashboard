'use server';

import { revalidatePath } from 'next/cache';
import { conDb } from '@/db/client';
import type { EstadoAccion } from '@/features/ui/estado';
import { formatoFolio } from '@/domain/pedidos';
import { pesosACentavos } from '@/domain/dinero';
import { ejecutarAccion, texto, uuidDe, versionDe } from '@/server/acciones';
import { partirCodigos } from '@/features/exhibidores/codigos';
import { montoAjusteCentavos } from '@/features/exhibidores/dinero-ui';
import { revalidarPedido } from '../pedidos/revalidar';
import {
  registrarAjusteExhibidor,
  registrarEntregaExhibidor,
  registrarVentaExhibidor,
} from '@/server/exhibidores/dinero';
import { registrarPagoDePedido, type MetodoPago } from '@/server/pagos/servicio';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { ErrorNegocio } from '@/server/errores';
import {
  cerrarExhibidor,
  crearExhibidor,
  editarExhibidor,
  enviarPiezas,
  regresarPiezas,
} from '@/server/exhibidores/servicio';

const codigosDe = (fd: FormData) => partirCodigos(texto(fd, 'codigos'));

const piezas = (n: number, participio: 'enviada' | 'regresada') =>
  n === 1 ? `1 pieza ${participio}.` : `${n} piezas ${participio}s.`;

/** Una pieza cambió de estado: se refrescan la ficha, el listado y el inventario. */
function revalidarPiezas(exhibidorId: string) {
  revalidatePath(`/panel/exhibidores/${exhibidorId}`);
  revalidatePath('/panel/exhibidores');
  revalidatePath('/panel/inventario');
  revalidatePath('/panel/inventario/[codigo]', 'page');
}

export async function accionCrearExhibidor(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  await requerirSesion();
  return ejecutarAccion(async () => {
    if (texto(fd, 'nombre').length > 200)
      throw new ErrorNegocio(
        'exhibidor_invalido',
        'El nombre debe tener entre 1 y 120 caracteres.',
        'nombre',
      );
    await conDb((db) =>
      crearExhibidor(db, {
        vendedorId: uuidDe(fd, 'vendedorId'),
        nombre: texto(fd, 'nombre'),
        fechaEnvio: texto(fd, 'fechaEnvio').slice(0, 20),
      }),
    );
    revalidatePath('/panel/exhibidores');
    revalidatePath('/panel/vendedores/[id]', 'page');
    return 'Exhibidor creado.';
  });
}

export async function accionEnviar(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  await requerirSesion();
  return ejecutarAccion(async () => {
    const exhibidorId = uuidDe(fd, 'exhibidorId');
    const { enviadas } = await conDb((db) => enviarPiezas(db, { exhibidorId, codigos: codigosDe(fd) }));
    revalidarPiezas(exhibidorId);
    return piezas(enviadas, 'enviada');
  });
}

export async function accionRegresar(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  await requerirSesion();
  return ejecutarAccion(async () => {
    const exhibidorId = uuidDe(fd, 'exhibidorId');
    const { regresadas } = await conDb((db) => regresarPiezas(db, { exhibidorId, codigos: codigosDe(fd) }));
    revalidarPiezas(exhibidorId);
    return piezas(regresadas, 'regresada');
  });
}

export async function accionCerrar(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  await requerirSesion();
  return ejecutarAccion(async () => {
    const exhibidorId = uuidDe(fd, 'exhibidorId');
    const version = versionDe(fd);
    if (texto(fd, 'confirmo') !== 'si')
      throw new ErrorNegocio('sin_confirmacion', 'Confirma que quieres cerrar el exhibidor.');
    await conDb((db) => cerrarExhibidor(db, { exhibidorId, version }));
    revalidarPiezas(exhibidorId);
    return 'Exhibidor cerrado.';
  });
}

export async function accionEditarExhibidor(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    const exhibidorId = uuidDe(fd, 'exhibidorId');
    if (texto(fd, 'nombre').length > 200)
      throw new ErrorNegocio(
        'exhibidor_invalido',
        'El nombre debe tener entre 1 y 120 caracteres.',
        'nombre',
      );
    const { cambios } = await conDb((db) =>
      editarExhibidor(db, {
        exhibidorId,
        version: versionDe(fd),
        adminId,
        motivo: texto(fd, 'motivo'),
        nombre: texto(fd, 'nombre'),
        fechaEnvio: texto(fd, 'fechaEnvio').slice(0, 20),
      }),
    );
    if (cambios === 0) return 'Sin cambios.';
    revalidarPiezas(exhibidorId); // la ficha de pieza muestra el nombre del exhibidor
    revalidatePath('/panel/vendedores/[id]', 'page');
    return 'Cambios guardados.';
  });
}

/** Monto en pesos del formulario; vacío cuenta como 0 solo si `vacioEsCero`. */
function centavosDe(fd: FormData, campo: string, vacioEsCero = false): number {
  const t = texto(fd, campo).trim();
  if (!t && vacioEsCero) return 0;
  const c = pesosACentavos(t);
  if (c === null)
    throw new ErrorNegocio('monto_invalido', 'Escribe un monto válido, por ejemplo 149 o 149.50.', campo);
  return c;
}

/** El dinero del exhibidor toca su ficha y lista, las notas, las clientas, el inicio y el inventario. */
function revalidarDinero(exhibidorId: string, folio?: number) {
  if (folio !== undefined) revalidarPedido(folio);
  revalidarPiezas(exhibidorId);
  revalidatePath('/panel/pedidos');
  revalidatePath('/panel/clientes/[id]', 'page');
  revalidatePath('/panel');
}

export async function accionRegistrarVenta(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    const exhibidorId = uuidDe(fd, 'exhibidorId');
    const mostrador = texto(fd, 'mostrador') === 'on';
    if (!mostrador && !texto(fd, 'clienteId'))
      throw new ErrorNegocio(
        'cliente_requerido',
        'Elige una clienta o marca «Sin clienta (venta de mostrador)».',
        'clienteId',
      );
    const r = await conDb((db) =>
      registrarVentaExhibidor(db, {
        key: uuidDe(fd, 'key'),
        adminId,
        exhibidorId,
        codigos: codigosDe(fd),
        clienteId: mostrador ? null : uuidDe(fd, 'clienteId'),
        fecha: texto(fd, 'fecha').slice(0, 20),
        cobradoCentavos: centavosDe(fd, 'cobrado', true),
        metodo: texto(fd, 'metodo') as MetodoPago, // el servicio valida contra METODOS_PAGO
      }),
    );
    revalidarDinero(exhibidorId, r.folio);
    return r.estado === 'liquidado'
      ? `Venta ${formatoFolio(r.folio)} registrada y liquidada.`
      : `Venta ${formatoFolio(r.folio)} registrada.`;
  });
}

export async function accionAbonoExhibidor(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    const exhibidorId = uuidDe(fd, 'exhibidorId');
    const folio = Number(texto(fd, 'folio'));
    const r = await conDb((db) =>
      registrarPagoDePedido(db, {
        key: uuidDe(fd, 'key'),
        adminId,
        pedidoId: uuidDe(fd, 'pedidoId'),
        fecha: texto(fd, 'fecha').slice(0, 20),
        montoCentavos: centavosDe(fd, 'monto'),
        metodo: texto(fd, 'metodo') as MetodoPago,
        pagador: 'cliente',
        exhibidorId,
      }),
    );
    revalidarDinero(exhibidorId, Number.isInteger(folio) ? folio : undefined);
    return r.estado === 'liquidado' ? 'Abono registrado. La nota quedó liquidada.' : 'Abono registrado.';
  });
}

export async function accionRegistrarEntrega(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    const exhibidorId = uuidDe(fd, 'exhibidorId');
    await conDb((db) =>
      registrarEntregaExhibidor(db, {
        key: uuidDe(fd, 'key'),
        adminId,
        exhibidorId,
        montoCentavos: centavosDe(fd, 'monto'),
        fecha: texto(fd, 'fecha').slice(0, 20),
        metodo: texto(fd, 'metodo') as 'efectivo' | 'transferencia' | 'otro',
        nota: texto(fd, 'nota').slice(0, 400),
      }),
    );
    revalidarDinero(exhibidorId);
    return 'Entrega registrada.';
  });
}

export async function accionRegistrarAjuste(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    const exhibidorId = uuidDe(fd, 'exhibidorId');
    // Dinero que cambia el por entregar sin pasar por una venta ni una entrega: pide confirmación explícita.
    if (texto(fd, 'confirmo') !== 'on')
      throw new ErrorNegocio('confirmacion', 'Marca la casilla para confirmar el ajuste.');
    const montoCentavos = montoAjusteCentavos(texto(fd, 'direccion'), texto(fd, 'monto'));
    if (montoCentavos === null)
      throw new ErrorNegocio('monto_invalido', 'Escribe un monto válido mayor que cero.', 'monto');
    await conDb((db) =>
      registrarAjusteExhibidor(db, {
        key: uuidDe(fd, 'key'),
        adminId,
        exhibidorId,
        montoCentavos,
        motivo: texto(fd, 'motivo').slice(0, 400),
        fecha: texto(fd, 'fecha').slice(0, 20),
      }),
    );
    revalidarDinero(exhibidorId);
    return 'Ajuste registrado.';
  });
}
