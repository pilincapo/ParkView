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
 *
 * ## Presupuesto (tier Free)
 *
 * Cada operador logged-in tiene **3 polls siempre activos** —cocheras, vehículos
 * en playa y abonos— y cada uno pega 4 requests/minuto a 15 s:
 *
 * ```
 * 3 polls × 240/día × 5 operadores =  3.600 requests/día   (3,6% de 100.000)
 * ~150 filas por poll × 1.800 polls  =  ~270.000 filas/día  (5,4% de 5M)
 * ```
 *
 * Historial y reportes **no tienen timer**: son datos históricos y la app ya
 * llama a `refetch()` después de cada mutación (`App.tsx`), así que con timer
 * sólo se pagaban lecturas idénticas cada 15 s. Se piden una vez al entrar a la
 * vista y otra vez cuando cambia un filtro, pasando `intervaloMs: 0`.
 *
 * Antes, con timer en las cinco vistas, la misma cuenta daba 115.200
 * requests/día (4 polls × 5 operadores) — por encima del límite Free — y el
 * historial solo, al traer 500 filas cada 15 s, quemaba 2,88M filas/día.
 *
 * ## Lo que el polling no garantiza
 *
 * Consistencia entre dos operadores no: esa tarea le toca al servidor. La
 * ocupación de un slot se resuelve con un índice UNIQUE parcial en D1, no con
 * el estado que ve el cliente.
 *
 * Al deshabilitarse (`enabled: false`) no hace requests, que es como se ahorró
 * el reporte o el historial cuando la vista no está visible.
 */
export interface OpcionesPoll {
  enabled?: boolean;
  /** 0 (o menos) = sin timer: se pide una vez al montar/cambiar deps. */
  intervaloMs?: number;
}

export function usePoll<T>(
  obtener: () => Promise<T>,
  deps: DependencyList,
  opciones: OpcionesPoll = {}
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
    // intervaloMs 0 = sin timer (datos históricos). Follow-up manual con refetch().
    const timer = intervaloMs > 0 ? setInterval(() => void traer(), intervaloMs) : null;

    return () => {
      vivo = false;
      if (timer !== null) clearInterval(timer);
      enVuelo.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervaloMs, tick, ...deps]);

  return { data, error, cargando, refetch };
}
