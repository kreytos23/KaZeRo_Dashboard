import Link from 'next/link';
import { conDbLectura } from '@/db/client';
import { centavosANumeric, formatoMXN } from '@/domain/dinero';
import { hoyMX } from '@/domain/fechas';
import { formatoFolio } from '@/domain/pedidos';
import { textoCierre, textoReporteDeudores } from '@/domain/recordatorios';
import { EstadoVacio } from '@/features/ui/EstadoVacio';
import { FECHA_LARGA } from '@/features/ui/formato';
import { Saldo } from '@/features/ui/Saldo';
import { calcularMesAbierto, comisionesPendientes, reporteComisiones } from '@/server/comisiones/lecturas';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { reporteDeudores } from '@/server/reportes/deudores';

export const metadata = { title: 'Panel' };

export default async function Panel() {
  await requerirSesion();
  const hoy = hoyMX();
  const { deudas, pendientes, curso, abierto } = await conDbLectura(async (db) => {
    const [deudas, pendientes, abierto] = await Promise.all([
      reporteDeudores(db, { hoy }),
      comisionesPendientes(db),
      calcularMesAbierto(db, hoy),
    ]);
    const curso = await reporteComisiones(db, abierto, { hoy, abierto });
    return { deudas, pendientes, curso, abierto };
  });
  const cierre = textoCierre(abierto, hoy);
  const atrasados = deudas.grupos
    .flatMap((g) => g.pedidos)
    .sort((a, b) => b.dias - a.dias || a.folio - b.folio)
    .slice(0, 5);
  const conAtraso = deudas.grupos.reduce((n, g) => n + g.pedidos.filter((p) => p.atrasado).length, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <h1 className="text-2xl font-semibold first-letter:uppercase">
          {FECHA_LARGA.format(new Date(`${hoy}T12:00:00Z`))}
        </h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/panel/pedidos/nuevo" className="boton-primario">
            Nuevo pedido
          </Link>
          <Link href="/panel/pedidos?estado=abierto" className="boton-secundario">
            Registrar pago
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-1 rounded-2xl bg-secundario-suave p-4 text-dato">
        <p>{textoReporteDeudores(hoy)}</p>
        <p>
          {cierre.texto}{' '}
          {cierre.cerrable && (
            <Link href="/panel/reportes/comisiones" className="font-semibold underline">
              Ir a comisiones
            </Link>
          )}
        </p>
      </div>

      {deudas.numPedidos === 0 ? (
        <section className="tarjeta flex flex-col gap-3 p-5">
          <h2 className="text-monto font-semibold">Por cobrar</h2>
          <p className="text-dato text-tinta-suave">Nadie debe nada.</p>
        </section>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="tarjeta flex flex-col gap-3 p-5">
            <h2 className="text-monto font-semibold">Por cobrar</h2>
            <p className="text-destacado font-bold tabular-nums">{formatoMXN(deudas.totalCentavos)}</p>
            <p className="text-dato text-tinta-suave">
              {deudas.numPedidos} {deudas.numPedidos === 1 ? 'pedido' : 'pedidos'} · {conAtraso} con más de 30 días
            </p>
            <ul className="flex flex-col gap-1">
              {deudas.grupos.map((g) => (
                <li key={g.vendedorId} className="flex justify-between gap-3 text-dato">
                  <Link
                    href={`/panel/reportes/deudores?vendedor=${g.vendedorId}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {g.vendedorNombre}
                  </Link>
                  <span className="tabular-nums">{formatoMXN(g.saldoCentavos)}</span>
                </li>
              ))}
            </ul>
            <Link href="/panel/reportes/deudores" className="font-semibold underline">
              Ver reporte de deudores
            </Link>
          </section>

          <section className="tarjeta flex flex-col gap-3 p-5">
            <h2 className="text-monto font-semibold">Pedidos más atrasados</h2>
            <ul className="flex flex-col gap-2">
              {atrasados.map((p) => (
                <li key={p.pedidoId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="text-dato">
                    <Link href={`/panel/pedidos/${p.folio}`} className="font-semibold underline">
                      {formatoFolio(p.folio)}
                    </Link>{' '}
                    {p.clienteNombre}
                  </span>
                  <span className="flex items-center gap-2">
                    <Saldo estado="abierto" saldo={centavosANumeric(p.saldoCentavos)} />
                    <span className="text-dato text-tinta-suave">{p.dias} {p.dias === 1 ? 'día' : 'días'}</span>
                  </span>
                </li>
              ))}
            </ul>
            <Link href="/panel/pedidos?estado=abierto" className="font-semibold underline">
              Ver pedidos abiertos
            </Link>
          </section>
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-monto font-semibold">Comisiones</h2>
        {pendientes.length === 0 ? (
          <EstadoVacio titulo="No hay comisiones por pagar." />
        ) : (
          <ul className="tarjeta flex flex-col gap-2 p-5">
            {pendientes.map((p) => (
              <li key={`${p.mes}-${p.vendedorId}`} className="flex justify-between gap-3 text-dato">
                <Link
                  href={`/panel/reportes/comisiones?mes=${p.mes.slice(0, 7)}&vendedor=${p.vendedorId}`}
                  className="underline-offset-2 hover:underline"
                >
                  {p.vendedorNombre} · {p.nombre}
                </Link>
                <span className="font-semibold tabular-nums">{formatoMXN(p.montoCentavos)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-dato text-tinta-suave">
          {curso.nombre} (en curso): estimado {formatoMXN(curso.totalCentavos)}
        </p>
      </section>
    </div>
  );
}
