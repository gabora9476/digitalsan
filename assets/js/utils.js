/* =========================================================
   DigitalSAN — Utilidades compartidas
   ========================================================= */

/* ---------- Seguridad / robustez ---------- */

// Escapa texto antes de meterlo en innerHTML (evita inyección de HTML/JS)
function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Rechaza si una promesa tarda más de `ms` (evita spinners infinitos)
function conTimeout(promesa, ms, mensaje) {
  let t;
  const limite = new Promise((_, reject) => { t = setTimeout(() => reject(new Error(mensaje || 'timeout')), ms); });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(t));
}

function uuidSimple() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/* ---------- Fechas del San ---------- */

// Suma un periodo (según frecuencia) a una fecha, devuelve nueva fecha (Date).
// Mensual: respeta fin de mes (31 ene + 1 mes = 28/29 feb), igual que Postgres.
function sumarPeriodo(fecha, frecuencia, n = 1) {
  const d = new Date(fecha);
  if (frecuencia === 'semanal') d.setDate(d.getDate() + 7 * n);
  else if (frecuencia === 'quincenal') d.setDate(d.getDate() + 15 * n);
  else if (frecuencia === 'mensual') {
    const dia = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    const ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(dia, ultimoDia));
  }
  return d;
}

// Calendario completo de turnos: { fechas: [Date,...], fechaFin: Date }
function calcularCalendarioSan(fechaInicioStr, frecuencia, numParticipantes) {
  const fechaInicio = new Date(fechaInicioStr + 'T12:00:00');
  const fechas = [];
  for (let i = 0; i < numParticipantes; i++) fechas.push(sumarPeriodo(fechaInicio, frecuencia, i));
  return { fechas, fechaFin: fechas[fechas.length - 1] };
}

function formatearFecha(fecha) {
  if (!fecha) return '—';
  const d = typeof fecha === 'string' ? new Date(fecha + (fecha.length <= 10 ? 'T12:00:00' : '')) : fecha;
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
}

// YYYY-MM-DD en hora LOCAL (toISOString usa UTC y puede correr el día)
function fechaISO(fecha) {
  const d = new Date(fecha);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function hoyISO() { return fechaISO(new Date()); }

function diasHastaVencer(fechaISOStr) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const venc = new Date(fechaISOStr + 'T00:00:00');
  return Math.round((venc - hoy) / 86400000);
}

// Un pago "pendiente" cuya fecha ya pasó se considera "atrasado"
function estadoPagoEfectivo(pago) {
  return pago.estado === 'pendiente' && diasHastaVencer(pago.fecha_vencimiento) < 0 ? 'atrasado' : pago.estado;
}

/* ---------- Formato de moneda ---------- */

function formatoUSD(monto) {
  if (monto === null || monto === undefined) return '—';
  return '$' + Number(monto).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatoVES(monto) {
  if (monto === null || monto === undefined) return '—';
  return 'Bs. ' + Number(monto).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function convertirUSDaVES(montoUSD, tasa) {
  if (!tasa) return null;
  return Math.round(Number(montoUSD) * Number(tasa) * 100) / 100;
}

/* ---------- WhatsApp ---------- */

// Normaliza un número venezolano a formato internacional sin '+' ni espacios (58412xxxxxxx)
function normalizarWhatsapp(numero) {
  if (!numero) return '';
  let n = String(numero).replace(/[^\d]/g, '');
  if (n.startsWith('0')) n = '58' + n.slice(1);
  if (!n.startsWith('58')) n = '58' + n;
  return n;
}

function linkWhatsapp(numero, mensaje) {
  return `https://wa.me/${normalizarWhatsapp(numero)}?text=${encodeURIComponent(mensaje)}`;
}

function abrirWhatsapp(numero, mensaje) {
  window.open(linkWhatsapp(numero, mensaje), '_blank');
}

/* ---------- Cédula / RIF ---------- */

// Forma canónica: letra + dígitos, sin guiones (V-12.345.678 → V12345678).
// Si solo escriben números se asume V (venezolano).
function normalizarRIF(rif) {
  let r = String(rif || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^\d/.test(r)) r = 'V' + r;
  return r;
}

function validarRIF(rif) {
  return /^[VEJPG]\d{6,10}$/.test(normalizarRIF(rif));
}

/* ---------- Contraseña temporal ---------- */

// 8 caracteres aleatorios (sin letras confusas como O/0, l/1)
function generarPasswordTemporal() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const arr = new Uint32Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr, n => chars[n % chars.length]).join('');
}

