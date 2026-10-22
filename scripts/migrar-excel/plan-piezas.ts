import { createHash } from 'node:crypto';
import { uuidDeterminista } from './ids';
import {
  categoriaDeDescripcion,
  centavosDeCelda,
  clasificarEstatus,
  codigoDeCelda,
  codigoHistorico,
  fechaDeCelda,
  llaveNombre,
  proveedorCanonico,
  separarPrefijo,
  similitud,
} from './normalizar';
import { crearOrigen } from './origen';
import type {
  Celda,
  CatalogoPlan,
  ClaseEstatus,
  Contexto,
  EstadoPiezaPlan,
  ExhibidorPlan,
  FilaConcentrado,
  Libro,
  Mapeo,
  PiezaPlan,
} from './tipos';

export interface CatalogosPiezasPlan {
  categorias: CatalogoPlan[];
  materiales: CatalogoPlan[];
  proveedores: CatalogoPlan[];
  exhibidores: ExhibidorPlan[];
  piezas: PiezaPlan[];
  /** Fila del Concentrado → id de la pieza (la del inventario o la histórica `H-…`). */
  vinculo: Map<number, string>;
  /** Fila del inventario → id de la pieza. */
  piezaPorFilaInv: Map<number, string>;
}

export const NOTA_MIGRACION = 'Migración Excel (fase 1)';
export const NOMBRE_CONCILIAR = 'Histórico por conciliar';
const CLASES_VENTA: ReadonlySet<ClaseEstatus> = new Set(['vendido', 'por_cobrar', 'no_cobrado', 'regalo']);
export const esClaseVenta = (c: ClaseEstatus | null): boolean => c !== null && CLASES_VENTA.has(c);

const limpiar = (t: string) => t.replace(/\s+/g, ' ').trim();
const texto = (c: Celda): string | null => (typeof c === 'string' && c.trim() ? limpiar(c) : null);
const sha8 = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 8);

/** Cliente de una celda sin el prefijo `X - `: llave comparable, o null si no hay cliente. */
export function llaveClienteSimple(c: Celda): string | null {
  if (typeof c !== 'string') return null;
  const k = llaveNombre(separarPrefijo(c, new Map()).nombre);
  return k || null;
}

