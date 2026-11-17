/* =========================================================
   DigitalSAN — Configuración de Supabase
   1) Ejecuta database/schema.sql en el SQL Editor de tu proyecto.
   2) Ejecuta database/crear-admin.sql para vincular tu usuario admin.
   3) Estas llaves son públicas por diseño (van en el navegador);
      la seguridad real la dan el RLS y las funciones del schema.sql.

   ⚠️ NUNCA pongas aquí la "service_role key" de Supabase: se salta
   todas las políticas de seguridad y daría acceso total a tu base
   de datos a cualquiera que vea el código fuente.
   ========================================================= */

const SUPABASE_URL = 'https://lbqtqjahgqitomjyaisz.supabase.co';

// Llave pública "anon" (JWT clásico) — es la que usa supabaseClient.
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicXRxamFoZ3FpdG9tanlhaXN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MTQ3MTksImV4cCI6MjEwMzM5MDcxOX0.rOq3Su0eQJePMez7p5Bs4lWU9VWyp-5Kyaut6HLwieI';

// Datos de marca / contacto usados en toda la app
const APP_INFO = {
  nombre: 'DigitalSAN',
  soporteWhatsapp: '584228745777',
  autor: 'gabora646'
};

// Aviso visible si la librería de Supabase no cargó (CDN bloqueado, sin internet, etc.)
function mostrarErrorCritico(mensaje) {
  const poner = () => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(7,12,22,.96);color:#f4f7fb;font-family:system-ui,sans-serif;text-align:center;';
    d.innerHTML = '<div style="max-width:380px"><div style="font-size:34px">⚠️</div><h3 style="margin:8px 0">No se pudo iniciar la app</h3><p style="color:#c4cddc;font-size:14px;line-height:1.5"></p><button style="margin-top:14px;padding:10px 18px;border:0;border-radius:12px;background:#14b8a6;color:#04140f;font-weight:700" onclick="location.reload()">Reintentar</button></div>';
    d.querySelector('p').textContent = mensaje;
    document.body.appendChild(d);
  };
  if (document.body) poner(); else document.addEventListener('DOMContentLoaded', poner);
}

if (!window.supabase || typeof window.supabase.createClient !== 'function') {
  mostrarErrorCritico('No se pudo cargar la librería de Supabase. Revisa tu conexión a internet o desactiva el bloqueador de anuncios/VPN y recarga.');
  throw new Error('supabase-js no se cargó');
}

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'digitalsan-auth',
    // Sin Web Locks: evita que el login se quede colgado esperando un "lock" huérfano
    lock: async (name, acquireTimeout, fn) => await fn()
  }
});
