/* =========================================================
   DigitalSAN — Sesión y autenticación
   admin / creador -> Supabase Auth (email + password)
   participante    -> login propio vía RPC login_participante()
                       (sesión ligera guardada en localStorage)
   ========================================================= */

const SESION_KEY = 'digitalsan_sesion_participante';

/* ---------- Participante (sesión propia) ---------- */

function guardarSesionParticipante(perfil) {
  localStorage.setItem(SESION_KEY, JSON.stringify(perfil));
}

function obtenerSesionParticipante() {
  try { return JSON.parse(localStorage.getItem(SESION_KEY) || 'null'); } catch (e) { return null; }
}

function cerrarSesionParticipante() {
  localStorage.removeItem(SESION_KEY);
  window.location.href = 'index.html';
}

async function loginParticipante(rif, password) {
  const { data, error } = await supabaseClient.rpc('login_participante', {
    p_rif: normalizarRIF(rif),
    p_password: password
  });
  if (error) return { ok: false, error: 'No se pudo conectar. Verifica tu conexión.' };
  if (!data.ok) return { ok: false, error: data.error };
  guardarSesionParticipante(data);
  return { ok: true, perfil: data };
}

function requerirSesionParticipante() {
  const perfil = obtenerSesionParticipante();
  if (!perfil) { window.location.href = 'index.html'; return null; }
  return perfil;
}

/* ---------- Admin / Creador (Supabase Auth) ---------- */

async function loginConEmail(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: 'Correo o contraseña incorrectos' };

  const { data: perfil, error: errPerfil } = await supabaseClient
    .from('perfiles').select('*').eq('auth_user_id', data.user.id).single();

  if (errPerfil || !perfil) {
    await supabaseClient.auth.signOut();
    return { ok: false, error: 'Este usuario no tiene un perfil asignado. Contacta al administrador.' };
  }
  if (!perfil.activo) {
    await supabaseClient.auth.signOut();
    return { ok: false, error: 'Tu cuenta está inactiva.' };
  }
  return { ok: true, perfil };
}

async function obtenerPerfilAutenticado() {
  const { data: sesion } = await supabaseClient.auth.getSession();
  if (!sesion?.session) return null;
  const { data: perfil } = await supabaseClient
    .from('perfiles').select('*').eq('auth_user_id', sesion.session.user.id).single();
  return perfil || null;
}

async function requerirRol(rolEsperado) {
  const perfil = await obtenerPerfilAutenticado();
  if (!perfil || perfil.rol !== rolEsperado) {
    window.location.href = 'index.html';
    return null;
  }
  return perfil;
}

async function cerrarSesion() {
  await supabaseClient.auth.signOut();
  window.location.href = 'index.html';
}
