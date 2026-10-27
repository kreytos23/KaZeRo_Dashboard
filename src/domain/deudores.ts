export const DIAS_ATRASO = 30;

export interface PedidoDeudor {
  pedidoId: string;
  folio: number;
  vendedorId: string;
  vendedorNombre: string;
  clienteNombre: string;
  telefono: string | null;
  fecha: string;
  totalCentavos: number;
  pagadoCentavos: number;
  saldoCentavos: number;
}

export interface FilaDeudor extends PedidoDeudor {
  dias: number;
  atrasado: boolean;
}

export interface GrupoDeudores {
  vendedorId: string;
  vendedorNombre: string;
  pedidos: FilaDeudor[];
  saldoCentavos: number;
}

const dia = (iso: string) =>
  Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

export function agruparDeudores(
  pedidos: PedidoDeudor[],
  hoy: string,
): { grupos: GrupoDeudores[]; totalCentavos: number; numPedidos: number } {
  const porVendedora = new Map<string, GrupoDeudores>();
  let totalCentavos = 0;
  let numPedidos = 0;
  for (const p of pedidos) {
    if (p.saldoCentavos <= 0) continue;
    const dias = Math.round((dia(hoy) - dia(p.fecha)) / 86_400_000);
    const g = porVendedora.get(p.vendedorId) ?? {
      vendedorId: p.vendedorId,
      vendedorNombre: p.vendedorNombre,
      pedidos: [],
      saldoCentavos: 0,
    };
    g.pedidos.push({ ...p, dias, atrasado: dias > DIAS_ATRASO });
    g.saldoCentavos += p.saldoCentavos;
    porVendedora.set(p.vendedorId, g);
    totalCentavos += p.saldoCentavos;
    numPedidos += 1;
  }
  const grupos = [...porVendedora.values()].sort((a, b) => b.saldoCentavos - a.saldoCentavos);
  for (const g of grupos) g.pedidos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.folio - b.folio);
  return { grupos, totalCentavos, numPedidos };
}
