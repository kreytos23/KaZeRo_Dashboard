import { describe, expect, it, vi } from 'vitest';
import { unaALaVez } from '@/features/ui/una-a-la-vez';

describe('unaALaVez', () => {
  it('dos llamadas iguales en el mismo tick ejecutan una sola vez y comparten el resultado', async () => {
    const fn = vi.fn(async (n: string) => ({ id: n }));
    const g = unaALaVez(fn);
    const [a, b] = await Promise.all([g('Ana'), g('Ana')]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });
  it('argumentos distintos no se unen', async () => {
    const fn = vi.fn(async (n: string) => n);
    const g = unaALaVez(fn);
    await Promise.all([g('Ana'), g('Bea')]);
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it('al terminar (con éxito o error) una llamada nueva vuelve a ejecutar', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue('ok');
    const g = unaALaVez(fn);
    await expect(g('Ana')).rejects.toThrow('x');
    await expect(g('Ana')).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
