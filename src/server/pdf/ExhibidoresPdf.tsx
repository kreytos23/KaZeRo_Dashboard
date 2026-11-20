import { Document, Page, Text, View } from '@react-pdf/renderer';
import { nombreMes } from '@/domain/comisiones';
import { formatoMXN } from '@/domain/dinero';
import { fechaCorta } from '@/domain/fechas';
import { formatoFolio } from '@/domain/pedidos';
import type { HojaExhibidor, ReporteExhibidores } from '@/server/reportes/exhibidores';
import { Encabezado, Fila, Pie, estilos } from './estilos';

const ANCHOS_VENTAS = [13, 13, 8, 18, 18, 18, 12];
const ALINEAR_VENTAS: ('l' | 'r')[] = ['l', 'l', 'r', 'r', 'r', 'r', 'l'];
const ANCHOS_PIEZAS = [18, 60, 22];
const ALINEAR_PIEZAS: ('l' | 'r')[] = ['l', 'l', 'r'];
const ANCHOS_CUADRE = [70, 30];
const ALINEAR_CUADRE: ('l' | 'r')[] = ['l', 'r'];
const ESTADO = { abierto: 'Abierta', liquidado: 'Pagada', cancelado: 'Cancelada' } as const;

function Cuadre({ titulo, filas }: { titulo: string; filas: [string, string][] }) {
  return (
    <View style={estilos.grupo}>
      <Text style={estilos.grupoTitulo}>{titulo}</Text>
      {filas.map(([etiqueta, valor], i) => (
        <Fila
          key={etiqueta}
          estilo={i === filas.length - 1 ? estilos.negrita : undefined}
          anchos={ANCHOS_CUADRE}
          alinear={ALINEAR_CUADRE}
          celdas={[etiqueta, valor]}
        />
      ))}
    </View>
  );
}

function Hoja({ h, meta, logo }: { h: HojaExhibidor; meta: string[]; logo: Buffer }) {
  const { piezas: p, dinero: d } = h;
  return (
    <Page size="LETTER" style={estilos.pagina}>
      <Encabezado
        logo={logo}
        titulo={`Exhibidor ${h.nombre}`}
        meta={[...meta, `Asociado: ${h.vendedorNombre}`]}
      />
      <Cuadre
        titulo="Piezas"
        filas={[
          ['Al inicio', String(p.alInicio)],
          ['Enviadas', String(p.enviadas)],
          ['Vendidas', String(p.vendidas)],
          ['Regresadas', String(p.regresadas)],
          ['Regresadas por cancelación o edición', String(p.porCancelacion)],
          ...(p.otros !== 0 ? ([['Otros movimientos', String(p.otros)]] as [string, string][]) : []),
          ['Al cierre', String(p.alCierre)],
        ]}
      />
      <Cuadre
        titulo="Dinero"
        filas={[
          ['Por entregar al inicio', formatoMXN(d.alInicio)],
          ['Cobrado', formatoMXN(d.cobrado)],
          ['Entregado', formatoMXN(d.entregado)],
          ['Ajustes', formatoMXN(d.ajustes)],
          ['Por entregar al cierre', formatoMXN(d.alCierre)],
        ]}
      />
      <View style={estilos.grupo}>
        <Text style={estilos.grupoTitulo} minPresenceAhead={60}>
          Ventas del mes
        </Text>
        {h.ventas.length === 0 ? (
          <Text style={estilos.vacio}>Sin ventas en el mes.</Text>
        ) : (
          <>
            <Fila
              estilo={estilos.filaCab}
              anchos={ANCHOS_VENTAS}
              alinear={ALINEAR_VENTAS}
              celdas={['Folio', 'Fecha', 'Pzas', 'Total', 'Cobrado', 'Saldo', 'Estado']}
            />
            {h.ventas.map((v) => (
              <Fila
                key={v.pedidoId}
                anchos={ANCHOS_VENTAS}
                alinear={ALINEAR_VENTAS}
                celdas={[
                  formatoFolio(v.folio),
                  fechaCorta(v.fecha),
                  String(v.piezas),
                  formatoMXN(v.totalCentavos),
                  formatoMXN(v.cobradoCentavos),
                  formatoMXN(v.saldoCentavos),
                  ESTADO[v.estado],
                ]}
              />
            ))}
          </>
        )}
      </View>
      <View style={estilos.grupo}>
        <Text style={estilos.grupoTitulo} minPresenceAhead={60}>
          Piezas al cierre
        </Text>
        {h.piezasAlCierre.length === 0 ? (
          <Text style={estilos.vacio}>No quedaron piezas.</Text>
        ) : (
          <>
            <Fila
              estilo={estilos.filaCab}
              anchos={ANCHOS_PIEZAS}
              alinear={ALINEAR_PIEZAS}
              celdas={['Código', 'Descripción', 'Precio']}
            />
            {h.piezasAlCierre.map((z) => (
              <Fila
                key={z.codigo}
                anchos={ANCHOS_PIEZAS}
                alinear={ALINEAR_PIEZAS}
                celdas={[z.codigo, z.descripcion, formatoMXN(z.precioCentavos)]}
              />
            ))}
          </>
        )}
      </View>
      <Pie />
    </Page>
  );
}

/** X-1: se le entrega al exhibidor. Solo folios: sin clientas, costos ni margen. */
export function ExhibidoresPdf({
  r,
  hojas,
  logo,
}: {
  r: ReporteExhibidores;
  hojas: HojaExhibidor[];
  logo: Buffer;
}) {
  const meta = [`${nombreMes(r.mes)}${r.enCurso ? ' · al día de hoy' : ''}`];
  return (
    <Document title="Reporte de exhibidores" author="KaZeRo">
      {hojas.length === 0 ? (
        <Page size="LETTER" style={estilos.pagina}>
          <Encabezado logo={logo} titulo="Reporte de exhibidores" meta={meta} />
          <Text style={estilos.vacio}>Sin movimiento en el mes.</Text>
          <Pie />
        </Page>
      ) : (
        hojas.map((h) => <Hoja key={h.exhibidorId} h={h} meta={meta} logo={logo} />)
      )}
    </Document>
  );
}
