import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

export interface PollEstado<T> {
  data: T | null;
  error: string | null;
  cargando: boolean;
  refetch: () => void;
}

/**
 * Sustituye a los `onSnapshot` de Firestore.
 *
 * D1 no tiene realtime, así que cada suscripción pasa a ser un fetch periódico.
 * El intervalo por defecto es de 15 s: con 5 operadores eso son ~28.800
 * requests/día (29% del límite de 100.000 del plan Free) y ~1,15M filas leídas
 * (23% de 5M).
 *
 * Lo que el polling *no* garantiza es consistencia entre dos operadores, y esa
 * tarea le toca al servidor: la ocupación de un slot se resuelve con un índice
 * UNIQUE parcial en D1, no con el estado que ve el cliente.
 *
 * Al deshabilitarse (`enabled: false`) no hace requests, que es como se ahorró
 * el reporte o el historial cuando la vista no está visible.
 */
export function usePoll<T>(
  obtener: () => Promise<T>,
  deps: DependencyList,
  opciones: { enabled?: boolean; intervaloMs?: number } = {}
): PollEstado<T> {
  const { enabled = true, intervaloMs = 15_000 } = opciones;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [tick, setTick] = useState(0);

  // Ref para no reiniciar el timer cuando la función cambia de identidad en
  // cada render (lo cual pasaría si estuviera en el array de dependencias).
  const obtenerRef = useRef(obtener);
  obtenerRef.current = obtener;

  const enVuelo = useRef(false);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!enabled) return;

    let vivo = true;

    const traer = async () => {
      // Si una petición sigue en vuelo, no lanzar otra: evita que una respuesta
      // lenta de la anterior pise a la más reciente.
      if (enVuelo.current) return;
      enVuelo.current = true;
      try {
        const resultado = await obtenerRef.current();
        if (!vivo) return;
        setData(resultado);
        setError(null);
      } catch (err) {
        if (!vivo) return;
        // No lanzar: el error queda en estado y la vista sigue viva.
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (vivo) {
          enVuelo.current = false;
          setCargando(false);
        }
      }
    };

    void traer();
    const timer = setInterval(() => void traer(), intervaloMs);

    return () => {
      vivo = false;
      clearInterval(timer);
      enVuelo.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervaloMs, tick, ...deps]);

  return { data, error, cargando, refetch };
}
