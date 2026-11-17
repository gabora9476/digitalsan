/* =========================================================
   DigitalSAN — Servicio de tasa de cambio USDT/VES
   Fuente: ve.dolarapi.com (dólar paralelo, referencia del mercado
   P2P). Binance P2P no ofrece endpoint público con CORS, por eso se
   usa esta fuente pública sin autenticación, con caché de 10 min.
   Si falla: último valor en caché o tasa manual (tabla `configuracion`).
   ========================================================= */

const RATE_CACHE_KEY = 'digitalsan_tasa_usdt_v1';
const RATE_CACHE_MS = 10 * 60 * 1000;
const RATE_API_URL = 'https://ve.dolarapi.com/v1/dolares/paralelo';

async function obtenerTasaUSDT(forzar = false) {
  let cache = null;
  try { cache = JSON.parse(localStorage.getItem(RATE_CACHE_KEY) || 'null'); } catch (e) {}

  if (!forzar && cache && cache.tasa && (Date.now() - cache.timestamp < RATE_CACHE_MS)) return cache;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(RATE_API_URL, { cache: 'no-store', signal: ctrl.signal }).finally(() => clearTimeout(t));
    if (!res.ok) throw new Error('API no disponible');
    const data = await res.json();
    const tasa = Number(data.promedio || data.venta || data.compra);
    if (!tasa || !isFinite(tasa)) throw new Error('Tasa vacía');

    const resultado = {
      tasa,
      fuente: 'DolarAPI · paralelo (ref. P2P)',
      fechaActualizacion: data.fechaActualizacion || new Date().toISOString(),
      timestamp: Date.now(),
      offline: false
    };
    localStorage.setItem(RATE_CACHE_KEY, JSON.stringify(resultado));
    return resultado;
  } catch (err) {
    if (cache && cache.tasa) return { ...cache, offline: true };
    const manual = await obtenerTasaManual();
    return { tasa: manual, fuente: 'Manual (respaldo)', timestamp: Date.now(), offline: true };
  }
}

async function obtenerTasaManual() {
  try {
    const { data } = await supabaseClient.from('configuracion').select('valor').eq('clave', 'tasa_manual_usdt').maybeSingle();
    return data ? Number(data.valor) || 0 : 0;
  } catch (e) { return 0; }
}

async function guardarTasaManual(valor) {
  return supabaseClient.from('configuracion').upsert({ clave: 'tasa_manual_usdt', valor: String(valor || 0) });
}

// Pinta un <div class="rate-chip"> en el elemento con id `elId`
async function renderRateChip(elId, forzar = false) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = `<span class="dot"></span><span class="muted">Tasa USDT</span> <span class="loader" style="width:11px;height:11px;border-width:2px;"></span>`;
  const info = await obtenerTasaUSDT(forzar);
  if (!info.tasa) {
    el.innerHTML = `<span class="dot" style="background:var(--danger)"></span><span class="muted">Tasa no disponible</span>`;
    return;
  }
  el.innerHTML = `<span class="dot"></span><span class="muted">USDT ref.</span> <b>${formatoVES(info.tasa)}</b>${info.offline ? ' <span class="muted">(caché)</span>' : ''}`;
  el.title = `Fuente: ${info.fuente} · Actualizado: ${new Date(info.fechaActualizacion || info.timestamp).toLocaleString('es-VE')}`;
}
