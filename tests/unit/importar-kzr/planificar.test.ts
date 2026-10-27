import { describe, expect, it } from 'vitest';
import { claveNota, planificar, renderizarReporte } from '../../../scripts/importar-kzr/planificar';
import { hashFuente, agruparNotas } from '../../../scripts/importar-kzr/parsear';
import { LOTE_KZR, type FilaExcel, type NotaNueva, type Snapshot } from '../../../scripts/importar-kzr/tipos';

const HOY = '2026-10-26';
const C1 = '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const C2 = '22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const V1 = 'aaaaaaaa-1111-4111-8111-111111111111';
const V2 = 'bbbbbbbb-1111-4111-8111-111111111111';

const pz = (codigo: string, extra: Partial<Snapshot['piezas'][number]> = {}): Snapshot['piezas'][number] => ({
  id: `p-${codigo}`,
  codigo,
  descripcion: `Collar ${codigo}`,
  estado: 'disponible',
  exhibidorId: null,
  vendedorCustodiaId: null,
  precio: '100.00',
  precioCentavos: 10000,
  ...extra,
});
const snap = (extra: Partial<Snapshot> = {}): Snapshot => ({
  clientes: [
    { id: C1, nombre: 'Clienta Uno' },
    { id: C2, nombre: 'Clienta Dos' },
  ],
  vendedores: [
    { id: V1, nombre: 'Vend A', activo: true },
    { id: V2, nombre: 'Vend B', activo: false },
  ],
  piezas: [pz('ZZ01'), pz('ZZ02'), pz('ZZ03')],
  pedidosPorFolio: [],
  origenes: [],
  tarjetas: [],
  maxFolio: 0,
  folioSecuencia: 0,
  ...extra,
});
const f = (n: number, extra: Partial<FilaExcel> = {}): FilaExcel => ({
  fila: n,
  nota: 'KZR-8',
  id: 'ZZ01',
  descripcion: 'Collar ZZ01',
  tarjeta: '1 16/09/2026',
  cliente: 'clienta  UNO',
  vendedor: 'Vend A - Clienta Uno',
  estatus: 'Por cobrar',
  ...extra,
});
const errores = (filas: FilaExcel[], s = snap()) => planificar(filas, s, HOY).errores.map((e) => e.codigo);

describe('planificar: camino feliz', () => {
  it('resuelve cliente (sin importar mayúsculas/espacios), vendedora, precio de la BD y lugar 1 de la vuelta 1', () => {
    const p = planificar([f(2), f(3, { id: 'zz02' })], snap(), HOY);
    expect(p.errores).toEqual([]);
    const n = p.notas[0] as NotaNueva;
    expect(n).toMatchObject({
      estado: 'nueva',
      folio: 8,
      fecha: '2026-09-16',
      clienteId: C1,
      vendedorId: V1,
      ciclo: 1,
      posicion: 1,
      pctBps: 0,
      subtotal: 20000,
      total: 20000,
    });
    expect(n.items.map((i) => i.codigo)).toEqual(['ZZ01', 'ZZ02']);
    expect(p.siguienteFolio).toBe(9);
  });
  it('lugar 5 → 10 % y lugar 10 → 20 % (regla del dominio), repartido por línea', () => {
    const p5 = planificar([f(2, { tarjeta: '5 16/09/2026' })], snap(), HOY).notas[0] as NotaNueva;
    expect(p5).toMatchObject({ posicion: 5, pctBps: 1000, descuentoLealtad: 1000, total: 9000 });
    const p10 = planificar([f(2, { tarjeta: '10 16/09/2026' })], snap(), HOY).notas[0] as NotaNueva;
    expect(p10).toMatchObject({ posicion: 10, pctBps: 2000, total: 8000 });
  });
  it('usa la tarjeta actual del cliente: la vuelta más alta; los huecos de vueltas anteriores no cuentan', () => {
    const s = snap({
      tarjetas: [
        { clienteId: C1, ciclo: 1, posicion: 3 },
        { clienteId: C1, ciclo: 2, posicion: 1 },
      ],
    });
    expect(planificar([f(2, { tarjeta: '3 16/09/2026' })], s, HOY).notas[0]).toMatchObject({
      ciclo: 2,
      posicion: 3,
    });
  });
  it('el siguiente folio respeta el mayor existente y la secuencia (nunca la baja)', () => {
    expect(planificar([f(2)], snap({ maxFolio: 50 }), HOY).siguienteFolio).toBe(51);
    expect(planificar([f(2)], snap({ folioSecuencia: 70 }), HOY).siguienteFolio).toBe(71);
  });
  it('el hash cambia si cambia un precio de la BD y es estable si no', () => {
    const a = planificar([f(2)], snap(), HOY).hash;
    expect(planificar([f(2)], snap(), HOY).hash).toBe(a);
    const caro = snap({ piezas: [pz('ZZ01', { precioCentavos: 12000, precio: '120.00' })] });
    expect(planificar([f(2)], caro, HOY).hash).not.toBe(a);
  });
  it('el reporte no vuelca nombres ni descripciones; lleva ids cortos, iniciales, conteos y hash', () => {
    const p = planificar([f(2)], snap(), HOY);
    const texto = renderizarReporte(p).join('\n');
    expect(texto).toContain('KZR-8');
    expect(texto).toContain('11111111 (C. U.)');
    expect(texto).toContain(p.hash);
    expect(texto).not.toMatch(/Clienta Uno|Vend A|Collar/);
  });
});

