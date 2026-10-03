import type { Env, Usuario } from './auth';
import { usuarioDesdeRequest } from './auth';

/** Error de negocio con status y código para devolverle al cliente. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers ?? {}) },
    ...init,
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

/** Envuelve el handler para que una ApiError se traduzca en su status. */
export async function manejar(
  fn: () => Promise<Response>
): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiError) {
      return json({ error: { code: error.code, message: error.message } }, { status: error.status });
    }
    console.error('Error no manejado:', error);
    const mensaje = error instanceof Error ? error.message : 'Error interno';
    return json({ error: { code: 'internal', message: mensaje } }, { status: 500 });
  }
}

export async function leerBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ApiError(400, 'invalid_json', 'El cuerpo de la petición no es JSON válido');
  }
}

/** Exige sesión; si no hay, 401 con código que el cliente usa para desloguear. */
export async function exigirUsuario(env: Env, request: Request): Promise<Usuario> {
  const usuario = await usuarioDesdeRequest(env, request);
  if (!usuario) {
    throw new ApiError(401, 'unauthenticated', 'Sesión expirada o inexistente');
  }
  return usuario;
}

/**
 * Devuelve el rol del usuario en una cochera, o null si no tiene acceso.
 * El super admin entra a todas.
 */
export async function rolEnEstablecimiento(
  env: Env,
  usuario: Usuario,
  establishmentId: string
): Promise<'owner' | 'manager' | 'operator' | null> {
  if (usuario.isSuper) return 'owner';

  const fila = await env.DB.prepare(
    `SELECT role FROM establishment_members
      WHERE establishment_id = ? AND user_id = ?`
  )
    .bind(establishmentId, usuario.id)
    .first<{ role: 'owner' | 'manager' | 'operator' }>();

  return fila?.role ?? null;
}

/** Exige acceso a la cochera; 403 si no es miembro. */
export async function exigirAcceso(
  env: Env,
  usuario: Usuario,
  establishmentId: string
): Promise<'owner' | 'manager' | 'operator'> {
  const rol = await rolEnEstablecimiento(env, usuario, establishmentId);
  if (!rol) {
    throw new ApiError(403, 'forbidden', 'No tenés acceso a esta cochera');
  }
  return rol;
}

/** Solo dueño o manager (o super admin) pueden escribir tarifas/miembros. */
export async function exigirGestion(
  env: Env,
  usuario: Usuario,
  establishmentId: string
): Promise<'owner' | 'manager'> {
  const rol = await exigirAcceso(env, usuario, establishmentId);
  if (rol === 'operator') {
    throw new ApiError(403, 'forbidden', 'Tu rol no permite esta operación');
  }
  return rol;
}
