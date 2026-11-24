import { conDbLectura } from '@/db/client';
import { mesDe, mesDeUrl, mesesRecientes, nombreMes } from '@/domain/comisiones';
import { fechaLarga, hoyMX } from '@/domain/fechas';
import { incluirVentas } from '@/domain/reporte-exhibidor';
import { CampoCasilla, Selector } from '@/features/ui/Campo';
import { EstadoVacio } from '@/features/ui/EstadoVacio';
import { FormFiltros } from '@/features/ui/FormFiltros';
import { uuidOpcional } from '@/server/acciones';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { reporteExhibidores } from '@/server/reportes/exhibidores';
import { HojaExhibidor } from './HojaExhibidor';

export const metadata = { title: 'Exhibidores' };

export default async function ReporteExhibidores({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirSesion();
  const sp = await searchParams;
  const hoy = hoyMX();
  // Por omisión el mes en curso: la hoja es la «Relación de ventas» que se entrega con la fecha de hoy.
  const mes = mesDeUrl(typeof sp.mes === 'string' ? sp.mes : null) ?? mesDe(hoy);
  const exhibidorId = uuidOpcional(typeof sp.exhibidor === 'string' ? sp.exhibidor : null) ?? '';
  // Solo «1» enciende las ventas del mes (apagadas por omisión); sin JS sigue siendo un formulario GET con «Ver».
  const ventas = incluirVentas(sp.ventas);
  const r = await conDbLectura((db) => reporteExhibidores(db, { mes, hoy, ventas }));
  const hojas = exhibidorId ? r.hojas.filter((h) => h.exhibidorId === exhibidorId) : r.hojas;
  const consulta = new URLSearchParams({ mes: mes.slice(0, 7) });
  if (exhibidorId) consulta.set('exhibidor', exhibidorId);
  if (ventas) consulta.set('ventas', '1');
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <FormFiltros className="flex max-w-full min-w-0 flex-wrap items-end gap-2 [&>div]:max-w-full [&>div]:min-w-0">
          <Selector
            etiqueta="Mes"
            name="mes"
            defaultValue={mes.slice(0, 7)}
            opciones={mesesRecientes(hoy, 24).map((m) => ({ valor: m.slice(0, 7), texto: nombreMes(m) }))}
          />
          <Selector
            etiqueta="Exhibidor"
            name="exhibidor"
            defaultValue={exhibidorId}
            opciones={[
              { valor: '', texto: 'Todos' },
              ...r.hojas.map((h) => ({ valor: h.exhibidorId, texto: h.nombre })),
            ]}
          />
          <CampoCasilla name="ventas" value="1" defaultChecked={ventas}>
            Incluir ventas del mes
          </CampoCasilla>
        </FormFiltros>
        <a href={`/panel/reportes/exhibidores/pdf?${consulta}`} download className="boton-secundario">
          Descargar PDF
        </a>
      </div>
      {r.enCurso && <p className="aviso-atencion">Mes en curso: al {fechaLarga(r.hoy)}</p>}
      {hojas.length === 0 ? (
        <EstadoVacio titulo="Sin piezas en el exhibidor este mes." detalle="Elige otro mes o exhibidor." />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {hojas.map((h) => (
            <HojaExhibidor key={h.exhibidorId} h={h} ventas={ventas} entrega={fechaLarga(r.hoy)} />
          ))}
        </div>
      )}
    </div>
  );
}