describe('planificar: errores', () => {
  it('pieza que no existe', () => {
    expect(errores([f(2, { id: 'NOEXISTE' })])).toEqual(['pieza_faltante']);
  });
  it('pieza no disponible (apartada, vendida…)', () => {
    expect(errores([f(2)], snap({ piezas: [pz('ZZ01', { estado: 'apartada' })] }))).toEqual([
      'pieza_no_disponible',
    ]);
  });
  it('pieza en poder de otra vendedora; de la misma vendedora sí se puede', () => {
    expect(errores([f(2)], snap({ piezas: [pz('ZZ01', { vendedorCustodiaId: 'otra' })] }))).toEqual([
      'pieza_de_otra_vendedora',
    ]);
    expect(errores([f(2)], snap({ piezas: [pz('ZZ01', { vendedorCustodiaId: V1 })] }))).toEqual([]);
  });
  it('la misma pieza en dos notas o dos veces en una', () => {
    expect(errores([f(2), f(3, { nota: 'KZR-9', cliente: 'Clienta Dos', tarjeta: '1 17/09/2026' })])).toEqual(
      ['pieza_repetida'],
    );
    expect(errores([f(2), f(3)])).toEqual(['pieza_repetida']);
  });
  it('lugar ocupado en la tarjeta actual (de la BD o de otra nota del mismo Excel)', () => {
    const ocupado = snap({ tarjetas: [{ clienteId: C1, ciclo: 1, posicion: 1 }] });
    expect(errores([f(2)], ocupado)).toEqual(['lugar_ocupado']);
    expect(errores([f(2), f(3, { nota: 'KZR-9', id: 'ZZ02' })])).toEqual(['lugar_ocupado']);
  });
  it('folio que ya existe como pedido; contenido cambiado tras importarse; clave de otro lote', () => {
    expect(errores([f(2)], snap({ pedidosPorFolio: [{ folio: 8, id: 'x' }] }))).toEqual(['folio_existente']);
    const hash = hashFuente(agruparNotas([f(2)]).notas[0]!);
    const origen = (extra = {}) => ({
      lote: LOTE_KZR,
      clave: claveNota(8),
      hash,
      pedidoId: 'ped-1',
      ...extra,
    });
    expect(errores([f(2, { id: 'ZZ02' })], snap({ origenes: [origen()] }))).toEqual(['origen_cambiado']);
    expect(errores([f(2)], snap({ origenes: [origen({ lote: 'otro' })] }))).toEqual(['folio_existente']);
  });
  it('estatus no soportado lista el valor; «Por cobrar» sí', () => {
    const p = planificar([f(2, { estatus: 'Pagado' })], snap(), HOY);
    expect(p.errores.map((e) => e.codigo)).toEqual(['estatus_no_soportado']);
    expect(p.errores[0]!.mensaje).toContain('Pagado');
    expect(errores([f(2, { estatus: 'POR  COBRAR' })])).toEqual([]);
  });
  it('tarjeta con otro formato, o fecha futura', () => {
    expect(errores([f(2, { tarjeta: '1.N' })])).toEqual(['tarjeta_formato_no_soportado']);
    expect(errores([f(2, { tarjeta: '1 27/10/2026' })])).toEqual(['tarjeta_fecha_futura']);
  });
  it('cliente que no existe, repetido por nombre; vendedora que no existe, inactiva', () => {
    expect(errores([f(2, { cliente: 'Nadie' })])).toEqual(['cliente_no_encontrado']);
    const dos = snap({ clientes: [...snap().clientes, { id: 'c3', nombre: 'CLIENTA UNO' }] });
    expect(errores([f(2)], dos)).toEqual(['cliente_ambiguo']);
    expect(errores([f(2, { vendedor: 'Nadie - X' })])).toEqual(['vendedor_no_encontrado']);
    expect(errores([f(2, { vendedor: 'Vend B' })])).toEqual(['vendedor_inactivo']);
  });
  it('total 0 (piezas de precio 0) no se soporta', () => {
    expect(errores([f(2)], snap({ piezas: [pz('ZZ01', { precio: '0.00', precioCentavos: 0 })] }))).toEqual([
      'total_cero',
    ]);
  });
  it('los errores no llevan nombres de personas', () => {
    const p = planificar([f(2, { cliente: 'Persona Real', vendedor: 'Vendedora Real - Otra' })], snap(), HOY);
    expect(JSON.stringify(p.errores)).not.toMatch(/Persona Real|Vendedora Real|Otra/);
  });
});

