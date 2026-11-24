import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { nombreMes } from '@/domain/comisiones';
import { formatoMXN } from '@/domain/dinero';
import { fechaCorta, fechaLarga } from '@/domain/fechas';
import { formatoFolio } from '@/domain/pedidos';
import type { HojaExhibidor, ReporteExhibidores } from '@/server/reportes/exhibidores';
import { Fila, Pie, estilos } from './estilos';

const ANCHOS_VENTAS = [12, 13, 7, 17, 17, 17, 17];
const ALINEAR_VENTAS: ('l' | 'r')[] = ['l', 'l', 'r', 'r', 'r', 'r', 'r'];
const ESTADO = { abierto: 'Abierta', liquidado: 'Pagada', cancelado: 'Cancelada' } as const;

/** Columnas de la relación: ID, Descripción, Precio de venta y Fecha de venta (vacía, se llena a mano). */
const COLUMNAS = [
  { titulo: 'ID', ancho: '13%' },
  { titulo: 'Descripción', ancho: '49%' },
  { titulo: 'Precio de venta', ancho: '16%', derecha: true },
  { titulo: 'Fecha de venta', ancho: '22%' },
] as const;
const BORDE = '#9a8a84';
const ROSA = '#f8e7e2'; // rubor suave de la marca

const r = StyleSheet.create({
  cabecera: { position: 'relative', minHeight: 48, justifyContent: 'center', marginBottom: 14 },
  logo: { position: 'absolute', top: 0, right: 0, height: 40 },
  titulo: { fontSize: 16, textAlign: 'center' },
  usuario: { fontSize: 10, color: '#555', textAlign: 'center', marginTop: 3 },
  datos: { marginBottom: 8, fontSize: 10 },
  exhibidor: { fontFamily: 'Helvetica-Bold' },
  datoSuave: { color: '#555' },
  tabla: { borderLeftWidth: 0.5, borderColor: BORDE },
  // Cada fila cierra abajo y la cabecera (que se repite por página) cierra arriba: ningún corte queda abierto.
  fila: { flexDirection: 'row', minHeight: 24, borderBottomWidth: 0.5, borderColor: BORDE },
  filaCab: { minHeight: 30, borderTopWidth: 0.5, fontFamily: 'Helvetica-Bold' },
  celda: {
    borderRightWidth: 0.5,
    borderColor: BORDE,
    paddingHorizontal: 4,
    paddingVertical: 3,
    justifyContent: 'center',
  },
  entrega: { marginTop: 28, textAlign: 'right', fontSize: 11 },
});

function Celdas({ textos, cabecera }: { textos: string[]; cabecera?: boolean }) {
  return COLUMNAS.map((c, i) => (
    <View key={c.titulo} style={[r.celda, { width: c.ancho }]}>
      <Text style={{ textAlign: cabecera ? 'center' : 'derecha' in c ? 'right' : 'left' }}>{textos[i]}</Text>
    </View>
  ));
}

function Relacion({ h }: { h: HojaExhibidor }) {
  return (
    <View style={r.tabla}>
      {/* `fixed`: la cabecera se repite en cada página que ocupe la tabla. */}
      <View style={[r.fila, r.filaCab]} wrap={false} fixed>
        <Celdas cabecera textos={COLUMNAS.map((c) => c.titulo)} />
      </View>
      {h.piezasAlCierre.map((z, i) => (
        <View key={z.codigo} style={[r.fila, { backgroundColor: i % 2 === 0 ? ROSA : '#fff' }]} wrap={false}>
          <Celdas textos={[z.codigo, z.descripcion, formatoMXN(z.precioCentavos), '']} />
        </View>
      ))}
    </View>
  );
}

function Cabecera({ logo }: { logo: Buffer }) {
  return (
    <View style={r.cabecera}>
      <Text style={r.titulo}>Relación de ventas KaZeRo</Text>
      <Text style={r.usuario}>(@kazerovidamodayestilo)</Text>
      {/* Image de react-pdf, no un <img>: el PDF no usa alt. */}
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      <Image src={logo} style={r.logo} />
    </View>
  );
}

function Ventas({ h }: { h: HojaExhibidor }) {
  return (
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
  );
}

function Hoja({
  h,
  periodo,
  entrega,
  logo,
  ventas,
}: {
  h: HojaExhibidor;
  periodo: string;
  entrega: string;
  logo: Buffer;
  ventas: boolean;
}) {
  return (
    <Page size="LETTER" style={estilos.pagina}>
      <Cabecera logo={logo} />
      <Text style={r.datos}>
        <Text style={r.exhibidor}>{h.nombre}</Text>
        <Text style={r.datoSuave}>{` · Asociado: ${h.vendedorNombre} · ${periodo}`}</Text>
      </Text>
      {h.piezasAlCierre.length === 0 ? (
        <Text style={estilos.vacio}>No quedaron piezas en el exhibidor.</Text>
      ) : (
        <Relacion h={h} />
      )}
      <Text style={r.entrega}>{entrega}</Text>
      {ventas && <Ventas h={h} />}
      <Pie />
    </Page>
  );
}

/**
 * «Relación de ventas»: se imprime y se le entrega al exhibidor, donde el asociado anota a mano la fecha de venta.
 * X-1: precio de venta y folios; sin costo, margen ni datos de clientas.
 */
export function ExhibidoresPdf({
  r: reporte,
  hojas,
  logo,
  ventas = false,
}: {
  r: ReporteExhibidores;
  hojas: HojaExhibidor[];
  logo: Buffer;
  ventas?: boolean;
}) {
  const fecha = fechaLarga(reporte.hoy);
  const periodo = `${nombreMes(reporte.mes)}${reporte.enCurso ? ` · Mes en curso: al ${fecha}` : ''}`;
  const entrega = `Fecha de entrega: ${fecha}`;
  return (
    <Document title="Relación de ventas" author="KaZeRo">
      {hojas.length === 0 ? (
        <Page size="LETTER" style={estilos.pagina}>
          <Cabecera logo={logo} />
          <Text style={r.datoSuave}>{periodo}</Text>
          <Text style={estilos.vacio}>Sin piezas ni movimiento en el mes.</Text>
          <Pie />
        </Page>
      ) : (
        hojas.map((h) => (
          <Hoja key={h.exhibidorId} h={h} periodo={periodo} entrega={entrega} logo={logo} ventas={ventas} />
        ))
      )}
    </Document>
  );
}
