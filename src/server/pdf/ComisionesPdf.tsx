import { Document, Page, Text, View } from '@react-pdf/renderer';
import { formatoMXN, porcentajeLegible } from '@/domain/dinero';
import { hoyMX } from '@/domain/fechas';
import { formatoFolio } from '@/domain/pedidos';
import type { ReporteComisiones, VendedoraComision } from '@/server/comisiones/lecturas';
import { fechaCorta } from './DeudoresPdf';
import { Encabezado, Fila, Pie, estilos } from './estilos';

const METODO = { efectivo: 'efectivo', transferencia: 'transferencia', otro: 'otro método' } as const;
const ESTADO = {
  estimado: 'Estimado',
  pendiente: 'Pendiente de pago',
  sin_comision: 'Sin comisión',
  pagado: 'Pagado',
} as const;

const estadoPago = (v: VendedoraComision) =>
  v.estadoPago === 'pagado' && v.pago
    ? `Pagado el ${fechaCorta(v.pago.fecha)} (${METODO[v.pago.metodo]})`
    : ESTADO[v.estadoPago];

const A_RESUMEN = [34, 8, 12, 23, 23];
const L_RESUMEN: ('l' | 'r')[] = ['l', 'r', 'r', 'r', 'r'];
const A_DETALLE = [12, 32, 20, 18, 18];
const L_DETALLE: ('l' | 'r')[] = ['l', 'l', 'l', 'r', 'r'];

export function ComisionesPdf({ r, logo }: { r: ReporteComisiones; logo: Buffer }) {
  return (
    <Document title={`Comisiones — ${r.nombre}`} author="KaZeRo">
      <Page size="LETTER" style={estilos.pagina}>
        <Encabezado
          logo={logo}
          titulo={`Comisiones — ${r.nombre}`}
          meta={[
            `Generado el ${fechaCorta(hoyMX())}`,
            r.cerrado
              ? `Mes cerrado${r.cerradoAt ? ` el ${fechaCorta(r.cerradoAt.slice(0, 10))}` : ''}`
              : 'Estimado, sin cerrar',
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
