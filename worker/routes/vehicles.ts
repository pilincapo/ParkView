/**
 * Rutas de vehículos: ingreso, salida, historial y reportes.
 *
 * La parte importante acá es `ingresar`: la ocupación de un slot se resuelve
 * en la base con un índice UNIQUE parcial (ver migrations/0001_init.sql), así
 * el polling del cliente con hasta 15 s de retraso no puede producir doble
 * ingreso en la misma cochera.
 */

import type { Env } from '../auth';
import { calcularImporte, type EntryType, type TarifaSettings, type VehicleType } from '../../shared/pricing';
import { ApiError, exigirAcceso, exigirUsuario, json, leerBody, manejar } from '../http';

const ESTADOS = new Set(['active', 'completed']);

interface IngresoBody {
  establishmentId: string;
  plate: string;
  slotId: string;
  vehicleType: VehicleType;
  entryType: EntryType;
}

interface FilaVehicle {
  id: string;
  establishment_id: string;
  plate: string;
  slot_id: string;
  vehicle_type: VehicleType;
  entry_type: EntryType;
  entry_time: string;
  exit_time: string | null;
  status: 'active' | 'completed';
  total_amount: number;
  owner_id: string;
}

/** Forma que consume el frontend: camelCase y fechas como ISO 8601. */
function serializar(v: FilaVehicle) {
  return {
    id: v.id,
    establishmentId: v.establishment_id,
    plate: v.plate,
    slotId: v.slot_id,
    vehicleType: v.vehicle_type,
    entryType: v.entry_type,
    entryTime: v.entry_time,
    exitTime: v.exit_time,
    status: v.status,
    totalAmount: v.total_amount,
    ownerId: v.owner_id,
  };
}

async function cargarTarifas(env: Env, establishmentId: string): Promise<TarifaSettings | null> {
  const fila = await env.DB.prepare(
    `SELECT settings FROM establishments WHERE id = ?`
  )
    .bind(establishmentId)
    .first<{ settings: string }>();
  if (!fila) return null;
  try {
    return JSON.parse(fila.settings) as TarifaSettings;
  } catch {
    return null;
  }
}

function exigirParametro(url: URL, nombre: string): string {
  const valor = url.searchParams.get(nombre);
  if (!valor) throw new ApiError(400, 'missing_param', `Falta el parámetro ${nombre}`);
  return valor;
}

