import { z } from 'zod';
import { conDbLectura } from '@/db/client';
import { hoyMX } from '@/domain/fechas';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { obtenerCliente } from '@/server/clientes/servicio';
import { listarVendedores } from '@/server/vendedores/servicio';
import { FormNuevoPedido } from './FormNuevoPedido';

export const metadata = { title: 'Nuevo pedido' };

export default async function PaginaNuevoPedido({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string | string[] }>;
}) {
  await requerirSesion();
  const bruto = (await searchParams).cliente;
  const clienteId = z.uuid().safeParse(Array.isArray(bruto) ? bruto[0] : bruto);
  const { vendedores, cliente } = await conDbLectura(async (db) => ({
    vendedores: await listarVendedores(db, { soloActivos: true }),
    cliente: clienteId.success ? await obtenerCliente(db, clienteId.data) : null,
  }));
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Nuevo pedido</h1>
      <FormNuevoPedido
        vendedores={vendedores.map((v) => ({ id: v.id, nombre: v.nombre, tipo: v.tipo }))}
        clienteInicial={
          cliente
            ? { id: cliente.id, nombre: cliente.nombre, vendedorHabitualId: cliente.vendedorHabitualId }
            : null
        }
        hoy={hoyMX()}
      />
    </section>
  );
}
