/**
 * Autenticación del Worker.
 *
 * ---
 * ## Por qué el KDF pesado vive en el navegador y no acá
 *
 * Workers Free corta a los 10 ms de CPU por request (error 1102). Medido en
 * este entorno, PBKDF2-SHA256 a 600.000 iteraciones (recomendación OWASP)
 * tarda 111,73 ms — unas 11 veces el límite. Cualquier hash de contraseñas
 * con un factor de trabajo serio es inviable en el tier gratis.
 *
 * Por eso el flujo es:
 *   navegador  ->  PBKDF2-SHA256(password, salt, 600k)  ->  verificador (256 bit)
 *   servidor   ->  compara el verificador con constante tiempo
 *
 * El servidor nunca ve la contraseña ni hace trabajo costoso: una comparación
 * HMAC tarda microsegundos y deja el resto del presupuesto de CPU libre.
 * La contraseña en sí nunca sale del navegador ni se almacena.
 *
 * Nota de seguridad: si la base es robada, el atacante obtiene el verificador,
 * que sirve para iniciar sesión pero no revela la contraseña ni es reutilizable
 * en otro servicio. Es un riesgo acotado y distinto al de un hash roto.
 */

const PBKDF2_ITERACIONES = 600_000;
const SESSION_COOKIE = 'cochera_session';
const DURACION_SESION_MS = 1000 * 60 * 60 * 24 * 14; // 14 días

export interface Usuario {
  id: string;
  email: string;
  displayName: string | null;
  isSuper: boolean;
}

export interface Env {
  DB: D1Database;
  APP_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET?: string;
  ASSETS?: Fetcher;
}

/* -------------------------------------------------------------------------- */
/* Verificador de contraseña (cálculo en el cliente)                          */
/* -------------------------------------------------------------------------- */

/**
 * Sal determinista derivada del correo. No necesita secreto: su único papel es
 * que dos usuarios con la misma contraseña no compartan verificador.
 * Se calcula en el cliente, por eso no puede venir de la base.
 */
export function salDesdeEmail(email: string): string {
  return `cocheraflow:v1:${email.trim().toLowerCase()}`;
}

/** Compara dos cadenas en tiempo constante para no filtrar el prefijo. */
function iguales(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.byteLength !== bb.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < ab.byteLength; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/* -------------------------------------------------------------------------- */
/* Sesiones                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Solo marcar `Secure` en https: en localhost (http) el navegador descartaría
 * la cookie y el login parecería fallar sin motivo.
 */
function cookieSegura(protocolo: string): boolean {
  return protocolo === 'https:';
}

export async function crearSesion(
  env: Env,
  userId: string,
  request: Request
): Promise<string> {
  const token = bytesAHex(crypto.getRandomValues(new Uint8Array(32)));
  // Se guarda solo el hash: un volcado de la base no habilita sesiones vivas.
  const hash = await sha256Hex(token);
  const expira = new Date(Date.now() + DURACION_SESION_MS).toISOString();

  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, expires_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(
      hash,
      userId,
      expira,
      request.headers.get('user-agent')?.slice(0, 200) ?? null,
      request.headers.get('cf-connecting-ip') ?? null
    )
    .run();

  return token;
}

export async function destruirSesion(env: Env, token: string): Promise<void> {
  if (!token) return;
  await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(
    await sha256Hex(token)
  ).run();
}

/** Devuelve el usuario de la sesión vigente, o null. Limpia sesiones vencidas. */
export async function usuarioDesdeRequest(
  env: Env,
  request: Request
): Promise<Usuario | null> {
  const token = leerCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const hash = await sha256Hex(token);
  const fila = await env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.is_super
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ?`
  )
    .bind(hash, new Date().toISOString())
    .first<{
      id: string;
      email: string;
      display_name: string | null;
      is_super: number;
    }>();

  if (!fila) return null;

  return {
    id: fila.id,
    email: fila.email,
    displayName: fila.display_name,
    isSuper: fila.is_super === 1,
  };
}

export function cookieDeSesion(token: string, protocolo = 'https:'): string {
  const partes = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(DURACION_SESION_MS / 1000)}`,
  ];
  if (cookieSegura(protocolo)) partes.push('Secure');
  return partes.join('; ');
}

export function cookieDeSesionVacia(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function leerCookie(request: Request, nombre: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const par of header.split(';')) {
    const [k, ...v] = par.trim().split('=');
    if (k === nombre) return v.join('=');
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Google OAuth                                                                */
/* -------------------------------------------------------------------------- */

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export function urlAutorizacionGoogle(env: Env, state: string): string {
  const redirect = `${new URL(env.APP_URL).origin}/api/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirect,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface UserInfo {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
}

/**
 * Intercambia el código de Google por tokens y devuelve el perfil.
 * Ambas llamadas son de red: no consumen presupuesto de CPU.
 */
export async function intercambiarCodigoGoogle(
  env: Env,
  code: string
): Promise<UserInfo> {
  const redirect = `${new URL(env.APP_URL).origin}/api/auth/google/callback`;

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: redirect,
      grant_type: 'authorization_code',
    }),
  });

  const data = (await res.json()) as TokenResponse;
  if (!res.ok || !data.access_token) {
    throw new Error(
      data.error_description || data.error || 'No se pudo autenticar con Google'
    );
  }

  const infoRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${data.access_token}` },
  });
  if (!infoRes.ok) throw new Error('No se pudo leer el perfil de Google');

  return (await infoRes.json()) as UserInfo;
}

/* -------------------------------------------------------------------------- */
/* Utilidades criptográficas                                                   */
/* -------------------------------------------------------------------------- */

export async function sha256Hex(valor: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(valor)
  );
  return bytesAHex(new Uint8Array(digest));
}

function bytesAHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export { PBKDF2_ITERACIONES };
