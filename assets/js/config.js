/* =========================================================
   DigitalSAN — Configuración de Supabase
   1) Ejecuta database/schema.sql en el SQL Editor de tu proyecto
      (si aún no lo has hecho, la app no tendrá tablas y no
      "sincronizará" nada aunque las llaves de aquí estén bien).
   2) Estas llaves son públicas por diseño (van en el navegador
      del participante) — la seguridad real la da el RLS del
      schema.sql, no el secreto de esta llave.

   ⚠️ IMPORTANTE: la "service_role key" de Supabase NUNCA debe ir
   en este archivo ni en ningún archivo del frontend. Esa llave
   se salta todas las políticas de seguridad (RLS) — si alguien la
   copia desde el código fuente de tu web, tendría acceso total de
   administrador a tu base de datos (leer, editar o borrar
   cualquier cosa). Úsala solo dentro del Dashboard de Supabase o
   en un backend/Edge Function privado, nunca aquí.
   ========================================================= */

const SUPABASE_URL = 'https://lbqtqjahgqitomjyaisz.supabase.co';

// Llave pública "anon" (formato JWT clásico) — es la que usa supabaseClient.
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicXRxamFoZ3FpdG9tanlhaXN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MTQ3MTksImV4cCI6MjEwMzM5MDcxOX0.rOq3Su0eQJePMez7p5Bs4lWU9VWyp-5Kyaut6HLwieI';

// Alternativa equivalente: la nueva "publishable key" de Supabase
// (mismo nivel de acceso público que la anon key de arriba).
// const SUPABASE_ANON_KEY = 'sb_publishable_yATGNR3XU_XIzgDhmGRfNA_OfRzLAiA';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Datos de marca / contacto usados en toda la app
const APP_INFO = {
  nombre: 'DigitalSAN',
  soporteWhatsapp: '584228745777',
  autor: 'gabora646'
};
