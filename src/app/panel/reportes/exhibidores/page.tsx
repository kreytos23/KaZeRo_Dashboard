import { conDbLectura } from '@/db/client';
import { mesAnterior, mesDe, mesDeUrl, mesesRecientes, nombreMes } from '@/domain/comisiones';
import { hoyMX } from '@/domain/fechas';
import { Selector } from '@/features/ui/Campo';
import { EstadoVacio } from '@/features/ui/EstadoVacio';
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
  // Por omisión el último mes completo: es el que se entrega.
  const mes = mesDeUrl(typeof sp.mes === 'string' ? sp.mes : null) ?? mesAnterior(mesDe(hoy));
  const exhibidorId = uuidOpcional(typeof sp.exhibidor === 'string' ? sp.exhibidor : null) ?? '';
  const r = await conDbLectura((db) => reporteExhibidores(db, { mes, hoy }));
  const hojas = exhibidorId ? r.hojas.filter((h) => h.exhibidorId === exhibidorId) : r.hojas;
  const consulta = new URLSearchParams({ mes: mes.slice(0, 7) });
  if (exhibidorId) consulta.set('exhibidor', exhibidorId);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <form role="search" method="get" className="flex flex-wrap items-end gap-2">
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
          <button type="submit" className="boton-secundario">
            Ver
          </button>
        </form>
        <a href={`/panel/reportes/exhibidores/pdf?${consulta}`} download className="boton-secundario">
          Descargar PDF
        </a>
      </div>
      {r.enCurso && <p className="aviso-atencion">Mes en curso: los números son al día de hoy.</p>}
      {hojas.length === 0 ? (
        <EstadoVacio titulo="Sin movimiento en este mes." detalle="Elige otro mes o exhibidor." />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {hojas.map((h) => (
            <HojaExhibidor key={h.exhibidorId} h={h} />
          ))}
        </div>
      )}
    </div>
  );
}
