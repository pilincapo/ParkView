/**
 * Router del Worker de CocheraFlow.
 *
 * Estructura de rutas:
 *   /api/auth/*          registro, login, logout, sesión, Google OAuth
 *   /api/establishments  cocheras, tarifas, miembros
 *   /api/vehicles        ingresos, salidas, historial, reportes
 *   /api/passes          abonos mensuales
 *
 * Todo lo que no es /api/* lo sirven los static assets de Vite (SPA).
 */

import type { Env } from './auth';
import { manejarAuth } from './routes/auth';
import { manejarEstablishments } from './routes/establishments';
import { manejarVehicles } from './routes/vehicles';
import { manejarPasses } from './routes/passes';
import { ApiError, json, manejar } from './http';

export { type Env };

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Preflight: las cookies no necesitan CORS (same-origin), pero por si acaso.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname.startsWith('/api/')) {
      const respuesta = await enrutarApi(request, env, url);
      // No pisar headers propios de la respuesta (set-cookie, status).
      const headers = new Headers(respuesta.headers);
      for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
      return new Response(respuesta.body, {
        status: respuesta.status,
        statusText: respuesta.statusText,
        headers,
      });
    }

    // SPA: deja que el plugin de Vite/Workers resuelva los static assets.
    return assetsFetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

async function enrutarApi(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  const { pathname } = url;

  try {
    if (pathname.startsWith('/api/auth/')) {
      return await manejarAuth(env, request, url);
    }
    if (pathname === '/api/establishments' || pathname.startsWith('/api/establishments/')) {
      return await manejarEstablishments(env, request, url);
    }
    if (pathname === '/api/vehicles' || pathname.startsWith('/api/vehicles/')) {
      return await manejarVehicles(env, request, url);
    }
    if (pathname === '/api/passes' || pathname.startsWith('/api/passes/')) {
      return await manejarPasses(env, request, url);
    }
    if (pathname === '/api/health') {
      return json({ ok: true, now: new Date().toISOString() });
    }
    throw new ApiError(404, 'not_found', `Ruta desconocida: ${request.method} ${pathname}`);
  } catch (error) {
    return await manejar(() => Promise.reject(error));
  }
}

/**
 * Los static assets los sirve el plugin de @cloudflare/vite-plugin.
 * Se obtiene con el binding que inyecta el propio plugin al hacer build/dev.
 */
async function assetsFetch(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const binding = (env as unknown as { ASSETS?: Fetcher }).ASSETS;
  if (binding) return binding.fetch(request);

  // Fallback para entornos sin binding de assets (tests, etc).
  return new Response('assets binding no disponible', { status: 404 });
}
