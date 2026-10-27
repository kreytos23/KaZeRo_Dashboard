import Link from 'next/link';

export const metadata = { title: 'Panel' };

export default function Panel() {
  return (
    <section className="fondo-acuarela flex flex-col gap-3 rounded-2xl border border-borde p-6 sm:p-8">
      <h1 className="text-2xl font-semibold">Panel Kazero</h1>
      <p className="text-tinta-suave">
        Usa el buscador (tecla /) para encontrar piezas, clientes, vendedores y folios.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link href="/panel/pedidos/nuevo" className="boton-primario">
          Nuevo pedido
        </Link>
        <Link href="/panel/inventario/nueva" className="boton-secundario">
          Nueva pieza
        </Link>
        <Link href="/panel/exhibidores" className="boton-secundario">
          Exhibidores
        </Link>
      </div>
    </section>
  );
}
