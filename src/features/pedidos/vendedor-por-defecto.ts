/** D-1: el habitual del cliente si sigue activo; si no, el primero de tipo casa; si no, el primero. */
export function vendedorPorDefecto(
  vendedores: readonly { id: string; tipo: string }[],
  cliente: { vendedorHabitualId: string | null } | null,
): string {
  const habitual = cliente?.vendedorHabitualId;
  if (habitual && vendedores.some((v) => v.id === habitual)) return habitual;
  return (vendedores.find((v) => v.tipo === 'casa') ?? vendedores[0])?.id ?? '';
}
