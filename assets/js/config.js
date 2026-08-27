/* =========================================================
   DigitalSAN — Configuración de Supabase
   1) Crea un proyecto gratis en https://supabase.com
   2) Ve a Project Settings → API
   3) Pega aquí tu "Project URL" y tu "anon public" key
   4) Ejecuta database/schema.sql en el SQL Editor de Supabase
   ========================================================= */

const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
const SUPABASE_ANON_KEY = 'TU-ANON-KEY-PUBLICA';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Datos de marca / contacto usados en toda la app
const APP_INFO = {
  nombre: 'DigitalSAN',
  soporteWhatsapp: '584228745777',
  autor: 'gabora646'
};