export function planCatalogosYPiezas(l: Libro, m: Mapeo, ctx: Contexto): CatalogosPiezasPlan {
  const lote = m.lote;
  const id = (clave: string) => uuidDeterminista(lote, clave);

  // --- Vendedores del mapeo (solo ids y alias; el plan de vendedores lo arma planPersonas)
  const aliasVendedor = new Map<string, string>();
  for (const v of m.vendedores) {
    const vid = id(`vend:${llaveNombre(v.nombre)}`);
    for (const a of [v.nombre, ...v.alias])
      if (!aliasVendedor.has(llaveNombre(a))) aliasVendedor.set(llaveNombre(a), vid);
  }

  // --- Catálogos
  const catalogos = {
    cat: new Map<string, CatalogoPlan>(),
    mat: new Map<string, CatalogoPlan>(),
    prov: new Map<string, CatalogoPlan>(),
  };
  function catalogo(tipo: 'cat' | 'mat' | 'prov', nombre: string, hoja: string, fila: number): string {
    const limpio = limpiar(nombre).slice(0, 80);
    const llave = llaveNombre(limpio);
    const mapa = catalogos[tipo];
    let c = mapa.get(llave);
    if (!c) {
      c = {
        id: id(`${tipo}:${llave}`),
        nombre: limpio,
        llave,
        origen: crearOrigen(`${tipo}:${llave}`, hoja, [fila], { nombre: limpio }),
      };
      mapa.set(llave, c);
    }
    return c.id;
  }

  // --- Exhibidores (se crean al usarlos)
  const exhPorTexto = new Map(m.exhibidores.map((e) => [llaveNombre(e.texto), e]));
  const exhibidores = new Map<string, ExhibidorPlan>();
  function vendedorDe(nombre: string): string {
    const v = aliasVendedor.get(llaveNombre(nombre));
    if (!v) throw new RangeError('El mapeo de exhibidores nombra un vendedor que no está en el mapeo.');
    return v;
  }
  for (const e of m.exhibidores) vendedorDe(e.vendedor);
  function exhibidorDe(e: Mapeo['exhibidores'][number]): ExhibidorPlan {
    const clave = `exh:${llaveNombre(e.texto)}`;
    let x = exhibidores.get(clave);
    if (!x) {
      x = {
        id: id(clave),
        vendedorId: vendedorDe(e.vendedor),
        nombre: e.nombre.trim(),
        fechaEnvio: e.fechaEnvio,
        origen: crearOrigen(clave, 'mapeo', [], e),
      };
      exhibidores.set(clave, x);
    }
    return x;
  }
  function exhibidorConciliar(e: Mapeo['exhibidores'][number]): ExhibidorPlan {
    const vendedorId = vendedorDe(e.vendedor);
    const clave = `exh:conciliar:${vendedorId}`;
    let x = exhibidores.get(clave);
    if (!x) {
      x = {
        id: id(clave),
        vendedorId,
        nombre: NOMBRE_CONCILIAR,
        fechaEnvio: e.fechaEnvio,
        origen: crearOrigen(clave, 'mapeo', [], { vendedor: e.vendedor, nombre: NOMBRE_CONCILIAR }),
      };
      exhibidores.set(clave, x);
    } else if (e.fechaEnvio < x.fechaEnvio) x.fechaEnvio = e.fechaEnvio;
    return x;
  }

  // --- Hojas de exhibidor: códigos por vendedor (respaldo) y por hoja (verificación)
  const respaldo = new Map<string, Set<string>>(); // vendedorId → códigos
  for (const [hoja, filas] of Object.entries(l.hojasExhibidor)) {
    const v = aliasVendedor.get(llaveNombre(hoja));
    if (!v) continue;
    const set = respaldo.get(v) ?? new Set<string>();
    for (const f of filas) {
      const c = codigoDeCelda(f.id);
      if (c) set.add(c);
    }
    respaldo.set(v, set);
  }

  const piezas: PiezaPlan[] = [];
  const vinculo = new Map<number, string>();
  const piezaPorFilaInv = new Map<number, string>();
  const rechazar = (hoja: string, fila: number, motivo: string) =>
    ctx.rechazos.push({ hoja, fila, clave: null, motivo });
  const avisar = (hoja: string, fila: number, tipo: string, detalle: string, clave: string | null = null) =>
    ctx.avisos.push({ hoja, fila, clave, tipo, detalle });

  // --- Concentrado: filas aceptadas y fecha de compra "vigente" de cada fila (la de la fila anterior si falta)
  const compraDe = new Map<number, string | null>();
  const compraPrevia = new Map<number, string | null>();
  let ultima: string | null = null;
  for (const f of l.concentrado) {
    const d = fechaDeCelda(f.fechaCompra, m.fechaCorte);
    compraDe.set(f.fila, d);
    if (d) ultima = d;
    compraPrevia.set(f.fila, ultima);
  }
  interface Aceptada {
    f: FilaConcentrado;
    codigo: string | null;
    clase: ClaseEstatus;
  }
  const aceptadas: Aceptada[] = [];
  for (const f of l.concentrado) {
    if (ctx.filasRechazadas.has(f.fila)) continue;
    const clase = clasificarEstatus(f.estatus, m);
    if (clase === null) {
      rechazar('Concentrado', f.fila, f.estatus == null ? 'estatus vacío' : 'estatus sin clasificar');
      continue;
    }
    if (clase === 'ignorar') {
      rechazar('Concentrado', f.fila, 'estatus ignorado');
      continue;
    }
    aceptadas.push({ f, codigo: codigoDeCelda(f.id), clase });
  }
  const porCodigo = new Map<string, Aceptada[]>();
  for (const a of aceptadas)
    if (a.codigo) {
      const lista = porCodigo.get(a.codigo) ?? [];
      lista.push(a);
      porCodigo.set(a.codigo, lista);
    }

  // --- Piezas del inventario
  interface Inv {
    pieza: PiezaPlan;
    producto: string | null;
    precioInv: number | null;
    clienteLlave: string | null;
  }
  const inventario = new Map<string, Inv>();
  for (const f of l.inventario) {
    const codigo = codigoDeCelda(f.id);
    if (!codigo) {
      rechazar('INVENTARIO', f.fila, 'código de inventario inválido');
      continue;
    }
    if (ctx.usados.has(codigo)) {
      rechazar('INVENTARIO', f.fila, 'código de inventario repetido');
      continue;
    }
    const ubic = texto(f.ubicacion);
    const llaveUbic = ubic ? llaveNombre(ubic) : '';
    let estado: EstadoPiezaPlan;
    let exhibidor: ExhibidorPlan | null = null;
    const fija = m.ubicaciones[llaveUbic];
    if (fija) estado = fija;
    else {
      const e = exhPorTexto.get(llaveUbic);
      if (!e) {
        rechazar('INVENTARIO', f.fila, ubic ? 'ubicación sin exhibidor' : 'ubicación vacía');
        continue;
      }
      estado = 'en_exhibidor';
      exhibidor = exhibidorDe(e);
    }
    ctx.usados.add(codigo);
    const clave = `inv:${codigo}`;
    const categoria = texto(f.categoria);
    if (!categoria) avisar('INVENTARIO', f.fila, 'categoria_vacia', 'Pieza sin categoría.', clave);
    const material = texto(f.material);
    const prov = proveedorCanonico(f.proveedor, m);
    if (prov.aviso) avisar('INVENTARIO', f.fila, 'proveedor_descartado', prov.aviso, clave);
    let descripcion = texto(f.producto);
    if (!descripcion) {
      descripcion = 'Pieza sin descripción';
      avisar('INVENTARIO', f.fila, 'descripcion_vacia', 'Pieza sin descripción.', clave);
    } else if (descripcion.length > 300) {
      descripcion = descripcion.slice(0, 300);
      avisar('INVENTARIO', f.fila, 'descripcion_recortada', 'Descripción de más de 300 caracteres.', clave);
    }
    const costoC = centavosDeCelda(f.costo);
    if (costoC === null)
      avisar('INVENTARIO', f.fila, 'costo_invalido', 'Costo vacío o inválido; se importa en 0.', clave);
    const precioInv = centavosDeCelda(f.precio);
    if (precioInv === null) {
      avisar(
        'INVENTARIO',
        f.fila,
        'inventario_sin_precio',
        'Sin precio de venta: queda guardada con precio 0.',
        clave,
      );
      estado = 'guardada';
      exhibidor = null;
    } else if ((costoC ?? 0) > precioInv)
      avisar('INVENTARIO', f.fila, 'costo_mayor_que_precio', 'El costo supera el precio de venta.', clave);
    const pieza: PiezaPlan = {
      id: id(clave),
      codigo,
      categoriaId: catalogo('cat', categoria ?? m.categoriaSinDato, 'INVENTARIO', f.fila),
      materialId: material ? catalogo('mat', material, 'INVENTARIO', f.fila) : null,
      proveedorId: prov.nombre ? catalogo('prov', prov.nombre, 'INVENTARIO', f.fila) : null,
      descripcion,
      costo: costoC ?? 0,
      precio: precioInv ?? 0,
      fechaAlta: '',
      estado,
      exhibidorId: exhibidor?.id ?? null,
      pedidoId: null,
      fechaMovimiento: '',
      notaMovimiento: NOTA_MIGRACION,
      origen: crearOrigen(clave, 'INVENTARIO', [f.fila], f),
    };
    piezas.push(pieza);
    piezaPorFilaInv.set(f.fila, pieza.id);
    inventario.set(codigo, {
      pieza,
      producto: texto(f.producto),
      precioInv,
      clienteLlave: llaveClienteSimple(f.cliente),
    });
  }

  // --- Vínculo inventario ↔ Concentrado (M-20): solo la última aparición y solo si se parece
  const enlazadas = new Set<number>();
  const altaInv = new Map<string, { fecha: string | null; inferida: boolean }>(); // pieza id → alta por la fila ligada
  for (const [codigo, inv] of inventario) {
    const ultima = porCodigo.get(codigo)?.at(-1);
    if (!ultima) continue;
    const f = ultima.f;
    const venta = centavosDeCelda(f.venta);
    const parecida =
      (inv.producto !== null &&
        typeof f.descripcion === 'string' &&
        similitud(inv.producto, f.descripcion) >= 0.5) ||
      (inv.clienteLlave !== null && inv.clienteLlave === llaveClienteSimple(f.cliente)) ||
      (venta !== null && inv.precioInv !== null && venta === inv.precioInv);
    if (!parecida) continue;
    enlazadas.add(f.fila);
    vinculo.set(f.fila, inv.pieza.id);
    const propia = compraDe.get(f.fila) ?? null;
    altaInv.set(inv.pieza.id, {
      fecha: propia ?? compraPrevia.get(f.fila) ?? null,
      inferida: propia === null,
    });
    // El Tracking manda en lo que no es ubicación: rifa, regalo sin cliente, defecto o guardado.
    const sinCliente = llaveClienteSimple(f.cliente) === null;
    if (ultima.clase === 'rifa' || (ultima.clase === 'regalo' && sinCliente)) inv.pieza.estado = 'regalo';
    else if (ultima.clase === 'defecto') inv.pieza.estado = 'defecto';
    else if (ultima.clase === 'guardado') inv.pieza.estado = 'guardada';
    if (['regalo', 'defecto', 'guardada'].includes(inv.pieza.estado)) inv.pieza.exhibidorId = null;
  }
  for (const inv of inventario.values()) {
    const p = inv.pieza;
    const d = altaInv.get(p.id);
    if (d?.fecha) {
      p.fechaAlta = d.fecha;
      if (d.inferida)
        avisar(
          'INVENTARIO',
          p.origen.filas[0]!,
          'fecha_alta_inferida',
          'Sin fecha de compra: se usa la de la fila anterior del Concentrado.',
          p.origen.clave,
        );
    } else {
      p.fechaAlta = m.fechaCorte;
      avisar(
        'INVENTARIO',
        p.origen.filas[0]!,
        'alta_sin_fecha',
        'Sin fecha de compra: alta = fecha de corte.',
        p.origen.clave,
      );
    }
  }

  // --- Piezas históricas (filas del Concentrado que no son la pieza del inventario)
  const apariciones = new Map<string, number>();
  for (const a of aceptadas) {
    const f = a.f;
    if (enlazadas.has(f.fila)) continue;
    const hayCliente = llaveClienteSimple(f.cliente) !== null;
    // Estado según el estatus; el exhibidor se decide antes de crear nada para poder rechazar la fila.
    let estado: EstadoPiezaPlan;
    let exhibidor: ExhibidorPlan | null = null;
    let nota = NOTA_MIGRACION;
    switch (a.clase) {
      case 'vendido':
      case 'no_cobrado':
        estado = 'vendida';
        break;
      case 'por_cobrar':
        estado = 'apartada';
        break;
      case 'regalo':
        estado = hayCliente ? 'vendida' : 'regalo';
        break;
      case 'rifa':
        estado = 'regalo';
        nota = `${NOTA_MIGRACION}: rifa`;
        break;
      case 'defecto':
        estado = 'defecto';
        break;
      case 'guardado':
      case 'disponible':
        estado = 'guardada';
        break;
      case 'exhibidor': {
        const e = exhPorTexto.get(llaveNombre(String(f.estatus)));
        if (!e) {
          rechazar('Concentrado', f.fila, 'exhibidor sin mapeo');
          continue;
        }
        estado = 'en_exhibidor';
        exhibidor =
          a.codigo && respaldo.get(vendedorDe(e.vendedor))?.has(a.codigo)
            ? exhibidorDe(e)
            : exhibidorConciliar(e);
        break;
      }
      default:
        continue;
    }
    const descripcionCelda = texto(f.descripcion);
    const precio = centavosDeCelda(f.venta);
    // Sin código usable la clave sale de la huella de la fila; `#n` es su n-ésima repetición.
    const base = a.codigo
      ? `conc:${a.codigo}`
      : `conc:sinid:${sha8(`${descripcionCelda ?? ''}|${compraDe.get(f.fila) ?? ''}|${precio ?? ''}`)}`;
    const n = (apariciones.get(base) ?? 0) + 1;
    apariciones.set(base, n);
    const clave = `${base}#${n}`;
    const codigo = codigoHistorico(a.codigo, f.fila, ctx.usados);
    if (a.clase === 'disponible')
      avisar(
        'Concentrado',
        f.fila,
        'disponible_solo_concentrado',
        'Disponible solo en el Concentrado: queda guardada.',
        clave,
      );
    let descripcion = descripcionCelda;
    if (!descripcion) {
      descripcion = 'Pieza histórica sin descripción';
      avisar('Concentrado', f.fila, 'descripcion_vacia', 'Pieza sin descripción.', clave);
    } else if (descripcion.length > 300) {
      descripcion = descripcion.slice(0, 300);
      avisar('Concentrado', f.fila, 'descripcion_recortada', 'Descripción de más de 300 caracteres.', clave);
    }
    const costo = centavosDeCelda(f.costo);
    if (costo === null)
      avisar('Concentrado', f.fila, 'costo_invalido', 'Costo vacío o inválido; se importa en 0.', clave);
    if (precio === null)
      avisar('Concentrado', f.fila, 'precio_vacio', 'Sin precio de venta; se importa en 0.', clave);
    if (!a.codigo)
      avisar(
        'Concentrado',
        f.fila,
        'sin_codigo',
        'Fila sin código usable: código histórico por fila.',
        clave,
      );
    const prov = proveedorCanonico(f.proveedor, m);
    if (prov.aviso) avisar('Concentrado', f.fila, 'proveedor_descartado', prov.aviso, clave);
    let fechaAlta = compraDe.get(f.fila) ?? null;
    if (!fechaAlta) {
      fechaAlta = compraPrevia.get(f.fila) ?? m.fechaCorte;
      avisar(
        'Concentrado',
        f.fila,
        'fecha_alta_inferida',
        'Sin fecha de compra: se usa la de la fila anterior (o el corte).',
        clave,
      );
    }
    piezas.push({
      id: id(clave),
      codigo,
      categoriaId: catalogo('cat', categoriaDeDescripcion(descripcionCelda ?? '', m), 'Concentrado', f.fila),
      materialId: null,
      proveedorId: prov.nombre ? catalogo('prov', prov.nombre, 'Concentrado', f.fila) : null,
      descripcion,
      costo: costo ?? 0,
      precio: precio ?? 0,
      fechaAlta,
      estado,
      exhibidorId: exhibidor?.id ?? null,
      pedidoId: null,
      fechaMovimiento: '',
      notaMovimiento: nota,
      origen: crearOrigen(clave, 'Concentrado', [f.fila], f),
    });
    vinculo.set(f.fila, piezas.at(-1)!.id);
  }

  // --- Fecha del movimiento: nunca antes del alta ni del envío al exhibidor
  const envio = new Map([...exhibidores.values()].map((e) => [e.id, e.fechaEnvio]));
  for (const p of piezas) {
    const e = p.exhibidorId ? envio.get(p.exhibidorId) : undefined;
    p.fechaMovimiento = e && e > p.fechaAlta ? e : p.fechaAlta;
  }

  // --- Hojas de exhibidor: solo verifican (M-27)
  const porCodigoPieza = new Map<string, PiezaPlan[]>();
  const ids = new Map<string, string>(); // pieza id → código original
  for (const [codigo, inv] of inventario) ids.set(inv.pieza.id, codigo);
  for (const a of aceptadas) {
    const pid = vinculo.get(a.f.fila);
    if (pid && a.codigo) ids.set(pid, a.codigo);
  }
  for (const p of piezas) {
    const orig = ids.get(p.id);
    if (!orig) continue;
    const lista = porCodigoPieza.get(orig) ?? [];
    lista.push(p);
    porCodigoPieza.set(orig, lista);
  }
  for (const [hoja, filas] of Object.entries(l.hojasExhibidor))
    for (const f of filas) {
      const c = codigoDeCelda(f.id);
      const ps = c ? (porCodigoPieza.get(c) ?? []) : [];
      const ok = ps.some((p) => ['en_exhibidor', 'apartada', 'vendida', 'regalo'].includes(p.estado));
      if (!ok)
        avisar(
          `Hoja ${hoja}`,
          f.fila,
          'hoja_exhibidor_no_cuadra',
          c
            ? ps.length
              ? 'El código de la hoja no está en un exhibidor ni vendido.'
              : 'El código de la hoja no existe en los libros.'
            : 'Código inválido en la hoja de exhibidor.',
          c,
        );
    }

  return {
    categorias: [...catalogos.cat.values()],
    materiales: [...catalogos.mat.values()],
    proveedores: [...catalogos.prov.values()],
    exhibidores: [...exhibidores.values()],
    piezas,
    vinculo,
    piezaPorFilaInv,
  };
}