export async function manejarVehicles(
  env: Env,
  request: Request,
  url: URL
): Promise<Response> {
  const usuario = await exigirUsuario(env, request);
  const ruta = url.pathname.replace(/^\/api\/vehicles/, '');
  const metodo = request.method;

  /* --------------------------------------------------------- lista activos */
  if (ruta === '/list' && metodo === 'GET') {
    return manejar(async () => {
      const establishmentId = exigirParametro(url, 'establishmentId');
      await exigirAcceso(env, usuario, establishmentId);

      const filas = await env.DB.prepare(
        `SELECT * FROM vehicles
          WHERE establishment_id = ? AND status = 'active'
          ORDER BY entry_time DESC`
      )
        .bind(establishmentId)
        .all<FilaVehicle>();

      return json({ vehicles: filas.results.map(serializar) });
    });
  }

  /* ------------------------------------------------------------- historial */
  if (ruta === '/history' && metodo === 'GET') {
    return manejar(async () => {
      const establishmentId = exigirParametro(url, 'establishmentId');
      await exigirAcceso(env, usuario, establishmentId);

      // Límite duro: el historial crece indefinidamente y D1 cobra por fila leída.
      const limite = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 200) || 200, 1), 500);
      const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);

      const condiciones = ['establishment_id = ?', "status = 'completed'"];
      const params: unknown[] = [establishmentId];

      const desde = url.searchParams.get('desde');
      if (desde) {
        condiciones.push('exit_time >= ?');
        params.push(`${desde}T00:00:00.000Z`);
      }
      const hasta = url.searchParams.get('hasta');
      if (hasta) {
        condiciones.push('exit_time <= ?');
        params.push(`${hasta}T23:59:59.999Z`);
      }
      const tipo = url.searchParams.get('vehicleType');
      if (tipo === 'car' || tipo === 'motorcycle') {
        condiciones.push('vehicle_type = ?');
        params.push(tipo);
      }
      const entryType = url.searchParams.get('entryType');
      if (entryType === 'daily' || entryType === 'monthly') {
        condiciones.push('entry_type = ?');
        params.push(entryType);
      }
      const plate = url.searchParams.get('plate');
      if (plate) {
        condiciones.push('plate LIKE ?');
        params.push(`%${plate.toUpperCase()}%`);
      }

      const where = condiciones.join(' AND ');
      const total = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM vehicles WHERE ${where}`
      )
        .bind(...params)
        .first<{ n: number }>();

      const filas = await env.DB.prepare(
        `SELECT * FROM vehicles WHERE ${where}
          ORDER BY exit_time DESC
          LIMIT ? OFFSET ?`
      )
        .bind(...params, limite, offset)
        .all<FilaVehicle>();

      return json({
        vehicles: filas.results.map(serializar),
        total: total?.n ?? 0,
        limit: limite,
        offset,
      });
    });
  }

  /* ------------------------------------------------------------- reportes */
  if (ruta === '/report' && metodo === 'GET') {
    return manejar(async () => {
      const establishmentId = exigirParametro(url, 'establishmentId');
      await exigirAcceso(env, usuario, establishmentId);

      const desde = exigirParametro(url, 'desde');
      const hasta = exigirParametro(url, 'hasta');

      const condiciones = [
        'establishment_id = ?',
        "status = 'completed'",
        'exit_time >= ?',
        'exit_time <= ?',
      ];
      const params: unknown[] = [
        establishmentId,
        `${desde}T00:00:00.000Z`,
        `${hasta}T23:59:59.999Z`,
      ];

      const ownerId = url.searchParams.get('ownerId');
      if (ownerId) {
        condiciones.push('owner_id = ?');
        params.push(ownerId);
      }

      const filas = await env.DB.prepare(
        `SELECT * FROM vehicles
          WHERE ${condiciones.join(' AND ')}
          ORDER BY exit_time DESC
          LIMIT 2000`
      )
        .bind(...params)
        .all<FilaVehicle>();

      return json({ vehicles: filas.results.map(serializar) });
    });
  }

  /* ------------------------------------------------------------- patentes */
  if (ruta === '/plates' && metodo === 'GET') {
    return manejar(async () => {
      const establishmentId = exigirParametro(url, 'establishmentId');
      await exigirAcceso(env, usuario, establishmentId);

      const filas = await env.DB.prepare(
        `SELECT DISTINCT plate FROM vehicles
          WHERE establishment_id = ?
          ORDER BY plate DESC
          LIMIT 500`
      )
        .bind(establishmentId)
        .all<{ plate: string }>();

      return json({ plates: filas.results.map((r) => r.plate) });
    });
  }

  /* -------------------------------------------------------------- ingreso */
  if (ruta === '/entry' && metodo === 'POST') {
    return manejar(async () => {
      const body = await leerBody<IngresoBody>(request);
      await exigirAcceso(env, usuario, body.establishmentId);

      const plate = (body.plate ?? '').trim().toUpperCase();
      if (plate.length < 6 || plate.length > 8) {
        throw new ApiError(400, 'invalid_plate', 'La patente debe tener entre 6 y 8 caracteres');
      }
      const slotId = (body.slotId ?? '').trim();
      if (!slotId) throw new ApiError(400, 'invalid_slot', 'Falta el número de cochera');

      if (body.vehicleType !== 'car' && body.vehicleType !== 'motorcycle') {
        throw new ApiError(400, 'invalid_vehicle_type', 'Tipo de vehículo inválido');
      }
      const entryType: EntryType = body.entryType === 'monthly' ? 'monthly' : 'daily';

      // Regla de la casa: las cocheras de motos (prefijo M-) solo admiten motos.
      if (slotId.startsWith('M-') && body.vehicleType !== 'motorcycle') {
        throw new ApiError(400, 'slot_type_mismatch', 'En cocheras de motos solo se permiten motos');
      }

      // ¿La patente ya está en playa? Se resuelve en la base, no en el cliente.
      const duplicado = await env.DB.prepare(
        `SELECT id FROM vehicles
          WHERE establishment_id = ? AND plate = ? AND status = 'active'`
      )
        .bind(body.establishmentId, plate)
        .first<{ id: string }>();
      if (duplicado) {
        throw new ApiError(409, 'plate_already_active', `La patente ${plate} ya está en la playa`);
      }

      const id = crypto.randomUUID();
      try {
        await env.DB.prepare(
          `INSERT INTO vehicles
             (id, establishment_id, plate, slot_id, vehicle_type, entry_type,
              entry_time, status, total_amount, owner_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?)`
        )
          .bind(
            id,
            body.establishmentId,
            plate,
            slotId,
            body.vehicleType,
            entryType,
            new Date().toISOString(),
            usuario.id,
            new Date().toISOString()
          )
          .run();
      } catch (error) {
        // El índice UNIQUE parcial es la garantía atómica de que dos operadores
        // no tomen la misma cochera. D1 nombra las *columnas* del índice en el
        // mensaje, no el nombre del índice, por eso se buscan las columnas.
        const mensaje = error instanceof Error ? error.message : String(error);
        if (mensaje.includes('UNIQUE constraint failed: vehicles.establishment_id, vehicles.slot_id')) {
          throw new ApiError(409, 'slot_occupied', `La cochera ${slotId} ya está ocupada`);
        }
        if (mensaje.includes('UNIQUE constraint failed: vehicles.establishment_id, vehicles.plate')) {
          throw new ApiError(409, 'plate_already_active', `La patente ${plate} ya está en la playa`);
        }
        throw error;
      }

      const fila = await env.DB.prepare(`SELECT * FROM vehicles WHERE id = ?`)
        .bind(id)
        .first<FilaVehicle>();
      if (!fila) throw new ApiError(500, 'internal', 'No se pudo leer el vehículo creado');

      return json({ vehicle: serializar(fila) }, { status: 201 });
    });
  }

  /* -------------------------------------------------------------- salida */
  const salida = ruta.match(/^\/([^/]+)\/exit$/);
  if (salida && metodo === 'POST') {
    return manejar(async () => {
      const vehicleId = salida[1];
      const body = await leerBody<{ amount?: number }>(request);

      const fila = await env.DB.prepare(
        `SELECT * FROM vehicles WHERE id = ?`
      )
        .bind(vehicleId)
        .first<FilaVehicle>();
      if (!fila) throw new ApiError(404, 'not_found', 'Vehículo inexistente');

      await exigirAcceso(env, usuario, fila.establishment_id);

      if (fila.status !== 'active') {
        throw new ApiError(409, 'already_exited', 'El vehículo ya egresó');
      }

      const tarifas = await cargarTarifas(env, fila.establishment_id);
      const ahora = new Date().toISOString();

      // El importe por defecto lo calcula el servidor con la misma fórmula que
      // ve el operador. Un monto explícito (corrección manual) se respeta, con
      // validación: nada de negativos ni absurdos.
      const calculado = calcularImporte({
        entryTime: fila.entry_time,
        entryType: fila.entry_type,
        vehicleType: fila.vehicle_type,
        settings: tarifas,
        now: ahora,
      });

      let monto = calculado;
      if (typeof body.amount === 'number' && Number.isFinite(body.amount)) {
        if (body.amount < 0) throw new ApiError(400, 'invalid_amount', 'El importe no puede ser negativo');
        if (body.amount > 10_000_000) throw new ApiError(400, 'invalid_amount', 'Importe fuera de rango');
        monto = Math.round(body.amount);
      }

      const res = await env.DB.prepare(
        `UPDATE vehicles
            SET status = 'completed', exit_time = ?, total_amount = ?
          WHERE id = ? AND status = 'active'`
      )
        .bind(ahora, monto, vehicleId)
        .run();

      if (res.meta.changes === 0) {
        throw new ApiError(409, 'already_exited', 'El vehículo ya egresó');
      }

      const actualizada = await env.DB.prepare(`SELECT * FROM vehicles WHERE id = ?`)
        .bind(vehicleId)
        .first<FilaVehicle>();

      return json({ vehicle: actualizada ? serializar(actualizada) : null });
    });
  }

  /* ------------------------------------------------------- borrar registro */
  const borrar = ruta.match(/^\/([^/]+)$/);
  if (borrar && metodo === 'DELETE') {
    return manejar(async () => {
      const vehicleId = borrar[1];
      const fila = await env.DB.prepare(`SELECT * FROM vehicles WHERE id = ?`)
        .bind(vehicleId)
        .first<FilaVehicle>();
      if (!fila) throw new ApiError(404, 'not_found', 'Vehículo inexistente');

      const rol = await exigirAcceso(env, usuario, fila.establishment_id);
      // Borrar historial es sensible: solo dueño/manager o super admin.
      if (rol === 'operator' && !usuario.isSuper) {
        throw new ApiError(403, 'forbidden', 'Tu rol no permite eliminar registros');
      }

      await env.DB.prepare(`DELETE FROM vehicles WHERE id = ?`).bind(vehicleId).run();
      return json({ ok: true });
    });
  }

  throw new ApiError(404, 'not_found', `Ruta desconocida: ${metodo} ${url.pathname}`);
}
