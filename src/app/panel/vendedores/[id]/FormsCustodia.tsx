'use client';

import { AreaTexto } from '@/features/ui/Campo';
import { FormAccion } from '@/features/ui/FormAccion';
import { accionEntregarAVendedora, accionRegresarAKazero } from '../acciones';

interface Props {
  vendedorId: string;
  nombre: string;
  /** Una vendedora inactiva puede devolver piezas, pero no recibir más. */
  puedeRecibir: boolean;
}

/** Lotes por códigos, iguales a los del exhibidor: todo o nada, uno por línea o separados por espacio o coma. */
export function FormsCustodia({ vendedorId, nombre, puedeRecibir }: Props) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {puedeRecibir ? (
        <FormAccion accion={accionEntregarAVendedora} textoBoton={`Entregar a ${nombre}`} limpiarAlGuardar>
          <input type="hidden" name="vendedorId" value={vendedorId} />
          <AreaTexto
            etiqueta={`Entregar a ${nombre}`}
            name="codigos"
            rows={5}
            required
            maxLength={20000}
            placeholder="Uno por línea o separados por espacio o coma"
          />
        </FormAccion>
      ) : (
        <p className="aviso-atencion">Esta vendedora está inactiva: no se le pueden entregar piezas.</p>
      )}
      <FormAccion accion={accionRegresarAKazero} textoBoton="Regresar a Kazero" limpiarAlGuardar>
        <input type="hidden" name="vendedorId" value={vendedorId} />
        <AreaTexto
          etiqueta="Regresar a Kazero"
          name="codigos"
          rows={5}
          required
          maxLength={20000}
          placeholder="Uno por línea o separados por espacio o coma"
        />
      </FormAccion>
    </div>
  );
}
