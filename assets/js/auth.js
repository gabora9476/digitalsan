/* =========================================================
   DigitalSAN — Sesión y autenticación
   admin / creador -> Supabase Auth (email + password)
   participante    -> login propio vía RPC login_participante()
                       (token de sesión guardado en localStorage)
   ========================================================= */

/* Guardia: auth.js necesita el utils.js NUEVO. Si el navegador/hosting dejó uno viejo, se avisa claro. */
if (typeof conTimeout !== 'function' || typeof normalizarRIF !== 'function' || typeof esc !== 'function') {
  const msg = 'Hay archivos desactualizados: reemplaza TODOS los archivos de assets/js (config, utils, auth, rate-service) y recarga con Ctrl+F5.';
  console.error(msg);
  if (typeof mostrarErrorCritico === 'function') mostrarErrorCritico(msg);
  else document.addEventListener('DOMContentLoaded', () => { document.body.insertAdjacentHTML('afterbegin', '<div style="position:fixed;inset:0;z-index:99999;background:#070c16;color:#fff;padding:24px;font-family:sans-serif">' + msg + '</div>'); });
}

const SESION_KEY = 'digitalsan_sesion_participante';

// Columnas de perfiles que SÍ se pueden pedir (nunca uses select('*') en perfiles)
const PERFIL_COLS = 'id, auth_user_id, rol, nombre_completo, rif, whatsapp, direccion, email, creado_por, primer_login, activo, created_at';

/* ---------- Participante (sesión propia con token) ---------- */

function guardarSesionParticipante(perfil) {
  localStorage.setItem(SESION_KEY, JSON.stringify(perfil));
}

function obtenerSesionParticipante() {
  try {
    const s = JSON.parse(localStorage.getItem(SESION_KEY) || 'null');
    if (s && s.token && s.id) return s;
    if (s) localStorage.removeItem(SESION_KEY); // sesión vieja sin token: no sirve
    return null;
  } catch (e) { return null; }
}

async function cerrarSesionParticipante() {
  const ses = obtenerSesionParticipante();
  try { if (ses) await conTimeout(supabaseClient.rpc('part_cerrar_sesion', { p_token: ses.token }), 4000); } catch (e) { /* da igual */ }
  localStorage.removeItem(SESION_KEY);
  window.location.href = 'index.html';
}

async function loginParticipante(rif, password) {
  try {
    const { data, error } = await conTimeout(
      supabaseClient.rpc('login_participante', { p_rif: normalizarRIF(rif), p_password: password }),
      15000, 'timeout');
    if (error) {
      console.error('login_participante:', error);
      if (error.code === 'PGRST202' || /does not exist|Could not find/i.test(error.message || '')) {
        return { ok: false, error: 'La base de datos no está actualizada. Ejecuta database/schema.sql en Supabase.' };
      }
      return { ok: false, error: 'No se pudo conectar. Verifica tu conexión.' };
    }
    if (!data || !data.ok) return { ok: false, error: (data && data.error) || 'No se pudo iniciar sesión' };
    guardarSesionParticipante(data);
    return { ok: true, perfil: data };
  } catch (e) {
    console.error(e);
    return { ok: false, error: e.message === 'timeout' ? 'El servidor tardó demasiado en responder. Intenta de nuevo.' : 'No se pudo conectar. Verifica tu conexión.' };
  }
}

// Llama a una función RPC del participante adjuntando su token.
// Si la sesión expiró, lo manda al login.
async function rpcParticipante(fn, args = {}) {
  const ses = obtenerSesionParticipante();
  if (!ses) { window.location.href = 'index.html'; return { ok: false, error: 'sesion_invalida' }; }
  try {
    const { data, error } = await conTimeout(supabaseClient.rpc(fn, { p_token: ses.token, ...args }), 20000, 'timeout');
    if (error) { console.error(fn, error); return { ok: false, error: 'Error de conexión, intenta de nuevo.' }; }
    if (data && data.error === 'sesion_invalida') {
      localStorage.removeItem(SESION_KEY);
      window.location.href = 'index.html';
    }
    return data || { ok: false, error: 'Respuesta vacía' };
  } catch (e) {
    return { ok: false, error: e.message === 'timeout' ? 'El servidor tardó demasiado en responder.' : 'Error de conexión, intenta de nuevo.' };
  }
}

function requerirSesionParticipante() {
  const perfil = obtenerSesionParticipante();
  if (!perfil) { window.location.href = 'index.html'; return null; }
  return perfil;
}

/* ---------- Admin / Creador (Supabase Auth) ---------- */

