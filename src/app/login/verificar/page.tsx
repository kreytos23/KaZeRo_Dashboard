import { FormVerificar } from './FormVerificar';

export default function PaginaVerificar() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold">Verificación en dos pasos</h1>
      <FormVerificar />
    </main>
  );
}
