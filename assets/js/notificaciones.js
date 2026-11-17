/* =========================================================
   DigitalSAN — Notificaciones y tiempo real
   - Centro de notificaciones propio (campana + contador)
   - Aviso en pantalla, sonido y vibración
   - Notificación del sistema (Android / iOS instalada como app)
   - Tiempo real por canales broadcast de Supabase + respaldo por sondeo
   ========================================================= */

const Notif = (() => {
  let clave = null;
  let items = [];
  let botonId = null;
  const tituloBase = document.title;

  const kItems = () => 'ds_notif_' + clave;

  function cargar() {
    try { items = JSON.parse(localStorage.getItem(kItems()) || '[]'); } catch (e) { items = []; }
  }
  function guardar() {
    try { localStorage.setItem(kItems(), JSON.stringify(items.slice(0, 50))); } catch (e) {}
  }
  const noLeidas = () => items.filter(n => !n.leida).length;

  function actualizarBadge() {
    const n = noLeidas();
    const btn = document.getElementById(botonId);
    if (btn) {
      const b = btn.querySelector('.bell-badge');
      if (b) { b.textContent = n > 9 ? '9+' : String(n); b.classList.toggle('hidden', n === 0); }
    }
    document.title = (n ? `(${n}) ` : '') + tituloBase;
    try { if (navigator.setAppBadge) { n ? navigator.setAppBadge(n) : navigator.clearAppBadge(); } } catch (e) {}
  }

  /* ---------- Service worker (necesario para notificaciones en Android y para instalar en iOS) ---------- */
  let swReg = null;
  async function registrarSW() {
    if (!('serviceWorker' in navigator)) return null;
    try { swReg = await navigator.serviceWorker.register('./sw.js'); } catch (e) { console.warn('SW:', e); }
    return swReg;
  }

  function sonido() {
    try {
      const A = window.AudioContext || window.webkitAudioContext;
      if (!A) return;
      const c = new A(), o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.15, c.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.35);
      o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.4);
      setTimeout(() => { try { c.close(); } catch (e) {} }, 700);
    } catch (e) {}
  }

  async function avisoSistema(titulo, texto) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const opts = {
      body: texto, icon: './assets/img/icon-192.png', badge: './assets/img/favicon-32.png',
      tag: 'ds-' + Date.now(), vibrate: [120, 60, 120], data: { url: './' }
    };
    try {
      const reg = swReg || (navigator.serviceWorker && await navigator.serviceWorker.getRegistration());
      if (reg && reg.showNotification) await reg.showNotification(titulo, opts);
      else new Notification(titulo, opts);
    } catch (e) { console.warn('Notificación:', e); }
  }

  /* ---------- API ---------- */

  function init(id, btnId) {
    clave = id; botonId = btnId;
    cargar();
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.innerHTML = ico('bell') + '<span class="bell-badge hidden">0</span>';
      btn.addEventListener('click', abrirPanel);
    }
    actualizarBadge();
  }

  // Registra un aviso nuevo: lista + toast + sonido + vibración (+ sistema si la app está en segundo plano)
  function agregar({ titulo, texto, icono = 'bell' }) {
    items.unshift({ id: Date.now() + Math.random(), t: Date.now(), titulo, texto, icono, leida: false });
    guardar(); actualizarBadge();
    toast(`${titulo}: ${texto}`, 'success');
    sonido();
    try { navigator.vibrate && navigator.vibrate([120, 60, 120]); } catch (e) {}
    if (document.hidden) avisoSistema(titulo, texto);
  }

  // Compara estados guardados con los actuales y avisa de cambios (la primera vez solo guarda la base)
  function detectarCambios(nombre, actual, alCambiar) {
    const k = `ds_est_${clave}_${nombre}`;
    let previo = null;
    try { previo = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) {}
    if (previo) for (const id of Object.keys(actual)) { if (previo[id] !== actual[id]) alCambiar(id, previo[id], actual[id]); }
    try { localStorage.setItem(k, JSON.stringify(actual)); } catch (e) {}
  }

  function tiempo(t) {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'ahora';
    if (m < 60) return `hace ${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `hace ${h} h`;
    return new Date(t).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' });
  }

  function estadoPermiso() {
    if (!('Notification' in window)) return 'no-soportado';
    return Notification.permission; // default | granted | denied
  }

  function abrirPanel() {
    const permiso = estadoPermiso();
    let bloquePermiso = '';
    if (permiso === 'granted') {
      bloquePermiso = `<p class="hint" style="color:var(--success);">${ico('checkCircle')} Avisos del dispositivo activados.</p>`;
    } else if (permiso === 'denied') {
      bloquePermiso = `<p class="hint">Bloqueaste los avisos en el navegador. Actívalos en los ajustes del sitio (candado junto a la dirección) y recarga.</p>`;
    } else if (permiso === 'default') {
      bloquePermiso = `<button class="btn btn-primary btn-block" id="btnPermisoNotif">${ico('bell')} Activar avisos del dispositivo</button>`;
    } else {
      bloquePermiso = `<p class="hint">En iPhone/iPad: abre la página en Safari, toca Compartir → "Añadir a pantalla de inicio" y ábrela desde ese ícono para poder activar los avisos del dispositivo.</p>`;
    }

    const lista = items.length
      ? items.map(n => `
        <div class="notif-item ${n.leida ? '' : 'nueva'}">
          <div class="ni-ico">${ico(n.icono || 'bell')}</div>
          <div><b>${esc(n.titulo)}</b><small>${esc(n.texto)}</small><div class="ni-hora">${tiempo(n.t)}</div></div>
        </div>`).join('')
      : `<div class="empty"><div class="ico">${ico('bell')}</div><b>Sin notificaciones</b><p>Aquí verás los avisos en tiempo real.</p></div>`;

    const o = abrirSheet(`
      <div class="sheet-header"><h3>Notificaciones</h3><button class="btn btn-icon btn-ghost" onclick="cerrarOverlay(this)">${ico('x')}</button></div>
      ${bloquePermiso}
      <div class="list mt-12" style="display:flex;flex-direction:column;">${lista}</div>
      ${items.length ? `<button class="btn btn-ghost btn-block mt-12" id="btnLimpiarNotif">Borrar todas</button>` : ''}
    `);

    items.forEach(n => n.leida = true); guardar(); actualizarBadge();

    const bp = o.querySelector('#btnPermisoNotif');
    if (bp) bp.addEventListener('click', async () => {
      try {
        const r = await Notification.requestPermission();
        if (r === 'granted') { toast('Avisos activados', 'success'); avisoSistema('DigitalSAN', 'Los avisos están activados en este dispositivo.'); }
      } catch (e) {}
      cerrarOverlay(o); abrirPanel();
    });
    const bl = o.querySelector('#btnLimpiarNotif');
    if (bl) bl.addEventListener('click', () => { items = []; guardar(); actualizarBadge(); cerrarOverlay(o); });
  }

  /* ---------- Tiempo real ---------- */

  // Escucha un canal broadcast; `alEvento` se llama cuando la base de datos avisa de un cambio
  function suscribir(canal, alEvento) {
    try {
      const ch = supabaseClient.channel(canal, { config: { broadcast: { self: false } } })
        .on('broadcast', { event: 'cambio' }, (m) => { try { alEvento(m.payload || {}); } catch (e) { console.error(e); } })
        .subscribe();
      return ch;
    } catch (e) { console.warn('Realtime no disponible:', e); return null; }
  }

  // Respaldo: refresca cada cierto tiempo y al volver a la pestaña
  function autoActualizar(fn, ms = 30000) {
    setInterval(() => { if (!document.hidden) fn(); }, ms);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) fn(); });
    window.addEventListener('online', fn);
  }

  // Evita ejecutar `fn` muchas veces seguidas (y solapadas)
  function sinSolape(fn, espera = 500) {
    let t = null, corriendo = false, pendiente = false;
    const ejecutar = async () => {
      if (corriendo) { pendiente = true; return; }
      corriendo = true;
      try { await fn(); } finally { corriendo = false; if (pendiente) { pendiente = false; ejecutar(); } }
    };
    return () => { clearTimeout(t); t = setTimeout(ejecutar, espera); };
  }

  return { init, agregar, detectarCambios, registrarSW, suscribir, autoActualizar, sinSolape, abrirPanel };
})();
