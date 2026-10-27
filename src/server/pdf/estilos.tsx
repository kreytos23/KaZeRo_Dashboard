import { Image, StyleSheet, Text, View, type ViewProps } from '@react-pdf/renderer';

export const LEMA = 'Vida, moda y estilo';
export const COLOR_ATRASO = '#b42318';
export const COLOR_SUAVE = '#6b6b6b';

export const estilos = StyleSheet.create({
  pagina: { padding: 36, paddingBottom: 54, fontFamily: 'Helvetica', fontSize: 10, color: '#222' },
  marca: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  logo: { height: 34 },
  lema: { fontSize: 10, color: COLOR_SUAVE },
  titulo: { fontFamily: 'Helvetica-Bold', fontSize: 16, marginTop: 4 },
  meta: { fontSize: 10, color: COLOR_SUAVE, marginTop: 2 },
  grupo: { marginTop: 14 },
  grupoTitulo: { fontFamily: 'Helvetica-Bold', fontSize: 12, marginBottom: 4 },
  fila: { flexDirection: 'row', paddingVertical: 2, borderBottomWidth: 0.5, borderBottomColor: '#ddd' },
  filaCab: { borderBottomWidth: 1, borderBottomColor: '#222', fontFamily: 'Helvetica-Bold' },
  negrita: { fontFamily: 'Helvetica-Bold' },
  atraso: { fontFamily: 'Helvetica-Bold', color: COLOR_ATRASO },
  subtotal: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4, fontFamily: 'Helvetica-Bold' },
  total: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 16,
    fontFamily: 'Helvetica-Bold',
    fontSize: 12,
  },
  vacio: { marginTop: 20, color: COLOR_SUAVE },
  pie: {
    position: 'absolute',
    bottom: 24,
    left: 36,
    right: 36,
    textAlign: 'center',
    fontSize: 9,
    color: COLOR_SUAVE,
  },
});

export const der = { textAlign: 'right' as const };

/** Anchos de columna en %, alineados entre cabecera y filas. */
export function Fila({
  celdas,
  anchos,
  alinear,
  estilo,
}: {
  celdas: string[];
  anchos: number[];
  alinear: ('l' | 'r')[];
  estilo?: ViewProps['style'];
}) {
  return (
    <View style={[estilos.fila, estilo ?? {}]} wrap={false}>
      {celdas.map((c, i) => (
        <Text key={i} style={[{ width: `${anchos[i]}%`, paddingRight: 3 }, alinear[i] === 'r' ? der : {}]}>
          {c}
        </Text>
      ))}
    </View>
  );
}

export function Encabezado({ logo, titulo, meta }: { logo: Buffer; titulo: string; meta: string[] }) {
  return (
    <View>
      <View style={estilos.marca}>
        {/* Image de react-pdf, no un <img>: el PDF no usa alt. */}
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        <Image src={logo} style={estilos.logo} />
        <View>
          <Text style={estilos.lema}>{LEMA}</Text>
        </View>
      </View>
      <Text style={estilos.titulo}>{titulo}</Text>
      {meta.map((m) => (
        <Text key={m} style={estilos.meta}>
          {m}
        </Text>
      ))}
    </View>
  );
}

export function Pie() {
  return (
    <Text
      style={estilos.pie}
      fixed
      render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`}
    />
  );
}
