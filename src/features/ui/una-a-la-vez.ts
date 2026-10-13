/**
 * Envuelve una función asíncrona para que una llamada idéntica (mismos argumentos) mientras otra sigue en vuelo
 * comparta su promesa en vez de repetir el efecto. Un doble clic o Enter repetido no crea dos registros. Se
 * decide de forma síncrona (un Map, no estado de React), así que dos eventos en el mismo tick también se unen.
 */
export function unaALaVez<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  const enVuelo = new Map<string, Promise<R>>();
  return (...args: A) => {
    const clave = JSON.stringify(args);
    const previa = enVuelo.get(clave);
    if (previa) return previa;
    const p = Promise.resolve()
      .then(() => fn(...args))
      .finally(() => enVuelo.delete(clave));
    enVuelo.set(clave, p);
    return p;
  };
}
