import { MarcoAcceso } from '../MarcoAcceso';
import { FormVerificar } from './FormVerificar';

export const metadata = { title: 'Verificación' };

export default function PaginaVerificar() {
  return (
    <MarcoAcceso>
      <h1 className="text-2xl font-semibold">Verificación en dos pasos</h1>
      <FormVerificar />
    </MarcoAcceso>
  );
}
