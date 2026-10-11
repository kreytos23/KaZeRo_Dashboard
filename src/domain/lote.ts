import { esCodigoValido, normalizarCodigo } from './codigos';
import { pesosACentavos } from './dinero';
import { normalizar } from './texto';

export const MAX_FILAS_LOTE = 500;

export interface FilaLote {
  linea: number;
  codigo: string;
  categoria: string;
  descripcion: string;
  material: string | null;
  proveedor: string | null;
  costoCentavos: number;
  precioCentavos: number;
}
export interface ErrorLote {
  linea: number;
  mensaje: string;
}

const COLUMNAS = 'Se esperan 7 columnas: código, categoría, descripción, material, proveedor, costo, precio.';

/** Columnas en el orden del Excel del cliente: ID, Categoría, Producto, Material, Proveedor, Costo, P. Venta. */
export function parsearLote(texto: string): { filas: FilaLote[]; errores: ErrorLote[] } {
  const filas: FilaLote[] = [];
  const errores: ErrorLote[] = [];
  const vistos = new Map<string, number>();
  let primera = true;

  texto
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((cruda, i) => {
      const linea = i + 1;
      if (!cruda.trim()) return;
      const celdas = cruda.split('\t').map((c) => c.trim());
      const esEncabezado = primera && ['codigo', 'id'].includes(normalizar(celdas[0] ?? ''));
      primera = false;
      if (esEncabezado) return;
      if (celdas.length < 7) return void errores.push({ linea, mensaje: COLUMNAS });

      const [crudo, categoria, descripcion, material, proveedor, costo, precio] = celdas as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      const codigo = normalizarCodigo(crudo);
      if (!esCodigoValido(codigo))
        return void errores.push({ linea, mensaje: `Código inválido: ${crudo || '(vacío)'}.` });
      const previa = vistos.get(codigo);
      if (previa)
        return void errores.push({
          linea,
          mensaje: `Código ${codigo} repetido en el lote (también en la línea ${previa}).`,
        });
      if (!categoria) return void errores.push({ linea, mensaje: 'Falta la categoría.' });
      if (categoria.length > 80)
        return void errores.push({ linea, mensaje: 'La categoría admite hasta 80 caracteres.' });
      if (material.length > 80)
        return void errores.push({ linea, mensaje: 'El material admite hasta 80 caracteres.' });
      if (proveedor.length > 80)
        return void errores.push({ linea, mensaje: 'El proveedor admite hasta 80 caracteres.' });
      if (!descripcion || descripcion.length > 300)
        return void errores.push({ linea, mensaje: 'La descripción debe tener entre 1 y 300 caracteres.' });
      const costoCentavos = costo ? pesosACentavos(costo) : 0;
      if (costoCentavos === null)
        return void errores.push({ linea, mensaje: 'El costo no es un monto válido.' });
      const precioCentavos = pesosACentavos(precio);
      if (precioCentavos === null)
        return void errores.push({ linea, mensaje: 'El precio no es un monto válido.' });

      vistos.set(codigo, linea);
      filas.push({
        linea,
        codigo,
        categoria,
        descripcion,
        material: material || null,
        proveedor: proveedor || null,
        costoCentavos,
        precioCentavos,
      });
    });

  if (filas.length > MAX_FILAS_LOTE)
    errores.push({ linea: 0, mensaje: `Máximo ${MAX_FILAS_LOTE} piezas por lote.` });
  return { filas, errores };
}
