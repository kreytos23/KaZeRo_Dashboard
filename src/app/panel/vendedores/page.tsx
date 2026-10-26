import Link from 'next/link';
import { conDbLectura } from '@/db/client';
import { porcentajeLegible } from '@/domain/dinero';
import { Campo, Selector } from '@/features/ui/Campo';
import { FormAccion } from '@/features/ui/FormAccion';
import { requerirSesion } from '@/server/auth/sesion-actual';
import { listarVendedores } from '@/server/vendedores/servicio';
import { accionCrearVendedor } from './acciones';
import { TIPOS } from './tipos';

export const metadata = { title: 'Vendedores' };

export default async function PaginaVendedores() {
  await requerirSesion();
  const vendedores = await conDbLectura((db) => listarVendedores(db));
  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Vendedores</h1>
      <FormAccion accion={accionCrearVendedor} textoBoton="Agregar vendedor" limpiarAlGuardar>
        <Campo etiqueta="Nombre" name="nombre" required maxLength={80} />
        <Selector etiqueta="Tipo" name="tipo" opciones={TIPOS} />
        <Campo etiqueta="Comisión (%)" name="comision" inputMode="decimal" defaultValue="0" required />
      </FormAccion>
      <div className="tarjeta overflow-x-auto px-2">
        <table className="w-full text-left text-dato">
          <caption className="sr-only">Lista de vendedores</caption>
          <thead className="text-meta font-semibold text-tinta-suave">
            <tr>
              <th scope="col" className="px-3 py-3">
                Nombre
              </th>
              <th scope="col" className="px-3 py-3">
                Tipo
              </th>
              <th scope="col" className="px-3 py-3">
                Comisión
              </th>
              <th scope="col" className="px-3 py-3">
                Estado
              </th>
            </tr>
          </thead>
          <tbody>
            {vendedores.map((v) => (
              <tr key={v.id} className="border-t border-borde">
                <td className="px-3 py-1">
                  <Link
                    href={`/panel/vendedores/${v.id}`}
                    className="enlace inline-flex min-h-11 items-center"
                  >
                    {v.nombre}
                  </Link>
                </td>
                <td className="px-3 py-1">{TIPOS.find((t) => t.valor === v.tipo)?.texto}</td>
                <td className="px-3 py-1 tabular-nums">{porcentajeLegible(v.comisionPct)}%</td>
                <td className="px-3 py-1">{v.activo ? 'Activo' : 'Inactivo'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
