import { describe, expect, it } from 'vitest';
import { trabajadoresDisponibles, trabajadoresPedidos } from '../../scripts/lib/ramas-paralelas';

describe('trabajadoresDisponibles', () => {
  it('da los pedidos si caben, dejando una rama libre', () => {
    expect(trabajadoresDisponibles(3, 2)).toBe(3); // 2 + 3 = 5 de 10
    expect(trabajadoresDisponibles(3, 6)).toBe(3); // 6 + 3 = 9, queda 1 libre
  });
  it('baja los workers cuando el proyecto está cerca del límite', () => {
    expect(trabajadoresDisponibles(3, 7)).toBe(2);
    expect(trabajadoresDisponibles(3, 8)).toBe(1);
  });
  it('0 cuando no cabe ninguna (o el conteo ya rebasa el límite)', () => {
    expect(trabajadoresDisponibles(3, 9)).toBe(0);
    expect(trabajadoresDisponibles(3, 15)).toBe(0);
  });
  it('respeta un límite distinto (otro plan)', () => {
    expect(trabajadoresDisponibles(3, 2, 20)).toBe(3);
    expect(trabajadoresDisponibles(3, 2, 4)).toBe(1);
  });
});

describe('trabajadoresPedidos', () => {
  it('lee un entero ≥ 1 y si no, usa 3', () => {
    expect(trabajadoresPedidos('5')).toBe(5);
    expect(trabajadoresPedidos(undefined)).toBe(3);
    expect(trabajadoresPedidos('0')).toBe(3);
    expect(trabajadoresPedidos('x')).toBe(3);
    expect(trabajadoresPedidos('1.5')).toBe(3);
  });
});
