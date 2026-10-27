'use client';

import { CampoKey } from '@/features/pedidos/CampoKey';
import { Campo, CampoCasilla, Selector } from '@/features/ui/Campo';
import { EncabezadoAcciones } from '@/features/ui/MenuAcciones';
import { FormAccion } from '@/features/ui/FormAccion';
import { ETIQUETA_METODO } from '../../pedidos/etiquetas';
import { accionAnularPagoComision, accionCerrarMes, accionRegistrarPagoComision } from './acciones';

/** Dónde estaba la usuaria (mes y vendedora filtrada): la acción vuelve ahí con su aviso. */
function Vista({ mes, vendedor }: { mes: string; vendedor: string }) {
  return (
    <>
      <input type="hidden" name="mes" value={mes} />
      <input type="hidden" name="vendedor" value={vendedor} />
    </>
  );
}

const METODOS = Object.entries(ETIQUETA_METODO).map(([valor, texto]) => ({ valor, texto }));

/** Cerrar el mes en curso: congela los pedidos y montos. La casilla es obligatoria (y la acción la exige también). */
export function FormCerrarMes({
  mes,
  vendedor,
  nombre,
  numPedidos,
  totalTexto,
}: {
  mes: string;
  vendedor: string;
  nombre: string;
  numPedidos: number;
  totalTexto: string;
}) {
  return (
    <FormAccion
      accion={accionCerrarMes}
      textoBoton={`Cerrar ${nombre}`}
      className="flex max-w-xl flex-col gap-3"
    >
      <Vista mes={mes} vendedor={vendedor} />
      <CampoKey />
      <CampoCasilla name="confirmo" required>
        Confirmo cerrar {nombre}: se{' '}
        {numPedidos === 1 ? 'congela 1 pedido' : `congelan ${numPedidos} pedidos`} y {totalTexto} en
        comisiones
      </CampoCasilla>
    </FormAccion>
  );
}

/** Pago de una vendedora en un mes cerrado: el monto lo calcula el sistema (se muestra, no se teclea). */
export function FormRegistrarPagoComision({
  mes,
  vendedor,
  corteId,
  vendedorId,
  montoTexto,
  hoy,
}: {
  mes: string;
  vendedor: string;
  corteId: string;
  vendedorId: string;
  montoTexto: string;
  hoy: string;
}) {
  return (
    <FormAccion
      accion={accionRegistrarPagoComision}
      textoBoton="Registrar pago"
      className="flex max-w-xl flex-col gap-3"
    >
      <Vista mes={mes} vendedor={vendedor} />
      <input type="hidden" name="corteId" value={corteId} />
      <input type="hidden" name="vendedorId" value={vendedorId} />
      <CampoKey />
      <p className="text-monto font-semibold tabular-nums">Monto a pagar: {montoTexto}</p>
      <Campo etiqueta="Fecha" name="fecha" type="date" defaultValue={hoy} max={hoy} required />
      <Selector etiqueta="Método" name="metodo" required defaultValue="transferencia" opciones={METODOS} />
      <Campo etiqueta="Nota (opcional)" name="nota" maxLength={200} autoComplete="off" />
    </FormAccion>
  );
}

/** Pago registrado: el resumen y, en «Más acciones», Deshacer pago con motivo obligatorio. */
export function PagoRegistrado({
  mes,
  vendedor,
  pagoId,
  resumen,
}: {
  mes: string;
  vendedor: string;
  pagoId: string;
  resumen: string;
}) {
  return (
    <EncabezadoAcciones
      acciones={[
        {
          id: 'deshacer',
          etiqueta: 'Deshacer pago',
          peligro: true,
          contenido: (
            <FormAccion accion={accionAnularPagoComision} textoBoton="Deshacer pago">
              <Vista mes={mes} vendedor={vendedor} />
              <input type="hidden" name="pagoId" value={pagoId} />
              <CampoKey />
              <Campo etiqueta="Motivo" name="motivo" required maxLength={200} autoComplete="off" />
            </FormAccion>
          ),
        },
      ]}
    >
      <p className="text-dato">{resumen}</p>
    </EncabezadoAcciones>
  );
}
