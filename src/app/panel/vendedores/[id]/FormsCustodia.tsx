'use client';

import { FormEntregaLote, FormRegresoLote, type PiezaARegresar } from '@/features/piezas/FormsLotePiezas';
import type { PiezaElegible } from '@/features/piezas/lote-piezas';
import { accionEntregarAVendedora, accionRegresarAKazero } from '../acciones';

interface Props {
  vendedorId: string;
  nombre: string;
  /** Un asociado inactivo puede devolver piezas, pero no recibir más. */
  puedeRecibir: boolean;
  /** Lo que tiene ahora; solo las disponibles llevan casilla (las apartadas regresan al cancelar la nota). */
  enPoder: PiezaARegresar[];
  /** Disponibles en Kazero y sin custodia: lo único que se le puede entregar. */
  elegibles: PiezaElegible[];
}

/** Lotes todo o nada, iguales a los del exhibidor: casillas para regresar y buscador para entregar. */
export function FormsCustodia({ vendedorId, nombre, puedeRecibir, enPoder, elegibles }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <FormRegresoLote
        accion={accionRegresarAKazero}
        etiqueta="Regresar a Kazero"
        etiquetaLista="Piezas en su poder"
        piezas={enPoder}
        sinPiezas={`${nombre} no tiene piezas en su poder.`}
        textos={{
          vacio: 'Regresar a Kazero',
          uno: 'Regresar 1 seleccionada',
          varios: 'Regresar {n} seleccionadas',
        }}
      >
        <input type="hidden" name="vendedorId" value={vendedorId} />
      </FormRegresoLote>
      {puedeRecibir ? (
        <section aria-labelledby="entregar-a" className="flex flex-col gap-2">
          <h3 id="entregar-a" className="text-base font-semibold">
            Entregar a {nombre}
          </h3>
          <FormEntregaLote
            accion={accionEntregarAVendedora}
            etiqueta={`Entregar a ${nombre}`}
            elegibles={elegibles}
            textos={{
              vacio: `Entregar a ${nombre}`,
              uno: `Entregar 1 pieza a ${nombre}`,
              varios: `Entregar {n} piezas a ${nombre}`,
            }}
          >
            <input type="hidden" name="vendedorId" value={vendedorId} />
          </FormEntregaLote>
        </section>
      ) : (
        <p className="aviso-atencion">Este asociado está inactivo: no se le pueden entregar piezas.</p>
      )}
    </div>
  );
}
