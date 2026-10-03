/**
 * Rutas de establecimientos: cocheras, tarifas y miembros.
 *
 * El control de acceso acá es explícito por rol (owner / manager / operator),
 * en lugar de validar solo la forma del documento como hacían las reglas de
 * Firestore. Un operador no puede ni cambiar tarifas ni tocar la lista de
 * miembros ni reasignar el dueño.
 */

import type { Env, Usuario } from '../auth';
import {
  ApiError,
  exigirAcceso,
  exigirGestion,
  exigirUsuario,
  json,
  leerBody,
  manejar,
} from '../http';
import { DEFAULT_TARIFAS, type TarifaSettings } from '../../shared/pricing';

interface FilaEstablishment {
  id: string;
  name: string;
  address: string;
  owner_id: string;
  settings: string;
}

interface MiembroRow {
  user_id: string;
  role: 'owner' | 'manager' | 'operator';
  email: string;
  display_name: string | null;
}

function parseSettings(bruto: string): TarifaSettings {
  try {
    const parsed = JSON.parse(bruto) as Partial<TarifaSettings>;
    return { ...DEFAULT_TARIFAS, ...parsed };
  } catch {
    return { ...DEFAULT_TARIFAS };
  }
}

function serializar(fila: FilaEstablishment, rol: string) {
  return {
    id: fila.id,
    name: fila.name,
    address: fila.address,
    ownerId: fila.owner_id,
    role: rol,
    settings: parseSettings(fila.settings),
  };
}

/** Valida y normaliza un parche de tarifas. Nada de NaN ni negativos. */
function validarSettings(parcial: Partial<TarifaSettings>): Record<string, number> {
  const campos = [
    'hourlyRate',
    'carHalfHourRate',
    'motoDailyRate',
    'motoHourlyRate',
    'monthlyRate',
    'motoMonthlyRate',
    'carSlots',
    'motoSlots',
    'totalSlots',
  ] as const;

  const salida: Record<string, number> = {};
  for (const campo of campos) {
    const valor = parcial[campo];
    if (valor === undefined) continue;
    if (typeof valor !== 'number' || !Number.isFinite(valor)) {
      throw new ApiError(400, 'invalid_settings', `Valor inválido en ${campo}`);
    }
    if (valor < 0) {
      throw new ApiError(400, 'invalid_settings', `${campo} no puede ser negativo`);
    }
    salida[campo] = Math.round(valor);
  }
  return salida;
}

async function listarEstablishments(
  env: Env,
  usuario: Usuario
): Promise<Response> {
  const filas = await env.DB.prepare(
    usuario.isSuper
      ? `SELECT * FROM establishments ORDER BY name`
      : `SELECT e.* FROM establishments e
           JOIN establishment_members m ON m.establishment_id = e.id
          WHERE m.user_id = ?
          ORDER BY e.name`
  )
    .bind(...(usuario.isSuper ? [] : [usuario.id]))
    .all<FilaEstablishment>();

  const resultados = await Promise.all(
    filas.results.map(async (fila) => {
      let rol = 'owner';
      if (!usuario.isSuper) {
        const r = await env.DB.prepare(
          `SELECT role FROM establishment_members
            WHERE establishment_id = ? AND user_id = ?`
        )
          .bind(fila.id, usuario.id)
          .first<{ role: string }>();
        rol = r?.role ?? 'operator';
      }
      return serializar(fila, rol);
    })
  );

  return json({ establishments: resultados });
}

