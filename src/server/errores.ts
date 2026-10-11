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
  pieza_montos: 'El costo y el precio no pueden ser negativos.',
  pieza_cambio_exhibidor: 'La pieza debe regresar antes de cambiar de exhibidor.',
  exhibidor_cierre_coherente: 'El estado de cierre del exhibidor es inconsistente.',
  pieza_exhibidor_solo_si_aplica: 'Solo una pieza en exhibidor o apartada puede tener exhibidor.',
  pieza_foto_path_largo: 'La ruta de la foto es demasiado larga.',
  cliente_referencia_largo: 'La referencia admite hasta 120 caracteres.',
  cliente_telefono_largo: 'El teléfono admite hasta 30 caracteres.',
  cliente_red_social_largo: 'La red social admite hasta 40 caracteres.',
  cliente_usuario_red_largo: 'El usuario admite hasta 80 caracteres.',
  cliente_notas_largo: 'Las notas admiten hasta 2000 caracteres.',
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
