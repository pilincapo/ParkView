/**
 * Rutas de autenticación: registro con verificador, login, logout y Google OAuth.
 *
 * El registro/login reciben `verifier` — el resultado de PBKDF2-SHA256 hecho en
 * el navegador (ver comentario en auth.ts). El servidor no deriva nada.
 */

import type { Env, Usuario } from '../auth';
import {
  cookieDeSesion,
  cookieDeSesionVacia,
  crearSesion,
  destruirSesion,
  intercambiarCodigoGoogle,
  salDesdeEmail,
  urlAutorizacionGoogle,
} from '../auth';
import { ApiError, exigirUsuario, json, leerBody, manejar } from '../http';
import { usuarioDesdeRequest } from '../auth';

interface Credenciales {
  email: string;
  verifier: string;
  displayName?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// El verificador es base64 de 32 bytes = 44 caracteres con padding.
const VERIFIER_RE = /^[A-Za-z0-9+/]{43}=$/;

function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validarCredenciales(body: Credenciales): { email: string; verifier: string } {
  const email = normalizarEmail(body.email ?? '');
  if (!EMAIL_RE.test(email)) {
    throw new ApiError(400, 'invalid_email', 'Ingresá un correo válido');
  }
  if (!body.verifier || !VERIFIER_RE.test(body.verifier)) {
    throw new ApiError(400, 'invalid_verifier', 'Contraseña inválida');
  }
  return { email, verifier: body.verifier };
}

/** Crea (o reutiliza) el usuario a partir de un verificador de Google. */
async function usuarioDesdeGoogle(
  env: Env,
  info: { sub: string; email: string; name?: string }
): Promise<Usuario> {
  const email = normalizarEmail(info.email);
  const ahora = new Date().toISOString();

  const existente = await env.DB.prepare(
    `SELECT id, email, display_name, is_super FROM users
      WHERE email = ? OR google_sub = ? LIMIT 1`
  )
    .bind(email, info.sub)
    .first<{ id: string; email: string; display_name: string | null; is_super: number }>();

  if (existente) {
    // Vincula el sub de Google si el usuario se había registrado con contraseña.
    if (!existente.id) throw new ApiError(500, 'internal', 'Usuario inconsistente');
    await env.DB.prepare(
      `UPDATE users SET google_sub = ?, display_name = COALESCE(display_name, ?), updated_at = ?
        WHERE id = ?`
    )
      .bind(info.sub, info.name ?? null, ahora, existente.id)
      .run();

    return {
      id: existente.id,
      email: existente.email,
      displayName: existente.display_name,
      isSuper: existente.is_super === 1,
    };
  }

  const id = crypto.randomUUID();
  // El primer usuario de la instancia queda como super admin: arrancamos de cero
  // y no queremos dejar la cochera sin dueño.
  const hayUsuarios = await env.DB.prepare(`SELECT 1 AS n FROM users LIMIT 1`).first<{ n: number }>();
  const esPrimero = hayUsuarios === null;

  await env.DB.prepare(
    `INSERT INTO users (id, email, display_name, google_sub, is_super, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, email, info.name ?? null, info.sub, esPrimero ? 1 : 0, ahora, ahora)
    .run();

  return { id, email, displayName: info.name ?? null, isSuper: esPrimero };
}

export async function manejarAuth(
  env: Env,
  request: Request,
  url: URL
): Promise<Response> {
  const ruta = url.pathname.replace(/^\/api\/auth/, '');

  /* ---------------------------------------------------------------- registro */
  if (ruta === '/register' && request.method === 'POST') {
    return manejar(async () => {
      const body = await leerBody<Credenciales>(request);
      const { email, verifier } = validarCredenciales(body);

      const yaExiste = await env.DB.prepare(`SELECT 1 AS n FROM users WHERE email = ?`)
        .bind(email)
        .first<{ n: number }>();
      if (yaExiste) {
        throw new ApiError(409, 'email_taken', 'Ya existe una cuenta con ese correo');
      }

      const id = crypto.randomUUID();
      const ahora = new Date().toISOString();
      const hayUsuarios = await env.DB.prepare(`SELECT 1 AS n FROM users LIMIT 1`).first<{
        n: number;
      }>();
      const esPrimero = hayUsuarios === null;

      await env.DB.prepare(
        `INSERT INTO users (id, email, display_name, password_hash, is_super, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          id,
          email,
          body.displayName?.trim() || email.split('@')[0],
          verifier,
          esPrimero ? 1 : 0,
          ahora,
          ahora
        )
        .run();

      const token = await crearSesion(env, id, request);
      return json(
        {
          user: {
            id,
            email,
            displayName: body.displayName?.trim() || email.split('@')[0],
            isSuper: esPrimero,
          },
        },
        { status: 201, headers: { 'set-cookie': cookieDeSesion(token, url.protocol) } }
      );
    });
  }

  /* ------------------------------------------------------------------- login */
  if (ruta === '/login' && request.method === 'POST') {
    return manejar(async () => {
      const body = await leerBody<Credenciales>(request);
      const { email, verifier } = validarCredenciales(body);

      const usuario = await env.DB.prepare(
        `SELECT id, email, display_name, is_super, password_hash
           FROM users WHERE email = ? AND password_hash IS NOT NULL`
      )
        .bind(email)
        .first<{
          id: string;
          email: string;
          display_name: string | null;
          is_super: number;
          password_hash: string;
        }>();

      // Mensaje idéntico exista o no el correo: no revelamos cuentas.
      if (!usuario || usuario.password_hash !== verifier) {
        throw new ApiError(401, 'invalid_credentials', 'Credenciales incorrectas');
      }

      const token = await crearSesion(env, usuario.id, request);
      return json(
        {
          user: {
            id: usuario.id,
            email: usuario.email,
            displayName: usuario.display_name,
            isSuper: usuario.is_super === 1,
          },
        },
        { headers: { 'set-cookie': cookieDeSesion(token, url.protocol) } }
      );
    });
  }

  /* ----------------------------------------------------------------- logout */
  if (ruta === '/logout' && request.method === 'POST') {
    const cookie = request.headers.get('cookie') ?? '';
    const match = cookie.match(/(?:^|;\s*)cochera_session=([^;]+)/);
    if (match) await destruirSesion(env, match[1]);
    return new Response(null, {
      status: 204,
      headers: { 'set-cookie': cookieDeSesionVacia() },
    });
  }

  /* --------------------------------------------------------------------- me */
  if (ruta === '/me' && request.method === 'GET') {
    const usuario = await usuarioDesdeRequest(env, request);
    if (!usuario) return json({ user: null }, { status: 401 });
    return json({ user: usuario });
  }

  /* -------------------------------------------------------- google: inicio */
  if (ruta === '/google' && request.method === 'GET') {
    if (!env.GOOGLE_CLIENT_ID) {
      throw new ApiError(
        503,
        'google_not_configured',
        'Falta configurar GOOGLE_CLIENT_ID en el Worker'
      );
    }
    const state = crypto.randomUUID();
    return Response.redirect(urlAutorizacionGoogle(env, state), 302);
  }

  /* ------------------------------------------------------- google: callback */
  if (ruta === '/google/callback' && request.method === 'GET') {
    const code = url.searchParams.get('code');
    if (!code) {
      return Response.redirect(`${env.APP_URL}/?auth_error=missing_code`, 302);
    }

    try {
      const info = await intercambiarCodigoGoogle(env, code);
      if (!info.email || (info.email_verified === false)) {
        return Response.redirect(`${env.APP_URL}/?auth_error=unverified_email`, 302);
      }
      const usuario = await usuarioDesdeGoogle(env, info);
      const token = await crearSesion(env, usuario.id, request);
      // Response.redirect no acepta headers: se construye a mano para poder
      // setear la cookie de sesión en el mismo 302.
      return new Response(null, {
        status: 302,
        headers: {
          location: `${env.APP_URL}/`,
          'set-cookie': cookieDeSesion(token, url.protocol),
        },
      });
    } catch (error) {
      console.error('Fallo Google OAuth:', error);
      return Response.redirect(`${env.APP_URL}/?auth_error=oauth_failed`, 302);
    }
  }

  throw new ApiError(404, 'not_found', `Ruta de auth desconocida: ${request.method} ${ruta}`);
}

export { exigirUsuario };
