import { Document, Page, Text, View } from '@react-pdf/renderer';
import { formatoMXN } from '@/domain/dinero';
import type { reporteDeudores } from '@/server/reportes/deudores';
import { Encabezado, Fila, Pie, estilos } from './estilos';

type Reporte = Awaited<ReturnType<typeof reporteDeudores>>;

export const fechaCorta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

const ANCHOS = [7, 22, 14, 12, 14, 14, 14, 8];
const ALINEAR: ('l' | 'r')[] = ['l', 'l', 'l', 'l', 'r', 'r', 'r', 'r'];

export function DeudoresPdf({ r, filtro, logo }: { r: Reporte; filtro: string | null; logo: Buffer }) {
  return (
    <Document title="Reporte de deudores" author="KaZeRo">
      <Page size="LETTER" style={estilos.pagina}>
        <Encabezado
          logo={logo}
          titulo="Reporte de deudores"
          meta={[`Generado el ${fechaCorta(r.fecha)}`, `Vendedora: ${filtro ?? 'todas'}`]}
        />
        {r.grupos.length === 0 && <Text style={estilos.vacio}>No hay pedidos con saldo pendiente.</Text>}
        {r.grupos.map((g) => (
          <View key={g.vendedorId} style={estilos.grupo}>
            <Text style={estilos.grupoTitulo} minPresenceAhead={60}>
              {g.vendedorNombre}
            </Text>
            <Fila
              estilo={estilos.filaCab}
              anchos={ANCHOS}
              alinear={ALINEAR}
              celdas={['Folio', 'Clienta', 'Teléfono', 'Fecha', 'Total', 'Abonado', 'Saldo', 'Días']}
            />
            {g.pedidos.map((p) => (
              <Fila
                key={p.pedidoId}
                estilo={p.atrasado ? estilos.atraso : undefined}
                anchos={ANCHOS}
                alinear={ALINEAR}
                celdas={[
                  String(p.folio),
                  p.clienteNombre,
                  p.telefono ?? '',
                  fechaCorta(p.fecha),
                  formatoMXN(p.totalCentavos),
                  formatoMXN(p.pagadoCentavos),
                  formatoMXN(p.saldoCentavos),
                  p.atrasado ? `${p.dias} !` : String(p.dias),
                ]}
              />
            ))}
            <View style={estilos.subtotal}>
              <Text>
                Subtotal {g.vendedorNombre}: {formatoMXN(g.saldoCentavos)}
              </Text>
            </View>
          </View>
        ))}
        <View style={estilos.total}>
          <Text>
            Total general ({r.numPedidos} pedidos): {formatoMXN(r.totalCentavos)}
          </Text>
        </View>
        <Pie />
      </Page>
    </Document>
  );
}
