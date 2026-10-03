/**
 * Smoke test end-to-end contra el stack local.
 *
 * Corre contra el mismo servidor que sirve la app (`npm run dev`), que con
 * @cloudflare/vite-plugin levanta el Worker y la D1 local en el mismo origen.
 * No necesita credenciales de Cloudflare ni red: todo es local.
 *
 *   npm run dev            (en otra terminal)
 *   npm run smoke
 *
 * Para apuntar a otro origen:  SMOKE_BASE=http://localhost:8787 npm run smoke
 */

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:5173';

let pass = 0;
let fail = 0;
const fallos = [];

function check(nombre, condicion, detalle = '') {
  if (condicion) {
    pass++;
    console.log(`  ok   ${nombre}`);
  } else {
    fail++;
    fallos.push(nombre);
    console.log(`  FAIL ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  }
}

/** Cada jar es una sesión independiente (cookie HttpOnly). */
function nuevoJar() {
  return { cookie: '' };
}

const sesion = nuevoJar();

async function api(ruta, { metodo = 'GET', cuerpo, jar = sesion } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (jar.cookie) headers.cookie = jar.cookie;
  const res = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const m = setCookie.match(/cochera_session=([^;]+)/);
    if (m) jar.cookie = `cochera_session=${m[1]}`;
  }
  const texto = await res.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = { crudo: texto.slice(0, 200) };
  }
  return { status: res.status, body: json };
}

/** 32 bytes en base64: el mismo verificador que produce el navegador. */
function verificador() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString('base64');
}

const sufijo = Math.random().toString(36).slice(2, 8);
const email = `smoke-${sufijo}@local.test`;

console.log(`\nCocheraFlow — smoke test contra ${BASE}\n`);

/* -------------------------------------------------------------- disponible */
const health = await api('/api/health').catch(() => ({ status: 0, body: null }));
check('el servidor responde /api/health', health.status === 200, `status ${health.status}`);
if (health.status !== 200) {
  console.log('\nEl servidor no está levantado. ¿Corriste `npm run dev`?\n');
  process.exit(1);
}

/* ------------------------------------------------------------------- auth */
const anon = await api('/api/auth/me');
check('sin sesión /me devuelve 401', anon.status === 401, `status ${anon.status}`);

const mal = await api('/api/auth/register', {
  metodo: 'POST',
  cuerpo: { email: 'no-es-mail', verifier: verificador() },
});
check('registro con email inválido devuelve 400', mal.status === 400, `status ${mal.status}`);

const reg = await api('/api/auth/register', {
  metodo: 'POST',
  cuerpo: { email, verifier: verificador(), displayName: 'Smoke Test' },
});
check('registro devuelve 201 y cookie de sesión', reg.status === 201 && sesion.cookie.length > 0, `status ${reg.status}`);

const repetido = await api('/api/auth/register', {
  metodo: 'POST',
  cuerpo: { email, verifier: verificador() },
});
check('re-registrar el mismo email devuelve 409', repetido.status === 409, `status ${repetido.status}`);

const me = await api('/api/auth/me');
check('/me devuelve el usuario', me.status === 200 && me.body?.user?.email === email, JSON.stringify(me.body));

const malaPass = await api('/api/auth/login', {
  metodo: 'POST',
  cuerpo: { email, verifier: verificador() },
});
check('login con verificador incorrecto devuelve 401', malaPass.status === 401, `status ${malaPass.status}`);

/* ------------------------------------------------------------- cocheras */
const creada = await api('/api/establishments', {
  metodo: 'POST',
  cuerpo: { name: `Chacra Smoke ${sufijo}`, address: 'Calle Local 123' },
});
const est = creada.body?.establishment;
check('crear cochera devuelve 201 con rol owner', creada.status === 201 && est?.role === 'owner', JSON.stringify(creada.body));

const lista = await api('/api/establishments');
check('la cochera aparece en el listado', lista.status === 200 && (lista.body?.establishments ?? []).some((e) => e.id === est?.id));

const patch = await api(`/api/establishments/${est.id}`, {
  metodo: 'PATCH',
  cuerpo: { settings: { hourlyRate: 1500, carSlots: 8, motoSlots: 4 } },
});
check('el dueño puede cambiar tarifas (200)', patch.status === 200, `status ${patch.status}`);
check('las tarifas quedan guardadas', patch.body?.establishment?.settings?.hourlyRate === 1500, JSON.stringify(patch.body?.establishment?.settings));

/* ------------------------------------------------------------- ingresos */
const ingreso = await api('/api/vehicles/entry', {
  metodo: 'POST',
  cuerpo: {
    establishmentId: est.id,
    plate: `SMK${sufijo.toUpperCase().slice(0, 4)}`,
    slotId: 'A-1',
    vehicleType: 'car',
    entryType: 'daily',
  },
});
check('ingreso devuelve 201', ingreso.status === 201, JSON.stringify(ingreso.body));
const vehiculo = ingreso.body?.vehicle;

const motoEnAuto = await api('/api/vehicles/entry', {
  metodo: 'POST',
  cuerpo: { establishmentId: est.id, plate: `MT${sufijo.toUpperCase()}`, slotId: 'A-2', vehicleType: 'motorcycle', entryType: 'daily' },
});
check('una moto puede entrar a una cochera de autos', motoEnAuto.status === 201, JSON.stringify(motoEnAuto.body));
if (motoEnAuto.status === 201) {
  await api(`/api/vehicles/${motoEnAuto.body.vehicle.id}/exit`, { metodo: 'POST', cuerpo: {} });
}

const motoEnMoto = await api('/api/vehicles/entry', {
  metodo: 'POST',
  cuerpo: { establishmentId: est.id, plate: `MT${sufijo.toUpperCase()}`, slotId: 'M-1', vehicleType: 'car', entryType: 'daily' },
});
check('un auto en cochera de motos se rechaza (400)', motoEnMoto.status === 400, `status ${motoEnMoto.status}`);

const mismaPatente = await api('/api/vehicles/entry', {
  metodo: 'POST',
  cuerpo: { establishmentId: est.id, plate: vehiculo.plate, slotId: 'A-9', vehicleType: 'car', entryType: 'daily' },
});
check('patente ya activa se rechaza (409)', mismaPatente.status === 409, `status ${mismaPatente.status}`);

/* --- la carrera que importa: 5 operadores toman la misma cochera a la vez */
const carrera = await Promise.all(
  Array.from({ length: 5 }, (_, i) =>
    api('/api/vehicles/entry', {
      metodo: 'POST',
      cuerpo: {
        establishmentId: est.id,
        plate: `R${sufijo.toUpperCase()}${i}`,
        slotId: 'A-3',
        vehicleType: 'car',
        entryType: 'daily',
      },
    })
  )
);
check(
  'carrera de 5 ingresos a la misma cochera libre: exactamente 1 gana',
  carrera.filter((r) => r.status === 201).length === 1 &&
    carrera.filter((r) => r.status === 409).length === 4,
  `estados: ${carrera.map((r) => r.status).join(',')}`
);

const activos = await api(`/api/vehicles/list?establishmentId=${est.id}`);
check(
  'queda un solo auto activo en A-3',
  (activos.body?.vehicles ?? []).filter((v) => v.slotId === 'A-3').length === 1,
  JSON.stringify(activos.body?.vehicles?.map((v) => `${v.slotId}:${v.plate}`))
);

// Y ahora la cochera está ocupada: cualquier intento nuevo debe rebotar.
const yaOcupada = await api('/api/vehicles/entry', {
  metodo: 'POST',
  cuerpo: { establishmentId: est.id, plate: `X${sufijo.toUpperCase()}`, slotId: 'A-3', vehicleType: 'car', entryType: 'daily' },
});
check('cochera ocupada devuelve 409 slot_occupied', yaOcupada.status === 409 && yaOcupada.body?.error?.code === 'slot_occupied', JSON.stringify(yaOcupada.body));

/* -------------------------------------------------------------- salida */
const salida = await api(`/api/vehicles/${vehiculo.id}/exit`, { metodo: 'POST', cuerpo: {} });
check(
  'salida devuelve 200 con importe calculado en el servidor',
  salida.status === 200 && typeof salida.body?.vehicle?.totalAmount === 'number',
  JSON.stringify(salida.body?.vehicle)
);

const dobleSalida = await api(`/api/vehicles/${vehiculo.id}/exit`, { metodo: 'POST', cuerpo: {} });
check('la segunda salida devuelve 409', dobleSalida.status === 409, `status ${dobleSalida.status}`);

const historial = await api(`/api/vehicles/history?establishmentId=${est.id}`);
check('el historial incluye el vehículo cerrado', (historial.body?.vehicles ?? []).some((v) => v.id === vehiculo.id), JSON.stringify(historial.body?.vehicles?.length));

/* --------------------------------------------------- roles: owner/operator */
const jarOperador = nuevoJar();
const emailOperador = `smoke-op-${sufijo}@local.test`;
const regOperador = await api('/api/auth/register', {
  metodo: 'POST',
  cuerpo: { email: emailOperador, verifier: verificador(), displayName: 'Smoke Operador' },
  jar: jarOperador,
});
check('el operador se registra (201)', regOperador.status === 201, `status ${regOperador.status}`);

const sinMiembro = await api('/api/vehicles/list?establishmentId=' + est.id, { jar: jarOperador });
check('un usuario ajeno a la cochera recibe 403', sinMiembro.status === 403, `status ${sinMiembro.status}`);

const invitar = await api(`/api/establishments/${est.id}/members`, {
  metodo: 'POST',
  cuerpo: { email: emailOperador, role: 'operator' },
});
check('el dueño agrega al operador (201)', invitar.status === 201, JSON.stringify(invitar.body));

const miembroInexistente = await api(`/api/establishments/${est.id}/members`, {
  metodo: 'POST',
  cuerpo: { email: 'nadie@local.test' },
});
check('agregar a un email sin cuenta devuelve 404', miembroInexistente.status === 404, `status ${miembroInexistente.status}`);

const listaMiembros = await api(`/api/establishments/${est.id}/members`);
check(
  'el listado de miembros muestra email y rol',
  (listaMiembros.body?.members ?? []).length === 2 &&
    listaMiembros.body.members.some((m) => m.email === emailOperador && m.role === 'operator'),
  JSON.stringify(listaMiembros.body)
);

const verCochera = await api(`/api/establishments/${est.id}`, { jar: jarOperador });
check('el operador puede ver la cochera (200)', verCochera.status === 200, `status ${verCochera.status}`);

const opChange = await api(`/api/establishments/${est.id}`, {
  metodo: 'PATCH',
  cuerpo: { settings: { hourlyRate: 9999 } },
  jar: jarOperador,
});
check('el operador NO puede cambiar tarifas (403)', opChange.status === 403, `status ${opChange.status}`);

const opAdd = await api(`/api/establishments/${est.id}/members`, {
  metodo: 'POST',
  cuerpo: { email },
  jar: jarOperador,
});
check('el operador NO puede agregar miembros (403)', opAdd.status === 403, `status ${opAdd.status}`);

const ingresoOperador = await api('/api/vehicles/entry', {
  metodo: 'POST',
  cuerpo: { establishmentId: est.id, plate: `O${sufijo.toUpperCase()}`, slotId: 'A-7', vehicleType: 'car', entryType: 'daily' },
  jar: jarOperador,
});
check('el operador sí puede registrar ingresos (201)', ingresoOperador.status === 201, JSON.stringify(ingresoOperador.body));

const opBorrar = await api(`/api/vehicles/${ingresoOperador.body?.vehicle?.id}`, {
  metodo: 'DELETE',
  jar: jarOperador,
});
check('el operador NO puede borrar historial (403)', opBorrar.status === 403, `status ${opBorrar.status}`);

const opSalir = await api(`/api/vehicles/${ingresoOperador.body?.vehicle?.id}/exit`, {
  metodo: 'POST',
  cuerpo: {},
  jar: jarOperador,
});
check('el operador puede registrar la salida (200)', opSalir.status === 200, `status ${opSalir.status}`);

/* ------------------------------------------------------------- abonos */
const abono = await api('/api/passes', {
  metodo: 'POST',
  cuerpo: { establishmentId: est.id, plate: `AB${sufijo.toUpperCase()}`, vehicleType: 'car', amount: 90000, months: 1 },
});
check('crear abono mensual devuelve 201', abono.status === 201, JSON.stringify(abono.body));

const passesList = await api(`/api/passes/list?establishmentId=${est.id}`);
check(
  'el abono nuevo figura en el listado y está vigente',
  (passesList.body?.passes ?? []).some(
    (p) => p.plate === `AB${sufijo.toUpperCase()}` && p.status === 'active'
  ),
  JSON.stringify(passesList.body)
);

const ingresoConAbono = await api('/api/vehicles/entry', {
  metodo: 'POST',
  cuerpo: { establishmentId: est.id, plate: `AB${sufijo.toUpperCase()}`, slotId: 'A-8', vehicleType: 'car', entryType: 'monthly' },
});
check('el auto con abono entra como monthly (201)', ingresoConAbono.status === 201, JSON.stringify(ingresoConAbono.body));

/* ------------------------------------------------------------- google */
const google = await api('/api/auth/google');
check(
  'sin GOOGLE_CLIENT_ID, /auth/google responde 503 (no rompe la app)',
  google.status === 503 || google.status === 302,
  `status ${google.status}`
);

/* ------------------------------------------------------------- logout */
const out = await api('/api/auth/logout', { metodo: 'POST' });
check('logout devuelve 204', out.status === 204, `status ${out.status}`);
sesion.cookie = '';
const postLogout = await api('/api/auth/me');
check('tras logout /me vuelve a 401', postLogout.status === 401, `status ${postLogout.status}`);

/* ----------------------------------------------------------------- fin */
console.log(`\nPASS=${pass} FAIL=${fail}`);
if (fail > 0) console.log(`fallos: ${fallos.join(' | ')}`);
process.exit(fail > 0 ? 1 : 0);