/* ---------- Toasts ---------- */

function toast(mensaje, tipo = 'info') {
  let host = document.getElementById('toastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toastHost';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.textContent = mensaje;
  host.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; setTimeout(() => el.remove(), 250); }, 3200);
}

/* ---------- Sheets / modales genéricos ---------- */

function cerrarOverlay(el) {
  const overlay = el.closest ? el.closest('.overlay') : el;
  if (overlay) overlay.remove();
}

function cerrarTodosOverlays() {
  document.querySelectorAll('.overlay').forEach(o => o.remove());
}

function abrirSheet(html, { centered = false, cerrable = true } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay' + (centered ? ' centered' : '');
  overlay.innerHTML = `<div class="sheet">${centered ? '' : '<div class="sheet-handle"></div>'}${html}</div>`;
  if (cerrable) overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  return overlay;
}

// Pantalla de error que no se puede ignorar (con salida: reintentar / cerrar sesión)
function mostrarErrorFatal(titulo, detalle) {
  cerrarTodosOverlays();
  return abrirSheet(`
    <div class="sheet-header"><h3>${esc(titulo)}</h3></div>
    <p class="muted" style="font-size:13px;line-height:1.5;">${esc(detalle)}</p>
    <div class="flex gap-8 mt-16">
      <button class="btn btn-ghost grow" onclick="location.reload()">Reintentar</button>
      <button class="btn btn-danger grow" onclick="cerrarSesion()">Cerrar sesión</button>
    </div>
  `, { centered: true, cerrable: false });
}

/* ---------- Iniciales para avatar ---------- */

function iniciales(nombre) {
  if (!nombre) return '?';
  const partes = String(nombre).trim().split(/\s+/);
  return ((partes[0]?.[0] || '') + (partes[1]?.[0] || '')).toUpperCase();
}

/* ---------- Comprobantes de pago ---------- */

// comprobante_url guarda la ruta dentro del bucket (o una URL completa en datos antiguos)
function urlComprobante(valor) {
  if (!valor) return null;
  if (/^https?:\/\//i.test(valor)) return valor;
  try { return supabaseClient.storage.from('comprobantes').getPublicUrl(valor).data.publicUrl; } catch (e) { return null; }
}

/* ---------- Etiquetas ---------- */

const ETIQUETAS_FRECUENCIA = { semanal: 'Semanal', quincenal: 'Quincenal', mensual: 'Mensual' };
const ETIQUETAS_ESTADO_PAGO = {
  pendiente: { texto: 'Pendiente', clase: 'badge-muted' },
  reportado: { texto: 'Reportado', clase: 'badge-warn' },
  validado: { texto: 'Validado', clase: 'badge-success' },
  atrasado: { texto: 'Atrasado', clase: 'badge-danger' }
};
const ETIQUETAS_ESTADO_SAN = {
  planificacion: { texto: 'Planificación', clase: 'badge-muted' },
  activo: { texto: 'Activo', clase: 'badge-success' },
  finalizado: { texto: 'Finalizado', clase: 'badge-gold' },
  cancelado: { texto: 'Cancelado', clase: 'badge-danger' }
};
const ETIQUETAS_METODO = { libre: 'Libre', sorteo: 'Sorteo', manual: 'Manual' };

/* ---------- Loading de botón ---------- */

function botonCargando(btn, cargando, textoOriginal) {
  if (!btn) return;
  if (cargando) {
    if (!btn.dataset.cargando) btn.dataset.textoOriginal = btn.innerHTML;
    btn.dataset.cargando = '1';
    btn.innerHTML = '<span class="loader"></span>';
    btn.disabled = true;
  } else {
    btn.innerHTML = textoOriginal || btn.dataset.textoOriginal || btn.innerHTML;
    delete btn.dataset.cargando;
    btn.disabled = false;
  }
}
