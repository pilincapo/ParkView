/**
 * Cliente de la API de CocheraFlow.
 *
 * Reemplaza a `src/lib/firebase.ts`: ya no hay SDK de Firebase, solo fetch
 * contra el Worker de Cloudflare, con la sesión en cookie HttpOnly.
 *
 * ## Contraseñas
 *
 * El servidor no puede hacer hash con un factor de trabajo serio: Workers Free
 * corta a 10 ms de CPU por request y PBKDF2 con 600.000 iteraciones tarda
 * ~111 ms (medido). Así que el derivado se calcula acá, en el navegador, donde
 * no hay límite, y al servidor llega un verificador de 256 bit que él solo
 * compara. La contraseña nunca sale de esta pestaña.
 */

import type { Establishment, MonthlyPass, ParkingSettings, Vehicle } from '../types';
import { VehicleStatus } from '../types';

const PBKDF2_ITERACIONES = 600_000;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** La sesión ya no sirve: el caller debe desloguear. */
  get esNoAutenticado(): boolean {
    return this.status === 401;
  }
}

/** Usuario en la forma que ya espera la UI (`uid`, como venía de Firebase). */
export interface AppUser {
  uid: string;
  email: string;
  displayName: string | null;
  isSuper: boolean;
}

interface RawUser {
  id: string;
  email: string;
  displayName: string | null;
  isSuper: boolean;
}

function aAppUser(u: RawUser): AppUser {
  return { uid: u.id, email: u.email, displayName: u.displayName, isSuper: u.isSuper };
}

/* -------------------------------------------------------------------------- */
/* Contraseña: derivación en el navegador                                      */
/* -------------------------------------------------------------------------- */

function b64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function salDesdeEmail(email: string): string {
  return `cocheraflow:v1:${email.trim().toLowerCase()}`;
}

/**
 * PBKDF2-SHA256 con 600.000 iteraciones. Tarda ~100-300 ms en el navegador,
 * que es un retraso aceptable en un submit y no consume CPU del Worker.
 */
export async function derivarVerificador(email: string, password: string): Promise<string> {
  const material = new TextEncoder().encode(password);
  const key = await crypto.subtle.importKey('raw', material, 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(salDesdeEmail(email)),
      iterations: PBKDF2_ITERACIONES,
      hash: 'SHA-256',
    },
    key,
    256
  );
  return b64(new Uint8Array(bits));
}

/* -------------------------------------------------------------------------- */
/* Adaptador de fechas                                                         */
/* -------------------------------------------------------------------------- */

/**
 * El Worker devuelve fechas como ISO 8601; la UI las consume como `Date`.
 * Un solo punto de conversión en vez de llamadas sueltas por todos lados.
 */
function aDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Variante para campos que la base garantiza presentes (`entryTime`, etc.). */
function aDateObligatorio(iso: string): Date {
  const d = aDate(iso);
  if (!d) throw new ApiError(500, 'bad_date', `Fecha inválida del servidor: ${iso}`);
  return d;
}

interface RawVehicle {
  id: string;
  establishmentId: string;
  plate: string;
  slotId: string;
  vehicleType: 'car' | 'motorcycle';
  entryType: 'daily' | 'monthly';
  entryTime: string;
  exitTime: string | null;
  status: 'active' | 'completed';
  totalAmount: number;
  ownerId: string;
}

function aVehicle(r: RawVehicle): Vehicle {
  return {
    id: r.id,
    plate: r.plate,
    slotId: r.slotId,
    vehicleType: r.vehicleType,
    entryType: r.entryType,
    entryTime: aDateObligatorio(r.entryTime),
    exitTime: aDate(r.exitTime),
    status: r.status as VehicleStatus,
    totalAmount: r.totalAmount,
    ownerId: r.ownerId,
    establishmentId: r.establishmentId,
  };
}

interface RawPass {
  id: string;
  establishmentId: string;
  plate: string;
  vehicleType: 'car' | 'motorcycle';
  startDate: string;
  endDate: string;
  amount: number;
  status: 'active' | 'expired';
  ownerId: string;
}

