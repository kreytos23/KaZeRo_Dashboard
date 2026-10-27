import { Document, Page, Text, View } from '@react-pdf/renderer';
import { ETIQUETA_METODO } from '@/app/panel/pedidos/etiquetas';
import { formatoMXN, porcentajeLegible } from '@/domain/dinero';
import { fechaCorta, hoyMX } from '@/domain/fechas';
import { formatoFolio } from '@/domain/pedidos';
import { vistaEstadoPago } from '@/features/ui/estado-visual';
import type { ReporteComisiones, VendedoraComision } from '@/server/comisiones/lecturas';
import { Encabezado, Fila, Pie, estilos } from './estilos';

const estadoPago = (v: VendedoraComision) =>
  v.estadoPago === 'pagado' && v.pago
    ? `Pagado el ${fechaCorta(v.pago.fecha)} (${ETIQUETA_METODO[v.pago.metodo]})`
    : vistaEstadoPago(v.estadoPago).texto;

const A_RESUMEN = [34, 8, 12, 23, 23];
const L_RESUMEN: ('l' | 'r')[] = ['l', 'r', 'r', 'r', 'r'];
const A_DETALLE = [12, 32, 20, 18, 18];
const L_DETALLE: ('l' | 'r')[] = ['l', 'l', 'l', 'r', 'r'];

/** «Mes cerrado el 1 dic 2026»: el instante de cierre (UTC) se muestra en el día de México. */
export function textoCierre(cerradoAt: string | null): string {
  return `Mes cerrado${cerradoAt ? ` el ${fechaCorta(hoyMX(new Date(cerradoAt)))}` : ''}`;
}

export function ComisionesPdf({ r, logo }: { r: ReporteComisiones; logo: Buffer }) {
  return (
    <Document title={`Comisiones — ${r.nombre}`} author="KaZeRo">
      <Page size="LETTER" style={estilos.pagina}>
        <Encabezado
          logo={logo}
          titulo={`Comisiones — ${r.nombre}`}
          meta={[
            `Generado el ${fechaCorta(hoyMX())}`,
            r.cerrado ? textoCierre(r.cerradoAt) : 'Estimado, sin cerrar',
          ]}
        />
        {r.vendedoras.length === 0 && <Text style={estilos.vacio}>No hay comisiones en este mes.</Text>}
        {r.vendedoras.map((v) => (
          <View key={v.vendedorId} style={estilos.grupo}>
            <Text style={estilos.grupoTitulo} minPresenceAhead={80}>
              {v.vendedorNombre}
            </Text>
            <Fila
              estilo={estilos.filaCab}
              anchos={A_RESUMEN}
              alinear={L_RESUMEN}
              celdas={['Estado de pago', '%', 'Pedidos', 'Base', 'Comisión']}
            />
            <Fila
              anchos={A_RESUMEN}
              alinear={L_RESUMEN}
              celdas={[
                estadoPago(v),
                v.pct ? `${porcentajeLegible(v.pct)}%` : '',
                String(v.pedidos),
                formatoMXN(v.baseCentavos),
                formatoMXN(v.comisionCentavos),
              ]}
            />
            {v.pedidosDetalle.length > 0 && (
              <View style={{ marginTop: 6 }}>
                <Fila
                  estilo={estilos.filaCab}
                  anchos={A_DETALLE}
                  alinear={L_DETALLE}
                  celdas={['Folio', 'Clienta', 'Liquidado', 'Base', 'Comisión']}
                />
                {v.pedidosDetalle.map((p) => (
                  <Fila
                    key={p.pedidoId}
                    anchos={A_DETALLE}
                    alinear={L_DETALLE}
                    celdas={[
                      formatoFolio(p.folio),
                      p.clienteNombre,
                      fechaCorta(p.fechaLiquidacion),
                      formatoMXN(p.baseCentavos),
                      formatoMXN(p.montoCentavos),
                    ]}
                  />
                ))}
              </View>
            )}
          </View>
        ))}
        <View style={estilos.total}>
          <Text>
            Total ({r.numPedidos} pedidos): {formatoMXN(r.totalCentavos)}
          </Text>
        </View>
        <Pie />
      </Page>
    </Document>
  );
}
