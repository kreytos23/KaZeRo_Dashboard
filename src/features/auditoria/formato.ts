import type { Valor } from '@/domain/auditoria';
import { formatoMXN, numericACentavos, porcentajeLegible } from '@/domain/dinero';

/** Nombres de campo tal como los guarda kz_auditar (columna sin `_id` en las llaves foráneas). */
export const ETIQUETA_CAMPO: Readonly<Record<string, string>> = {
  descripcion: 'Descripción',
  categoria: 'Categoría',
  material: 'Material',
  proveedor: 'Proveedor',
  costo: 'Costo',
  precio: 'Precio',
  nombre: 'Nombre',
  tipo: 'Tipo',
  comision_pct: 'Comisión',
  activo: 'Activo',
  referencia: 'Referencia',
  telefono: 'Teléfono',
  cumpleanos: 'Cumpleaños',
  red_social: 'Red social',
  usuario_red: 'Usuario en la red',
  vendedor_habitual: 'Vendedor habitual',
  notas: 'Notas',
  fecha_envio: 'Fecha de envío',
};

const TIPO_VENDEDOR: Readonly<Record<string, string>> = {
  casa: 'Casa (Kazero)',
  revendedora: 'Revendedora',
  consignacion: 'Negocio a consignación',
};

/** Un valor histórico ilegible no debe romper la ficha: se muestra tal cual. */
function montoLegible(valor: string): string {
  try {
    return formatoMXN(numericACentavos(valor));
  } catch {
    return valor;
  }
}

/** Valores canónicos de la bitácora (to_jsonb ->> de Postgres) → texto para la ficha. */
export function formatearValor(campo: string, valor: Valor): string {
  if (valor === null || valor === '') return '—';
  switch (campo) {
    case 'costo':
    case 'precio':
      return montoLegible(valor);
    case 'comision_pct':
      return `${porcentajeLegible(valor)} %`;
    case 'activo':
      return valor === 'true' ? 'Sí' : 'No';
    case 'tipo':
      return TIPO_VENDEDOR[valor] ?? valor;
    default:
      return valor;
  }
}
