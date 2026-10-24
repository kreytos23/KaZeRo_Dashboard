'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EVENTO_INDICE_SUCIO } from './eventos';
import type { IndiceBusqueda } from './tipos';

// Red de seguridad por si algún formulario olvida llamar a marcarIndiceSucio().
const TTL_INDICE_MS = 5 * 60 * 1000;
export type Estado = 'inactivo' | 'cargando' | 'listo' | 'sin_sesion' | 'error';

function esIndice(v: unknown): v is IndiceBusqueda {
  if (typeof v !== 'object' || v === null) return false;
  const i = v as Partial<IndiceBusqueda>;
  return (
    i.v === 4 &&
    Array.isArray(i.piezas) &&
    Array.isArray(i.clientes) &&
    Array.isArray(i.vendedores) &&
    Array.isArray(i.pedidos)
  );
}

/**
 * Índice de búsqueda compartido por el buscador global y los selectores: carga perezosa, TTL, recarga con el
 * evento "índice sucio" y 401 → /login.
 */
export function useIndiceBusqueda(): {
  indice: IndiceBusqueda | null;
  estado: Estado;
  asegurarCarga: () => void;
} {
  const router = useRouter();
  const estadoRef = useRef<Estado>('inactivo');
  const peticion = useRef(0);
  const cargadoEn = useRef(0);
  const [estado, setEstado] = useState<Estado>('inactivo');
  const [indice, setIndice] = useState<IndiceBusqueda | null>(null);

  const cambiarEstado = useCallback((e: Estado) => {
    estadoRef.current = e;
    setEstado(e);
  }, []);

  const cargar = useCallback(async () => {
    const mia = ++peticion.current;
    cambiarEstado('cargando');
    try {
      const r = await fetch('/api/busqueda/indice', { cache: 'no-store' });
      if (mia !== peticion.current) return; // llegó una carga más reciente
      if (r.status === 401) {
        setIndice(null);
        cambiarEstado('sin_sesion');
        router.replace('/login');
        return;
      }
      if (!r.ok) {
        cambiarEstado('error');
        return;
      }
      const datos: unknown = await r.json();
      if (mia !== peticion.current) return;
      if (!esIndice(datos)) {
        cambiarEstado('error');
        return;
      }
      setIndice(datos);
      cargadoEn.current = Date.now();
      cambiarEstado('listo');
    } catch {
      if (mia === peticion.current) cambiarEstado('error');
    }
  }, [cambiarEstado, router]);

  // Carga perezosa: al enfocar el campo o al pulsar `/` por primera vez; después, solo si el índice caducó.
  const asegurarCarga = useCallback(() => {
    const e = estadoRef.current;
    if (e === 'inactivo' || e === 'error') void cargar();
    else if (e === 'listo' && Date.now() - cargadoEn.current > TTL_INDICE_MS) void cargar();
  }, [cargar]);

  // Un formulario avisó que guardó: si ya se había cargado, se recarga; si no, la próxima carga ya lo trae.
  useEffect(() => {
    const sucio = () => {
      if (estadoRef.current !== 'inactivo') void cargar();
    };
    window.addEventListener(EVENTO_INDICE_SUCIO, sucio);
    return () => window.removeEventListener(EVENTO_INDICE_SUCIO, sucio);
  }, [cargar]);

  return { indice, estado, asegurarCarga };
}