export async function manejarEstablishments(
  env: Env,
  request: Request,
  url: URL
): Promise<Response> {
  const usuario = await exigirUsuario(env, request);
  const resto = url.pathname.replace(/^\/api\/establishments/, '');
  const metodo = request.method;

  /* ------------------------------------------------------------------ lista */
  if (resto === '' && metodo === 'GET') {
    return manejar(() => listarEstablishments(env, usuario));
  }

  /* ----------------------------------------------------------------- crea */
  if (resto === '' && metodo === 'POST') {
    return manejar(async () => {
      const body = await leerBody<{ name?: string; address?: string }>(request);
      const name = (body.name ?? '').trim();
      const address = (body.address ?? '').trim();
      if (!name) throw new ApiError(400, 'invalid_name', 'Falta el nombre de la cochera');

      // Arrancamos de cero: cualquiera autenticado puede crear su cochera.
      const id = crypto.randomUUID();
      const ahora = new Date().toISOString();
      const settings: TarifaSettings = { ...DEFAULT_TARIFAS };

      await env.DB.prepare(
        `INSERT INTO establishments (id, name, address, owner_id, settings, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(id, name, address, usuario.id, JSON.stringify(settings), ahora, ahora)
        .run();

      await env.DB.prepare(
        `INSERT INTO establishment_members (establishment_id, user_id, role, added_at)
         VALUES (?, ?, 'owner', ?)`
      )
        .bind(id, usuario.id, ahora)
        .run();

      return json({ establishment: { id, name, address, ownerId: usuario.id, role: 'owner', settings } }, { status: 201 });
    });
  }

  /* ----------------------------------------------------------- detalle/patch */
  const detalle = resto.match(/^\/([^/]+)$/);
  if (detalle && metodo === 'GET') {
    return manejar(async () => {
      const id = detalle[1];
      const rol = await exigirAcceso(env, usuario, id);
      const fila = await env.DB.prepare(`SELECT * FROM establishments WHERE id = ?`)
        .bind(id)
        .first<FilaEstablishment>();
      if (!fila) throw new ApiError(404, 'not_found', 'Cochera inexistente');
      return json({ establishment: serializar(fila, rol) });
    });
  }

  if (detalle && metodo === 'PATCH') {
    return manejar(async () => {
      const id = detalle[1];
      await exigirGestion(env, usuario, id); // operador NO puede

      const body = await leerBody<{
        name?: string;
        address?: string;
        settings?: Partial<TarifaSettings>;
      }>(request);

      const actualizaciones: string[] = [];
      const params: unknown[] = [];

      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name) throw new ApiError(400, 'invalid_name', 'El nombre no puede estar vacío');
        actualizaciones.push('name = ?');
        params.push(name);
      }
      if (body.address !== undefined) {
        actualizaciones.push('address = ?');
        params.push(String(body.address).trim());
      }
      if (body.settings !== undefined) {
        const existente = await env.DB.prepare(
          `SELECT settings FROM establishments WHERE id = ?`
        )
          .bind(id)
          .first<{ settings: string }>();
        if (!existente) throw new ApiError(404, 'not_found', 'Cochera inexistente');

        const base = parseSettings(existente.settings);
        const parche = validarSettings(body.settings);
        const nuevo = { ...base, ...parche };
        // totalSlots siempre es coherente con las dos columnas de capacidad.
        if (parche.carSlots !== undefined || parche.motoSlots !== undefined) {
          nuevo.totalSlots = (nuevo.carSlots ?? 0) + (nuevo.motoSlots ?? 0);
        }
        actualizaciones.push('settings = ?');
        params.push(JSON.stringify(nuevo));
      }

      if (actualizaciones.length === 0) {
        throw new ApiError(400, 'empty_patch', 'No hay cambios para aplicar');
      }

      actualizaciones.push('updated_at = ?');
      params.push(new Date().toISOString());

      await env.DB.prepare(
        `UPDATE establishments SET ${actualizaciones.join(', ')} WHERE id = ?`
      )
        .bind(...params, id)
        .run();

      const fila = await env.DB.prepare(`SELECT * FROM establishments WHERE id = ?`)
        .bind(id)
        .first<FilaEstablishment>();
      const rol = await exigirAcceso(env, usuario, id);
      return json({ establishment: fila ? serializar(fila, rol) : null });
    });
  }

  /* --------------------------------------------------------------- miembros */
  const miembros = resto.match(/^\/([^/]+)\/members$/);
  if (miembros && metodo === 'GET') {
    return manejar(async () => {
      const id = miembros[1];
      await exigirAcceso(env, usuario, id);

      const filas = await env.DB.prepare(
        `SELECT m.user_id, m.role, u.email, u.display_name
           FROM establishment_members m
           JOIN users u ON u.id = m.user_id
          WHERE m.establishment_id = ?
          ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, u.email`
      )
        .bind(id)
        .all<MiembroRow>();

      return json({
        members: filas.results.map((r) => ({
          userId: r.user_id,
          role: r.role,
          email: r.email,
          displayName: r.display_name,
        })),
      });
    });
  }

  if (miembros && metodo === 'POST') {
    return manejar(async () => {
      const id = miembros[1];
      await exigirGestion(env, usuario, id);

      const body = await leerBody<{ email?: string; role?: string }>(request);
      const email = (body.email ?? '').trim().toLowerCase();
      if (!email) throw new ApiError(400, 'invalid_email', 'Falta el correo');

      const objetivo = await env.DB.prepare(
        `SELECT id FROM users WHERE email = ?`
      )
        .bind(email)
        .first<{ id: string }>();
      if (!objetivo) {
        throw new ApiError(404, 'user_not_found', 'No existe un usuario con ese correo. Debe registrarse primero.');
      }

      const rol = body.role === 'manager' ? 'manager' : 'operator';
      await env.DB.prepare(
        `INSERT OR IGNORE INTO establishment_members (establishment_id, user_id, role, added_at)
         VALUES (?, ?, ?, ?)`
      )
        .bind(id, objetivo.id, rol, new Date().toISOString())
        .run();

      return json({ ok: true }, { status: 201 });
    });
  }

  const quitar = resto.match(/^\/([^/]+)\/members\/([^/]+)$/);
  if (quitar && metodo === 'DELETE') {
    return manejar(async () => {
      const [id, userId] = [quitar[1], quitar[2]];
      await exigirGestion(env, usuario, id);

      if (userId === usuario.id) {
        throw new ApiError(400, 'cannot_remove_self', 'No podés quitarte a vos mismo');
      }

      // Nunca dejar la cochera sin dueño.
      const meta = await env.DB.prepare(
        `SELECT owner_id FROM establishments WHERE id = ?`
      )
        .bind(id)
        .first<{ owner_id: string }>();
      if (meta?.owner_id === userId) {
        throw new ApiError(400, 'cannot_remove_owner', 'No se puede quitar al propietario');
      }

      await env.DB.prepare(
        `DELETE FROM establishment_members WHERE establishment_id = ? AND user_id = ?`
      )
        .bind(id, userId)
        .run();

      return json({ ok: true });
    });
  }

  throw new ApiError(404, 'not_found', `Ruta desconocida: ${metodo} ${url.pathname}`);
}
