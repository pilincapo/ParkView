-- CocheraFlow — esquema inicial para Cloudflare D1 (SQLite)

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Usuarios (reemplaza Firebase Auth)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,          -- uid opaco (crypto.randomUUID)
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  -- PBKDF2-SHA256: iteraciones$salt_b64$hash_b64. NULL si solo usa Google.
  password_hash TEXT,
  google_sub    TEXT UNIQUE,               -- subject de Google (si aplica)
  is_super      INTEGER NOT NULL DEFAULT 0, -- super admin de la instancia
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ---------------------------------------------------------------------------
-- Sesiones de navegador (cookie HttpOnly)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,            -- token aleatorio de 32 bytes (hex)
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at  TEXT NOT NULL,               -- ISO8601 UTC
  user_agent  TEXT,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ---------------------------------------------------------------------------
-- Cocheras
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS establishments (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  address     TEXT NOT NULL DEFAULT '',
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  settings    TEXT NOT NULL,               -- JSON de ParkingSettings
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_establishments_owner ON establishments(owner_id);

-- Miembros: reemplaza el array `members` de Firestore.
-- role: 'owner' | 'manager' | 'operator'
CREATE TABLE IF NOT EXISTS establishment_members (
  establishment_id TEXT NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role             TEXT NOT NULL DEFAULT 'operator'
                   CHECK (role IN ('owner','manager','operator')),
  added_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (establishment_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON establishment_members(user_id);

-- ---------------------------------------------------------------------------
-- Sesiones de estacionamiento (vehículos)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicles (
  id               TEXT PRIMARY KEY,
  establishment_id TEXT NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  plate            TEXT NOT NULL,
  slot_id          TEXT NOT NULL,
  vehicle_type     TEXT NOT NULL CHECK (vehicle_type IN ('car','motorcycle')),
  entry_type       TEXT NOT NULL DEFAULT 'daily'
                   CHECK (entry_type IN ('daily','monthly')),
  entry_time       TEXT NOT NULL,
  exit_time        TEXT,
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','completed')),
  total_amount     INTEGER NOT NULL DEFAULT 0,
  owner_id         TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Cobertura de los tres reads críticos (activos, historial, reportes).
CREATE INDEX IF NOT EXISTS idx_vehicles_est_active
  ON vehicles(establishment_id, status, entry_time DESC);
CREATE INDEX IF NOT EXISTS idx_vehicles_est_completed_exit
  ON vehicles(establishment_id, status, exit_time DESC);
CREATE INDEX IF NOT EXISTS idx_vehicles_est_owner_exit
  ON vehicles(establishment_id, owner_id, exit_time DESC);
CREATE INDEX IF NOT EXISTS idx_vehicles_plate ON vehicles(plate);

-- UNIQUE parcial: garantiza a nivel de base que un slot no tenga dos
-- vehículos activos a la vez. Ésta es la protección contra la carrera
-- que antes dependía del chequeo en el cliente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_slot_occupied
  ON vehicles(establishment_id, slot_id)
  WHERE status = 'active';

-- Una patente no puede estar dos veces en playa al mismo tiempo. Sin este
-- índice, el chequeo previo desde el cliente es una lectura-then-escritura
-- y dos operadores podrían registrar el mismo vehículo en paralelo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_plate_active
  ON vehicles(establishment_id, plate)
  WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- Abonos mensuales
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_passes (
  id               TEXT PRIMARY KEY,
  establishment_id TEXT NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  plate            TEXT NOT NULL,
  vehicle_type     TEXT NOT NULL CHECK (vehicle_type IN ('car','motorcycle')),
  start_date       TEXT NOT NULL,
  end_date         TEXT NOT NULL,
  amount           INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','expired')),
  owner_id         TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_passes_est_status
  ON monthly_passes(establishment_id, status, end_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pass_active_plate
  ON monthly_passes(establishment_id, plate)
  WHERE status = 'active';