describe('planificar: idempotencia y avisos', () => {
  it('una nota ya importada con el mismo contenido queda «ya_aplicada» sin validar la BD de nuevo', () => {
    const hash = hashFuente(agruparNotas([f(2)]).notas[0]!);
    const s = snap({
      origenes: [{ lote: LOTE_KZR, clave: claveNota(8), hash, pedidoId: 'ped-1' }],
      pedidosPorFolio: [{ folio: 8, id: 'ped-1' }],
      piezas: [pz('ZZ01', { estado: 'apartada' })],
      tarjetas: [{ clienteId: C1, ciclo: 1, posicion: 1 }],
      maxFolio: 8,
    });
    const p = planificar([f(2)], s, HOY);
    expect(p.errores).toEqual([]);
    expect(p.notas).toEqual([
      expect.objectContaining({ estado: 'ya_aplicada', folio: 8, pedidoId: 'ped-1' }),
    ]);
    expect(p.siguienteFolio).toBe(9);
  });
  it('descripción muy distinta → aviso, no error', () => {
    const p = planificar([f(2, { descripcion: 'Pulsera acero inoxidable' })], snap(), HOY);
    expect(p.errores).toEqual([]);
    expect(p.avisos.map((a) => a.codigo)).toEqual(['descripcion_distinta']);
  });
});

describe('planificar: vueltas de la tarjeta (reunión 2026-10-23, punto 3)', () => {
  const piezasMuchas = (n: number) => Array.from({ length: n }, (_, i) => pz(`T${i + 1}`));
  const nota = (folio: number, lugar: number, dia: number, id: string) =>
    f(folio, {
      nota: `KZR-${folio}`,
      id,
      tarjeta: `${lugar} ${String(dia).padStart(2, '0')}/09/2026`,
    });
  const lugares = (p: ReturnType<typeof planificar>) =>
    p.notas.map((n) => (n as NotaNueva).ciclo + ':' + (n as NotaNueva).posicion);

  it('tarjeta llena en la BD → la nota abre la vuelta siguiente (en el lugar del Excel)', () => {
    const llena = Array.from({ length: 10 }, (_, i) => ({ clienteId: C1, ciclo: 1, posicion: i + 1 }));
    const p = planificar([f(2)], snap({ tarjetas: llena }), HOY);
    expect(p.errores).toEqual([]);
    expect(lugares(p)).toEqual(['2:1']);
  });
  it('notas del Excel 9, 10, 1, 2 (por fecha) cruzan a una vuelta nueva', () => {
    const filas = [nota(1, 9, 1, 'T1'), nota(2, 10, 2, 'T2'), nota(3, 1, 3, 'T3'), nota(4, 2, 4, 'T4')];
    const p = planificar(filas, snap({ piezas: piezasMuchas(4) }), HOY);
    expect(p.errores).toEqual([]);
    expect(lugares(p)).toEqual(['1:9', '1:10', '2:1', '2:2']);
  });
  it('se ordena por fecha y luego folio, no por el orden del Excel', () => {
    const filas = [nota(4, 2, 4, 'T4'), nota(3, 1, 3, 'T3'), nota(2, 10, 2, 'T2'), nota(1, 9, 1, 'T1')];
    const p = planificar(filas, snap({ piezas: piezasMuchas(4) }), HOY);
    expect(lugares(p)).toEqual(['1:9', '1:10', '2:1', '2:2']);
  });
  it('lugar repetido en una vuelta que no ha llegado al 10 → lugar_ocupado', () => {
    const p = planificar([nota(1, 3, 1, 'T1'), nota(2, 3, 2, 'T2')], snap({ piezas: piezasMuchas(2) }), HOY);
    expect(p.errores.map((e) => e.codigo)).toEqual(['lugar_ocupado']);
    expect(p.errores[0]!.folio).toBe(2);
  });
});

describe('planificar: tope de piezas y piezas en exhibidor', () => {
  it('más de MAX_PIEZAS_PEDIDO piezas en una nota → error con el mensaje de la app', () => {
    const codigos = Array.from({ length: 101 }, (_, i) => `T${i + 1}`);
    const p = planificar(
      codigos.map((id, i) => f(i + 2, { id })),
      snap({ piezas: codigos.map((c) => pz(c)) }),
      HOY,
    );
    expect(p.errores.map((e) => e.codigo)).toEqual(['demasiadas_piezas']);
    expect(p.errores[0]!.mensaje).toBe('Máximo 100 piezas por pedido.');
  });
  it('una pieza en_exhibidor se acepta como en crearPedido; apartada o vendida no', () => {
    expect(
      errores([f(2)], snap({ piezas: [pz('ZZ01', { estado: 'en_exhibidor', exhibidorId: 'ex-1' })] })),
    ).toEqual([]);
    expect(errores([f(2)], snap({ piezas: [pz('ZZ01', { estado: 'vendida' })] }))).toEqual([
      'pieza_no_disponible',
    ]);
  });
});
