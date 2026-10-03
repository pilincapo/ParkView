# CocheraFlow

Gestión de cocheras: ingresos, salidas, tarifas, historial, reportes y abonos
mensuales, con roles por cochera (dueño / encargado / operador).

Stack: **React 19 + Vite + Tailwind 4** en el cliente, **Cloudflare Worker + D1**
en el backend. Corre **100% local** sin cuenta de Cloudflare ni ninguna
credencial: `@cloudflare/vite-plugin` levanta el Worker (workerd) y una base D1
SQLite local en el mismo origen que la app.

## Arranque

```bash
npm install
npm run db:migrate:local   # crea el esquema en la D1 local (una sola vez, o tras reset)
npm run dev                # http://localhost:5173
```

`npm run dev` sirve el frontend y `/api/*` en el mismo puerto, así que no hay
CORS ni proxy que configurar.

Primer usuario registrado en una base vacía queda como super admin.

## Probar que anda

```bash
npm run smoke              # contra http://localhost:5173
SMOKE_BASE=http://localhost:8787 npm run smoke   # u otro origen
```

`scripts/smoke.mjs` recorre el flujo real de punta a punta (38 checks): alta de
usuario, sesión por cookie, cochera, tarifas, ingreso/salida, carrera de
cocheras, abonos mensuales y permisos por rol. Sale con código 1 si algo falla.

Otros comandos:

| Comando | Qué hace |
|---|---|
| `npm run lint` | `tsc --noEmit` del frontend |
| `npm run lint:worker` | `tsc --noEmit` del Worker |
| `npm run db:migrate:local` | aplica `migrations/*.sql` a la D1 local |
| `npm run db:reset:local` | borra la base local y la vuelve a crear (con el dev server detenido) |
| `npm run build` | build de producción: estáticos + Worker en `dist/client` y `dist/cocheraflow` |

## Decisiones que conviene conocer antes de tocar el código

**La contraseña se deriva en el navegador.** Workers Free corta a 10 ms de CPU
por request; PBKDF2-SHA256 con las 600.000 iteraciones que recomienda OWASP tarda
~111 ms medidos en el servidor. El KDF corre en `src/lib/api.ts` y al Worker
llega solo un verificador de 256 bit que se compara tal cual. La contraseña nunca
sale de la pestaña. Por eso el backend nunca recibe ni guarda una contraseña.

**No hay realtime.** D1 no tiene suscripciones, así que la vista refresca con
polling cada 15 s (`src/lib/usePoll.ts`). Como el cliente puede tener 15 s de
retraso, la ocupación de una cochera **no** se resuelve en el cliente: hay índices
UNIQUE parciales en la base (`uq_slot_occupied`, `uq_plate_active`,
`uq_pass_active_plate`). Dos operadores que toman el mismo slot a la vez producen
exactamente un 201 y un 409, nunca un doble ingreso.

**El importe se calcula en el servidor**, con `shared/pricing.ts`, que es la
misma función que ve el operador en pantalla. Un monto enviado explícitamente se
respeta como corrección manual, validado.

**Los roles se chequean en el Worker**, no en el cliente: `exigirGestion` en
`worker/http.ts` impide que un operador cambie tarifas o toque miembros.

**Sin Google OAuth por defecto.** `GOOGLE_CLIENT_ID` viene vacío, así que
`/api/auth/google` responde 503 y el botón correspondiente avisa en vez de
romperse. El login con usuario y contraseña funciona siempre.

## Estructura

```
migrations/     esquema D1 (SQL puro)
shared/         pricing.ts: fórmula de tarifa, la importan cliente y servidor
worker/         Worker: index.ts (router), auth.ts, http.ts, routes/
src/lib/api.ts  cliente fetch + derivación de contraseña en el navegador
src/lib/usePoll.ts  polling de 15 s en lugar de onSnapshot
scripts/smoke.mjs   smoke test end-to-end
```

En desarrollo el plugin escribe sus intermedios en `isolate/`; en producción
escribe en `dist/`. Los dos están en `.gitignore`.

## Desplegar (cuando quieras, no hace falta ahora)

Requiere credenciales de Cloudflare, hoy no configuradas: `CLOUDFLARE_ACCOUNT_ID`
y `CLOUDFLARE_API_TOKEN` en el entorno.

1. `npx wrangler d1 create cocheraflow` → copiar el `database_id` a `wrangler.jsonc`
2. `npx wrangler d1 execute cocheraflow --remote --file=./migrations/0001_init.sql`
3. `npx wrangler deploy`
4. Poner `APP_URL` con el dominio del frontend: define el dominio de la cookie de sesión