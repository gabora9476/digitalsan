/* =========================================================
   DigitalSAN — Utilidades compartidas
   ========================================================= */

/* ---------- Fechas del San ---------- */

// Suma un periodo (según frecuencia) a una fecha, devuelve nueva fecha (Date)
function sumarPeriodo(fecha, frecuencia, n = 1) {
  const d = new Date(fecha);
  if (frecuencia === 'semanal') d.setDate(d.getDate() + 7 * n);
  else if (frecuencia === 'quincenal') d.setDate(d.getDate() + 15 * n);
  else if (frecuencia === 'mensual') d.setMonth(d.getMonth() + n);
  return d;
}

// Genera el calendario completo de turnos de un San.
// Devuelve { fechas: [Date,...] (una por turno, empezando en fecha_inicio), fechaFin: Date }
function calcularCalendarioSan(fechaInicioStr, frecuencia, numParticipantes) {
  const fechaInicio = new Date(fechaInicioStr + 'T12:00:00');
  const fechas = [];
  for (let i = 0; i < numParticipantes; i++) {
    fechas.push(sumarPeriodo(fechaInicio, frecuencia, i));
  }
  const fechaFin = fechas[fechas.length - 1];
  return { fechas, fechaFin };
}

function formatearFecha(fecha) {
  if (!fecha) return '—';
  const d = typeof fecha === 'string' ? new Date(fecha + (fecha.length <= 10 ? 'T12:00:00' : '')) : fecha;
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fechaISO(fecha) {
  const d = new Date(fecha);
  return d.toISOString().slice(0, 10);
}

function diasHastaVencer(fechaISOStr) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const venc = new Date(fechaISOStr + 'T00:00:00');
  return Math.round((venc - hoy) / 86400000);
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
  let n = numero.replace(/[^\d]/g, '');
  if (n.startsWith('0')) n = '58' + n.slice(1);
  if (!n.startsWith('58')) n = '58' + n;
  return n;
}

function linkWhatsapp(numero, mensaje) {
  const n = normalizarWhatsapp(numero);
  return `https://wa.me/${n}?text=${encodeURIComponent(mensaje)}`;
}

function abrirWhatsapp(numero, mensaje) {
  window.open(linkWhatsapp(numero, mensaje), '_blank');
}

/* ---------- RIF ---------- */

function validarRIF(rif) {
  return /^[VEJPGvejpg]-?\d{6,9}-?\d?$/.test((rif || '').trim());
}

function normalizarRIF(rif) {
  return (rif || '').trim().toUpperCase().replace(/\s+/g, '');
}

/* ---------- Contraseña temporal ---------- */

function generarPasswordTemporal(rif) {
  const digitos = (rif || '').replace(/\D/g, '').slice(-6) || '123456';
  const extra = Math.floor(10 + Math.random() * 89);
  return digitos + extra;
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
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; setTimeout(() => el.remove(), 250); }, 2600);
}

/* ---------- Sheets / modales genéricos ---------- */

function cerrarOverlay(el) {
  const overlay = el.closest ? el.closest('.overlay') : el;
  if (overlay) overlay.remove();
}

function abrirSheet(html, { centered = false } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay' + (centered ? ' centered' : '');
  overlay.innerHTML = `<div class="sheet">${centered ? '' : '<div class="sheet-handle"></div>'}${html}</div>`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  return overlay;
}

/* ---------- Iniciales para avatar ---------- */

function iniciales(nombre) {
  if (!nombre) return '?';
  const partes = nombre.trim().split(/\s+/);
  return ((partes[0]?.[0] || '') + (partes[1]?.[0] || '')).toUpperCase();
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

/* ---------- Loading de botón ---------- */

function botonCargando(btn, cargando, textoOriginal) {
  if (cargando) {
    btn.dataset.textoOriginal = btn.innerHTML;
    btn.innerHTML = '<span class="loader"></span>';
    btn.disabled = true;
  } else {
    btn.innerHTML = textoOriginal || btn.dataset.textoOriginal || btn.innerHTML;
    btn.disabled = false;
  }
}