function aPass(r: RawPass): MonthlyPass {
  return {
    id: r.id,
    plate: r.plate,
    vehicleType: r.vehicleType,
    startDate: aDateObligatorio(r.startDate),
    endDate: aDateObligatorio(r.endDate),
    amount: r.amount,
    status: r.status,
    ownerId: r.ownerId,
    establishmentId: r.establishmentId,
  };
}

/* -------------------------------------------------------------------------- */
/* Transporte                                                                  */
/* -------------------------------------------------------------------------- */

async function pedir<T>(ruta: string, init: RequestInit = {}): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(ruta, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, 'network', 'Sin conexión con el servidor');
  }

  if (respuesta.status === 204) return undefined as T;

  let data: unknown = null;
  const texto = await respuesta.text();
  if (texto) {
    try {
      data = JSON.parse(texto);
    } catch {
      data = null;
    }
  }

  if (!respuesta.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(
      respuesta.status,
      err?.code ?? 'unknown',
      err?.message ?? `Error ${respuesta.status}`
    );
  }

  return data as T;
}

const json = (body: unknown): string => JSON.stringify(body);

/* -------------------------------------------------------------------------- */
/* Auth                                                                        */
/* -------------------------------------------------------------------------- */

export const authApi = {
  async registrar(email: string, password: string, displayName?: string): Promise<AppUser> {
    const verifier = await derivarVerificador(email, password);
    const res = await pedir<{ user: RawUser }>('/api/auth/register', {
      method: 'POST',
      body: json({ email, verifier, displayName }),
    });
    return aAppUser(res.user);
  },

  async ingresar(email: string, password: string): Promise<AppUser> {
    const verifier = await derivarVerificador(email, password);
    const res = await pedir<{ user: RawUser }>('/api/auth/login', {
      method: 'POST',
      body: json({ email, verifier }),
    });
    return aAppUser(res.user);
  },

  async salir(): Promise<void> {
    await pedir<void>('/api/auth/logout', { method: 'POST' });
  },

  /** Devuelve null cuando no hay sesión (401 esperado, no es un error). */
  async actual(): Promise<AppUser | null> {
    try {
      const res = await pedir<{ user: RawUser | null }>('/api/auth/me');
      return res.user ? aAppUser(res.user) : null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },

  /** Redirección a Google; el Worker setea la cookie en el callback. */
  google(): void {
    window.location.href = '/api/auth/google';
  },
};

/* -------------------------------------------------------------------------- */
/* Establecimientos                                                            */
/* -------------------------------------------------------------------------- */

interface RawEstablishment {
  id: string;
  name: string;
  address: string;
  ownerId: string;
  role: 'owner' | 'manager' | 'operator';
  settings: ParkingSettings;
}

function aEstablishment(r: RawEstablishment): Establishment {
  return {
    id: r.id,
    name: r.name,
    address: r.address,
    ownerId: r.ownerId,
    members: [],
    settings: r.settings,
    role: r.role,
  } as Establishment;
}

export const establishmentsApi = {
  async listar(): Promise<Establishment[]> {
    const res = await pedir<{ establishments: RawEstablishment[] }>('/api/establishments');
    return res.establishments.map(aEstablishment);
  },

  async crear(name: string, address: string): Promise<Establishment> {
    const res = await pedir<{ establishment: RawEstablishment }>('/api/establishments', {
      method: 'POST',
      body: json({ name, address }),
    });
    return aEstablishment(res.establishment);
  },

  async actualizar(
    id: string,
    cambios: { name?: string; address?: string; settings?: Partial<ParkingSettings> }
  ): Promise<void> {
    await pedir(`/api/establishments/${id}`, {
      method: 'PATCH',
      body: json(cambios),
    });
  },

  async miembros(id: string): Promise<
    { userId: string; role: string; email: string; displayName: string | null }[]
  > {
    const res = await pedir<{ members: { userId: string; role: string; email: string; displayName: string | null }[] }>(
      `/api/establishments/${id}/members`
    );
    return res.members;
  },

  async agregarMiembro(id: string, email: string, role = 'operator'): Promise<void> {
    await pedir(`/api/establishments/${id}/members`, {
      method: 'POST',
      body: json({ email, role }),
    });
  },

  async quitarMiembro(id: string, userId: string): Promise<void> {
    await pedir(`/api/establishments/${id}/members/${userId}`, { method: 'DELETE' });
  },
};

/* -------------------------------------------------------------------------- */
/* Vehículos                                                                   */
/* -------------------------------------------------------------------------- */

export const vehiclesApi = {
  async activos(establishmentId: string): Promise<Vehicle[]> {
    const res = await pedir<{ vehicles: RawVehicle[] }>(
      `/api/vehicles/list?establishmentId=${encodeURIComponent(establishmentId)}`
    );
    return res.vehicles.map(aVehicle);
  },

  async historial(
    establishmentId: string,
    filtros: {
      limit?: number;
      offset?: number;
      desde?: string;
      hasta?: string;
      vehicleType?: 'car' | 'motorcycle';
      entryType?: 'daily' | 'monthly';
      plate?: string;
    } = {}
  ): Promise<{ vehicles: Vehicle[]; total: number }> {
    const q = new URLSearchParams({ establishmentId });
    for (const [k, v] of Object.entries(filtros)) {
      if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
    }
    const res = await pedir<{ vehicles: RawVehicle[]; total: number }>(
      `/api/vehicles/history?${q.toString()}`
    );
    return { vehicles: res.vehicles.map(aVehicle), total: res.total };
  },

  async reporte(
    establishmentId: string,
    desde: string,
    hasta: string,
    ownerId?: string
  ): Promise<Vehicle[]> {
    const q = new URLSearchParams({ establishmentId, desde, hasta });
    if (ownerId) q.set('ownerId', ownerId);
    const res = await pedir<{ vehicles: RawVehicle[] }>(`/api/vehicles/report?${q.toString()}`);
    return res.vehicles.map(aVehicle);
  },

  async patentes(establishmentId: string): Promise<string[]> {
    const res = await pedir<{ plates: string[] }>(
      `/api/vehicles/plates?establishmentId=${encodeURIComponent(establishmentId)}`
    );
    return res.plates;
  },

  async ingresar(datos: {
    establishmentId: string;
    plate: string;
    slotId: string;
    vehicleType: 'car' | 'motorcycle';
    entryType: 'daily' | 'monthly';
  }): Promise<Vehicle> {
    const res = await pedir<{ vehicle: RawVehicle }>('/api/vehicles/entry', {
      method: 'POST',
      body: json(datos),
    });
    return aVehicle(res.vehicle);
  },

  async salir(vehicleId: string, amount?: number): Promise<Vehicle> {
    const res = await pedir<{ vehicle: RawVehicle }>(`/api/vehicles/${vehicleId}/exit`, {
      method: 'POST',
      body: json(amount !== undefined ? { amount } : {}),
    });
    return aVehicle(res.vehicle);
  },

  async eliminar(vehicleId: string): Promise<void> {
    await pedir(`/api/vehicles/${vehicleId}`, { method: 'DELETE' });
  },
};

/* -------------------------------------------------------------------------- */
/* Abonos                                                                      */
/* -------------------------------------------------------------------------- */

export const passesApi = {
  async listar(establishmentId: string): Promise<MonthlyPass[]> {
    const res = await pedir<{ passes: RawPass[] }>(
      `/api/passes/list?establishmentId=${encodeURIComponent(establishmentId)}`
    );
    return res.passes.map(aPass);
  },

  async crear(datos: {
    establishmentId: string;
    plate: string;
    vehicleType: 'car' | 'motorcycle';
    amount: number;
    months?: number;
  }): Promise<MonthlyPass> {
    const res = await pedir<{ pass: RawPass }>('/api/passes', {
      method: 'POST',
      body: json(datos),
    });
    return aPass(res.pass);
  },

  async renovar(passId: string, months = 1): Promise<MonthlyPass> {
    const res = await pedir<{ pass: RawPass }>(`/api/passes/${passId}/renew`, {
      method: 'POST',
      body: json({ months }),
    });
    return aPass(res.pass);
  },

  async eliminar(passId: string): Promise<void> {
    await pedir(`/api/passes/${passId}`, { method: 'DELETE' });
  },
};
