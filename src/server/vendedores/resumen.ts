import type { Ejecutor } from '@/db/pool';
import { hoyMX } from '@/domain/fechas';
import { calcularMesAbierto, comisionesPendientes, reporteComisiones } from '@/server/comisiones/lecturas';
import { reporteDeudores } from '@/server/reportes/deudores';

export interface ResumenVendedoraFicha {
  porCobrarCentavos: number;
  pedidosConSaldo: number;
  comisionEnCurso: { mes: string; nombre: string; montoCentavos: number };
  pendientes: Awaited<ReturnType<typeof comisionesPendientes>>;
}

export async function resumenDeVendedora(
  db: Ejecutor,
  vendedorId: string,
  hoy: string = hoyMX(),
): Promise<ResumenVendedoraFicha> {
  const abierto = await calcularMesAbierto(db, hoy);
  const [deudas, curso, pendientes] = await Promise.all([
    reporteDeudores(db, { vendedorId, hoy }),
    reporteComisiones(db, abierto, { vendedorId, hoy, abierto }),
    comisionesPendientes(db, vendedorId),
  ]);
  return {
    porCobrarCentavos: deudas.totalCentavos,
    pedidosConSaldo: deudas.numPedidos,
    comisionEnCurso: { mes: curso.mes, nombre: curso.nombre, montoCentavos: curso.totalCentavos },
    pendientes,
  };
}
