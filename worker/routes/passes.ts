/**
 * Rutas de abonos mensuales.
 *
 * La caducidad se decide en la base (`end_date >= now`), no confiando en que
 * alguien marque el estado a mano: antes un abono vencido seguía liberando
 * ingreso gratis mientras su `status` siguiera en 'active'.
 */

import type { Env } from '../auth';
import { ApiError, exigirAcceso, exigirUsuario, json, leerBody, manejar } from '../http';

interface FilaPass {
  id: string;
  establishment_id: string;
  plate: string;
  vehicle_type: 'car' | 'motorcycle';
  start_date: string;
  end_date: string;
  amount: number;
  status: 'active' | 'expired';
  owner_id: string;
}

function serializar(p: FilaPass) {
  return {
    id: p.id,
    establishmentId: p.establishment_id,
    plate: p.plate,
    vehicleType: p.vehicle_type,
    startDate: p.start_date,
    endDate: p.end_date,
    amount: p.amount,
    status: p.status,
    ownerId: p.owner_id,
  };
}

/** Un abono está vigente si está activo y su vencimiento no pasó. */
function vigente(p: FilaPass, ahoraISO: string): boolean {
  return p.status === 'active' && p.end_date >= ahoraISO;
}

export async function manejarPasses(
  env: Env,
  request: Request,
  url: URL
): Promise<Response> {
  const usuario = await exigirUsuario(env, request);
  const resto = url.pathname.replace(/^\/api\/passes/, '');
  const metodo = request.method;

  /* ------------------------------------------------------------------ lista */
  if (resto === '/list' && metodo === 'GET') {
    return manejar(async () => {
      const establishmentId = url.searchParams.get('establishmentId');
      if (!establishmentId) throw new ApiError(400, 'missing_param', 'Falta establishmentId');
      await exigirAcceso(env, usuario, establishmentId);

      const ahora = new Date().toISOString();
      const filas = await env.DB.prepare(
        `SELECT * FROM monthly_passes
          WHERE establishment_id = ? AND status = 'active' AND end_date >= ?
          ORDER BY end_date DESC`
      )
        .bind(establishmentId, ahora)
        .all<FilaPass>();

      return json({ passes: filas.results.map(serializar) });
    });
  }

  /* ------------------------------------------------------------------ crea */
  if (resto === '' && metodo === 'POST') {
    return manejar(async () => {
      const body = await leerBody<{
        establishmentId?: string;
        plate?: string;
        vehicleType?: 'car' | 'motorcycle';
        amount?: number;
        months?: number;
      }>(request);

      if (!body.establishmentId) throw new ApiError(400, 'missing_param', 'Falta establishmentId');
      await exigirAcceso(env, usuario, body.establishmentId);

      const plate = (body.plate ?? '').trim().toUpperCase();
      if (plate.length < 6 || plate.length > 8) {
        throw new ApiError(400, 'invalid_plate', 'La patente debe tener entre 6 y 8 caracteres');
      }
      if (body.vehicleType !== 'car' && body.vehicleType !== 'motorcycle') {
        throw new ApiError(400, 'invalid_vehicle_type', 'Tipo de vehículo inválido');
      }
      const amount = Math.max(0, Math.round(Number(body.amount) || 0));
      const meses = Math.min(Math.max(Math.round(Number(body.months) || 1), 1), 24);

      const duplicado = await env.DB.prepare(
        `SELECT id FROM monthly_passes
          WHERE establishment_id = ? AND plate = ? AND status = 'active' AND end_date >= ?`
      )
        .bind(body.establishmentId, plate, new Date().toISOString())
        .first<{ id: string }>();
      if (duplicado) {
        throw new ApiError(409, 'pass_exists', `La patente ${plate} ya tiene un abono vigente`);
      }

      const ahora = new Date();
      const fin = new Date(ahora);
      fin.setMonth(fin.getMonth() + meses);

      const id = crypto.randomUUID();
      try {
        await env.DB.prepare(
          `INSERT INTO monthly_passes
             (id, establishment_id, plate, vehicle_type, start_date, end_date,
              amount, status, owner_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
        )
          .bind(
            id,
            body.establishmentId,
            plate,
            body.vehicleType,
            ahora.toISOString(),
            fin.toISOString(),
            amount,
            usuario.id,
            ahora.toISOString(),
            ahora.toISOString()
          )
          .run();
      } catch (error) {
        const mensaje = error instanceof Error ? error.message : String(error);
        // D1 reporta las columnas involucradas, no el nombre del índice.
        if (mensaje.includes('UNIQUE constraint failed: monthly_passes.establishment_id, monthly_passes.plate')) {
          throw new ApiError(409, 'pass_exists', `La patente ${plate} ya tiene un abono vigente`);
        }
        throw error;
      }

      const fila = await env.DB.prepare(`SELECT * FROM monthly_passes WHERE id = ?`)
        .bind(id)
        .first<FilaPass>();
      return json({ pass: fila ? serializar(fila) : null }, { status: 201 });
    });
  }

  /* -------------------------------------------------------------- renueva */
  const renueva = resto.match(/^\/([^/]+)\/renew$/);
  if (renueva && metodo === 'POST') {
    return manejar(async () => {
      const passId = renueva[1];
      const body = await leerBody<{ months?: number }>(request).catch(() => ({ months: 1 }));

      const fila = await env.DB.prepare(`SELECT * FROM monthly_passes WHERE id = ?`)
        .bind(passId)
        .first<FilaPass>();
      if (!fila) throw new ApiError(404, 'not_found', 'Abono inexistente');

      await exigirAcceso(env, usuario, fila.establishment_id);

      const meses = Math.min(Math.max(Math.round(Number(body.months) || 1), 1), 24);
      const ahora = new Date();
      // Si ya venció se renueva desde hoy; si no, se extiende desde el vencimiento.
      const base = fila.end_date > ahora.toISOString() ? new Date(fila.end_date) : ahora;
      const fin = new Date(base);
      fin.setMonth(fin.getMonth() + meses);

      await env.DB.prepare(
        `UPDATE monthly_passes
            SET end_date = ?, status = 'active', updated_at = ?
          WHERE id = ?`
      )
        .bind(fin.toISOString(), ahora.toISOString(), passId)
        .run();

      const actualizado = await env.DB.prepare(`SELECT * FROM monthly_passes WHERE id = ?`)
        .bind(passId)
        .first<FilaPass>();
      return json({ pass: actualizado ? serializar(actualizado) : null });
    });
  }

  /* --------------------------------------------------------------- borra */
  const borra = resto.match(/^\/([^/]+)$/);
  if (borra && metodo === 'DELETE') {
    return manejar(async () => {
      const passId = borra[1];
      const fila = await env.DB.prepare(`SELECT * FROM monthly_passes WHERE id = ?`)
        .bind(passId)
        .first<FilaPass>();
      if (!fila) throw new ApiError(404, 'not_found', 'Abono inexistente');

      // Borrar un abono es sensible: solo dueño/manager o super admin.
      const miembro = await env.DB.prepare(
        `SELECT role FROM establishment_members
          WHERE establishment_id = ? AND user_id = ?`
      )
        .bind(fila.establishment_id, usuario.id)
        .first<{ role: string }>();

      const rol = usuario.isSuper ? 'owner' : miembro?.role;
      if (rol !== 'owner' && rol !== 'manager') {
        throw new ApiError(403, 'forbidden', 'Tu rol no permite eliminar abonos');
      }

      await env.DB.prepare(`DELETE FROM monthly_passes WHERE id = ?`).bind(passId).run();
      return json({ ok: true });
    });
  }

  throw new ApiError(404, 'not_found', `Ruta desconocida: ${metodo} ${url.pathname}`);
}
