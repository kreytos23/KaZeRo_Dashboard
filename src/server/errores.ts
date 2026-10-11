import { pgCode, pgConstraint } from '@/db/errors';

export class ErrorNegocio extends Error {
  override name = 'ErrorNegocio';
  constructor(
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

const MENSAJES: Record<string, string> = {
  pieza_codigo_uq: 'Ya existe una pieza con ese código.',
  pieza_codigo_formato: 'El código solo admite letras, números y guiones (máx. 20).',
  pieza_transicion: 'Ese cambio de estado no está permitido para la pieza.',
  pieza_exhibidor_coherente: 'Una pieza en exhibidor debe tener exhibidor.',
  vendedor_nombre_uq: 'Ya existe un vendedor con ese nombre.',
  vendedor_comision_rango: 'La comisión debe estar entre 0 y 100.',
  vendedor_nombre_largo: 'El nombre debe tener entre 1 y 80 caracteres.',
  cliente_nombre_largo: 'El nombre debe tener entre 1 y 120 caracteres.',
  exhibidor_nombre_largo: 'El nombre debe tener entre 1 y 120 caracteres.',
  pieza_descripcion_largo: 'La descripción debe tener entre 1 y 300 caracteres.',
  categoria_nombre_largo: 'El nombre debe tener entre 1 y 80 caracteres.',
  material_nombre_largo: 'El nombre debe tener entre 1 y 80 caracteres.',
  proveedor_nombre_largo: 'El nombre debe tener entre 1 y 80 caracteres.',
  movimiento_nota_largo: 'La nota admite hasta 200 caracteres.',
  categoria_nombre_uq: 'Esa categoría ya existe.',
  material_nombre_uq: 'Ese material ya existe.',
  proveedor_nombre_uq: 'Ese proveedor ya existe.',
  admin_email_uq: 'Ya existe un administrador con ese correo.',
};

export function traducirErrorPg(err: unknown): ErrorNegocio | null {
  const constraint = pgConstraint(err);
  if (constraint && MENSAJES[constraint]) return new ErrorNegocio(constraint, MENSAJES[constraint]);
  if (pgCode(err) === '23503') return new ErrorNegocio('referencia', 'El registro relacionado no existe.');
  return null;
}

/** Ejecuta y convierte errores conocidos de Postgres en ErrorNegocio; los demás se relanzan tal cual. */
export async function conErroresDeNegocio<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ErrorNegocio) throw e;
    throw traducirErrorPg(e) ?? e;
  }
}

export function conflictoVersion(): ErrorNegocio {
  return new ErrorNegocio('conflicto', 'Otra pestaña modificó este registro. Recarga la página.');
}
