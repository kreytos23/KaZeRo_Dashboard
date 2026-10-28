'use server';

import { redirect } from 'next/navigation';
import { conDb } from '@/db/client';
import { formatoMXN, pesosACentavos } from '@/domain/dinero';
import { MAX_PIEZAS_PEDIDO, parsearFolio } from '@/domain/pedidos';
import { partirCodigos } from '@/features/exhibidores/codigos';
import type { EstadoAccion } from '@/features/ui/estado';
import {
  bytesDeArchivo,
  centavosDe,
  ejecutarAccion,
  texto,
  uuidDe,
  uuidOpcional,
  uuidOpcionalDe,
  versionDe,
} from '@/server/acciones';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { crearCliente } from '@/server/clientes/servicio';
import { ErrorNegocio } from '@/server/errores';
import { almacenImagenes } from '@/server/imagenes/almacen';
import { registrarPagoAgrupado } from '@/server/pagos/agrupado';
import { agregarComprobante, type Comprobante } from '@/server/pagos/comprobante';
import { registrarPagoDePedido, type MetodoPago } from '@/server/pagos/servicio';
import { subirComprobante } from '@/server/pagos/subida';
import { devolverPiezaDefectuosa } from '@/server/pedidos/devolucion';
import { cancelarPedido, crearPedido, editarPedido } from '@/server/pedidos/servicio';
import { revalidarPedido, revalidarPedidos } from './revalidar';

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
        descuentoManualCentavos: centavosDe(fd, 'descuentoManual', { vacioEsCero: true }),
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

/** Captura opcional del pago: se sube ANTES del servicio; si este falla, el barrido recoge el blob huérfano. */
async function comprobanteDe(fd: FormData): Promise<Comprobante | null> {
  const bytes = await bytesDeArchivo(fd, 'comprobante', { opcional: true });
  return bytes ? subirComprobante(almacenImagenes(), bytes) : null;
}

export async function accionRegistrarPago(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    const folio = folioDe(fd);
    const pagador = texto(fd, 'pagador') === 'vendedor' ? 'vendedor' : 'cliente';
    const comprobante = await comprobanteDe(fd);
    const r = await conDb((db) =>
      registrarPagoDePedido(db, {
        key: uuidDe(fd, 'key'),
        adminId,
        pedidoId: uuidDe(fd, 'pedidoId'),
        fecha: texto(fd, 'fecha').slice(0, 20),
        montoCentavos: centavosDe(fd, 'monto', { vacioEsCero: true }),
        metodo: texto(fd, 'metodo') as MetodoPago, // el servicio valida contra METODOS_PAGO
        pagador,
        nota: texto(fd, 'nota').slice(0, 400),
        exhibidorId: uuidOpcionalDe(fd, 'exhibidorId'),
        referencia: texto(fd, 'referencia').slice(0, 100),
        comprobante,
        confirmarDuplicado: texto(fd, 'confirmarDuplicado') === 'on',
      }),
    );
    revalidarPedido(folio);
    return r.estado === 'liquidado' ? 'Pago registrado. El pedido quedó liquidado.' : 'Pago registrado.';
  });
}

/** P-1: la vendedora paga varios de sus pedidos de una vez (`pedidoId` y `montoPedido` van en pares; vacío = no aplica). */
export async function accionPagoAgrupado(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    const montos = fd.getAll('montoPedido');
    const aplicaciones = fd.getAll('pedidoId').flatMap((id, i) => {
      const pesos = String(montos[i] ?? '').trim();
      if (!pesos) return [];
      const pedidoId = typeof id === 'string' ? uuidOpcional(id) : null;
      const montoCentavos = pesosACentavos(pesos);
      if (!pedidoId || montoCentavos === null)
        throw new ErrorNegocio(
          'monto_invalido',
          'Escribe montos válidos, por ejemplo 149 o 149.50.',
          'aplicaciones',
        );
      return [{ pedidoId, montoCentavos }];
    });
    const comprobante = await comprobanteDe(fd);
    const r = await conDb((db) =>
      registrarPagoAgrupado(db, {
        key: uuidDe(fd, 'key'),
        adminId,
        vendedorId: uuidDe(fd, 'vendedorId'),
        fecha: texto(fd, 'fecha').slice(0, 20),
        montoCentavos: centavosDe(fd, 'monto', { vacioEsCero: true }),
        metodo: texto(fd, 'metodo') as MetodoPago,
        referencia: texto(fd, 'referencia').slice(0, 100),
        aplicaciones,
        comprobante,
        confirmarDuplicado: texto(fd, 'confirmarDuplicado') === 'on',
      }),
    );
    revalidarPedidos();
    return r.sobranteCentavos > 0
      ? `Pago registrado. Sobraron ${formatoMXN(r.sobranteCentavos)}: quedan como saldo a favor de la vendedora.`
      : 'Pago registrado.';
  });
}

/** P-3: agrega la captura a un pago que no la tiene. */
export async function accionAgregarComprobante(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    const comprobante = await comprobanteDe(fd);
    if (!comprobante) throw new ErrorNegocio('imagen', 'Elige la captura del pago.', 'comprobante');
    await conDb((db) =>
      agregarComprobante(db, {
        key: uuidDe(fd, 'key'),
        adminId,
        pagoId: uuidDe(fd, 'pagoId'),
        ...comprobante,
      }),
    );
    revalidarPedidos();
    return 'Comprobante guardado.';
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
        descuentoManualCentavos: centavosDe(fd, 'descuentoManual', { vacioEsCero: true }),
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

export async function accionDevolverPieza(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const { adminId } = await requerirSesion();
  return ejecutarAccion(async () => {
    const folio = folioDe(fd);
    // Mueve dinero a saldo a favor y no se deshace: la casilla `required` no basta, un POST directo la saltaría.
    if (texto(fd, 'confirmo') !== 'on')
      throw new ErrorNegocio('confirmacion', 'Marca la casilla para confirmar la devolución.');
    await conDb((db) =>
      devolverPiezaDefectuosa(db, {
        key: uuidDe(fd, 'key'),
        adminId,
        pedidoId: uuidDe(fd, 'pedidoId'),
        itemId: uuidDe(fd, 'itemId'),
        motivo: texto(fd, 'motivo').slice(0, 400),
        fecha: texto(fd, 'fecha').slice(0, 20),
      }),
    );
    revalidarPedido(folio);
    redirect(`/panel/pedidos/${folio}?devuelta=1`);
  });
}
