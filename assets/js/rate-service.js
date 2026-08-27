/* =========================================================
   DigitalSAN — Servicio de tasa de cambio USDT/VES
   Fuente: ve.dolarapi.com (dólar paralelo, referenciado al mercado
   P2P de Binance — es la forma pública y sin autenticación más
   fiable de obtener esta tasa desde el navegador; Binance P2P no
   ofrece un endpoint público con CORS habilitado). Si la petición
   falla, se usa el último valor en caché o la tasa manual que el
   admin/creador puede definir en la tabla `configuracion`.
   ========================================================= */

const RATE_CACHE_KEY = 'digitalsan_tasa_usdt_v1';
const RATE_CACHE_MS = 10 * 60 * 1000; // 10 minutos
const RATE_API_URL = 'https://ve.dolarapi.com/v1/dolares/paralelo';

async function obtenerTasaUSDT(forzar = false) {
  let cache = null;
  try { cache = JSON.parse(localStorage.getItem(RATE_CACHE_KEY) || 'null'); } catch (e) {}

  if (!forzar && cache && (Date.now() - cache.timestamp < RATE_CACHE_MS)) {
    return cache;
  }

  try {
    const res = await fetch(RATE_API_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('API no disponible');
    const data = await res.json();
    const tasa = data.promedio || data.venta || data.compra;
    if (!tasa) throw new Error('Tasa vacía');

    const resultado = {
      tasa: Number(tasa),
      fuente: 'Binance P2P (ref. paralelo)',
      fechaActualizacion: data.fechaActualizacion || new Date().toISOString(),
      timestamp: Date.now(),
      offline: false
    };
    localStorage.setItem(RATE_CACHE_KEY, JSON.stringify(resultado));
    return resultado;
  } catch (err) {
    if (cache) return { ...cache, offline: true };
    const manual = await obtenerTasaManual();
    return { tasa: manual, fuente: 'Manual (respaldo)', timestamp: Date.now(), offline: true };
  }
}

async function obtenerTasaManual() {
  try {
    const { data } = await supabaseClient.from('configuracion').select('valor').eq('clave', 'tasa_manual_usdt').single();
    return data ? Number(data.valor) : 0;
  } catch (e) { return 0; }
}

async function guardarTasaManual(valor) {
  return supabaseClient.from('configuracion').update({ valor: String(valor) }).eq('clave', 'tasa_manual_usdt');
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