function traducirErrorAuth(error) {
  const msg = (error && (error.message || '')) || '';
  const code = (error && error.code) || '';
  if (/invalid login credentials/i.test(msg) || code === 'invalid_credentials') return 'Correo o contraseña incorrectos';
  if (/email not confirmed/i.test(msg) || code === 'email_not_confirmed') return 'Tu correo aún no está confirmado. Confírmalo en Supabase → Authentication → Users (o ejecuta database/crear-admin.sql).';
  if (/already registered|already been registered/i.test(msg) || code === 'user_already_exists') return 'Ese correo ya está registrado en Supabase.';
  if (error && (error.status === 429 || /rate limit|too many/i.test(msg))) return 'Demasiados intentos. Espera unos minutos y vuelve a intentar.';
  if (/Failed to fetch|NetworkError|fetch/i.test(msg)) return 'No se pudo conectar con el servidor. Verifica tu internet.';
  if (/invalid api key|apikey/i.test(msg)) return 'La llave de Supabase (config.js) no es válida.';
  return msg || 'Error de autenticación';
}

// Perfil del usuario de Supabase Auth indicado: { perfil } o { error }
async function cargarPerfilDeUsuario(authUserId) {
  const { data, error } = await supabaseClient
    .from('perfiles').select(PERFIL_COLS).eq('auth_user_id', authUserId).maybeSingle();
  if (error) {
    console.error('perfiles:', error);
    return { error: `No se pudo leer tu perfil (${error.message}). Ejecuta database/schema.sql en Supabase.` };
  }
  if (!data) {
    return { error: 'Tu usuario existe en Authentication pero no tiene perfil. El administrador debe vincularlo (database/crear-admin.sql).' };
  }
  return { perfil: data };
}

// Sesión actual → { sinSesion } | { perfil } | { error }
async function resolverPerfilActual() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error || !data || !data.session) return { sinSesion: true };
  return cargarPerfilDeUsuario(data.session.user.id);
}

async function loginConEmail(email, password) {
  try {
    const { data, error } = await conTimeout(
      supabaseClient.auth.signInWithPassword({ email: String(email).trim(), password }),
      15000, 'timeout');
    if (error) return { ok: false, error: traducirErrorAuth(error) };

    const r = await conTimeout(cargarPerfilDeUsuario(data.user.id), 15000, 'timeout');
    if (r.error) { await cerrarSesionLocal(); return { ok: false, error: r.error }; }
    if (!r.perfil.activo) { await cerrarSesionLocal(); return { ok: false, error: 'Tu cuenta está inactiva.' }; }
    return { ok: true, perfil: r.perfil };
  } catch (e) {
    console.error(e);
    if (e.message === 'timeout') {
      return { ok: false, error: 'El servidor no respondió. Revisa que tu proyecto de Supabase esté activo (no pausado) y que SUPABASE_URL en config.js sea correcta. Usa "Probar conexión" abajo.' };
    }
    return { ok: false, error: 'No se pudo conectar: ' + (e.message || e) };
  }
}

function rutaPorRol(rol) {
  return rol === 'admin' ? 'admin.html' : rol === 'creador' ? 'creador.html' : 'index.html';
}

// Protege un panel: devuelve el perfil o null (ya redirigió / mostró el error)
async function requerirRol(rolEsperado) {
  let r;
  try {
    r = await conTimeout(resolverPerfilActual(), 15000, 'timeout');
  } catch (e) {
    mostrarErrorFatal('Sin respuesta del servidor', 'No se pudo verificar tu sesión. Revisa tu conexión y reintenta.');
    return null;
  }
  if (r.sinSesion) { window.location.href = 'index.html'; return null; }
  if (r.error) { mostrarErrorFatal('No se pudo cargar tu perfil', r.error); return null; }
  if (!r.perfil.activo) { mostrarErrorFatal('Cuenta inactiva', 'Tu cuenta está desactivada. Contacta al administrador.'); return null; }
  if (r.perfil.rol !== rolEsperado) {
    if (r.perfil.rol === 'admin' || r.perfil.rol === 'creador') { window.location.href = rutaPorRol(r.perfil.rol); return null; }
    mostrarErrorFatal('Acceso no permitido', 'Esta cuenta no tiene acceso a este panel.');
    return null;
  }
  return r.perfil;
}

// Cierra sesión sin depender de la red (scope local)
async function cerrarSesionLocal() {
  try { await conTimeout(supabaseClient.auth.signOut({ scope: 'local' }), 4000); } catch (e) { /* da igual */ }
  try { Object.keys(localStorage).filter(k => k.startsWith('sb-') || k === 'digitalsan-auth').forEach(k => localStorage.removeItem(k)); } catch (e) {}
}

async function cerrarSesion() {
  await cerrarSesionLocal();
  window.location.href = 'index.html';
}
