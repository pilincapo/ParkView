import { OperationType, type DataErrorInfo } from '../types';

/**
 * Manejo de errores de datos.
 *
 * Antes hacía `throw`, lo que dentro de los callbacks de `onSnapshot` producía
 * un promise rejection sin catch y tumbaba la vista entera (un fallo de permisos
 * o un índice faltante te dejaba la pantalla en blanco). Ahora el error se
 * loguea y se devuelve para que la vista decida qué mostrar.
 *
 * @returns mensaje apto para la UI, o null si no hay nada útil que mostrar.
 */
export function handleDataError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): string | null {
  const errInfo: DataErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
  };

  console.error('Error de datos:', JSON.stringify(errInfo));

  if (error instanceof Error && /permission|forbidden/i.test(error.message)) {
    return 'No tenés permisos para esta operación';
  }
  if (error instanceof Error && /network|failed to fetch/i.test(error.message)) {
    return 'Sin conexión. Reintentando…';
  }
  return null;
}
