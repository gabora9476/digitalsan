-- =========================================================
-- DigitalSAN — Esquema de base de datos (Supabase / Postgres)
-- Ejecutar completo en: Supabase → SQL Editor → New query → Run
-- =========================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------
-- 1. PERFILES (admin, creador, participante)
-- ---------------------------------------------------------
-- admin y creador  -> id = auth.users.id (login con Supabase Auth, email+password)
-- participante     -> id propio (uuid), login propio por RIF + password
--                     (no usa auth.users porque los crea el creador en lote)
create table if not exists perfiles (
  id                uuid primary key default gen_random_uuid(),
  auth_user_id      uuid unique references auth.users(id) on delete cascade,
  rol               text not null check (rol in ('admin','creador','participante')),
  nombre_completo   text not null,
  rif               text unique,
  whatsapp          text not null,
  direccion         text,
  email             text,
  password_hash     text,                 -- solo participantes (login propio)
  creado_por        uuid references perfiles(id) on delete set null, -- creador dueño del participante
  primer_login      boolean not null default true,
  activo            boolean not null default true,
  created_at        timestamptz not null default now()
);

create index if not exists idx_perfiles_rol on perfiles(rol);
create index if not exists idx_perfiles_creado_por on perfiles(creado_por);
create index if not exists idx_perfiles_rif on perfiles(rif);

-- Column-level grants: nunca exponer password_hash por la API pública
revoke all on perfiles from anon, authenticated;
grant select (id, auth_user_id, rol, nombre_completo, rif, whatsapp, direccion, email,
              creado_por, primer_login, activo, created_at) on perfiles to anon, authenticated;
grant insert (id, rol, nombre_completo, rif, whatsapp, direccion, email, password_hash,
              creado_por, primer_login, activo) on perfiles to authenticated;
grant update (nombre_completo, rif, whatsapp, direccion, email, primer_login, activo,
              password_hash) on perfiles to authenticated;

-- ---------------------------------------------------------
-- 2. SANES (cada San/tanda creado por un creador)
-- ---------------------------------------------------------
create table if not exists sanes (
  id                  uuid primary key default gen_random_uuid(),
  creador_id          uuid not null references perfiles(id) on delete cascade,
  nombre              text not null,
  tipo                text not null check (tipo in ('monetario','personalizado')) default 'monetario',
  descripcion_articulo text,                 -- solo si tipo = personalizado
  moneda_base         text not null default 'USD' check (moneda_base in ('USD','VES')),
  monto_cuota         numeric(14,2) not null,     -- monto por turno/participante
  num_participantes   int not null check (num_participantes > 1),
  monto_total         numeric(14,2) not null,     -- monto_cuota * num_participantes
  frecuencia          text not null check (frecuencia in ('semanal','quincenal','mensual')),
  metodo_asignacion   text not null default 'sorteo' check (metodo_asignacion in ('sorteo','manual','libre')),
  fecha_inicio        date not null,
  fecha_fin           date,                        -- calculada automáticamente
  estado              text not null default 'planificacion'
                        check (estado in ('planificacion','activo','finalizado','cancelado')),
  created_at          timestamptz not null default now()
);

create index if not exists idx_sanes_creador on sanes(creador_id);

-- ---------------------------------------------------------
-- 3. NÚMEROS / CUPOS del San (uno por turno de cobro)
-- ---------------------------------------------------------
create table if not exists numeros_san (
  id                uuid primary key default gen_random_uuid(),
  san_id            uuid not null references sanes(id) on delete cascade,
  numero            int not null,
  participante_id   uuid references perfiles(id) on delete set null,
  fecha_turno       date,                     -- fecha de cobro calculada para ese número
  estado            text not null default 'disponible' check (estado in ('disponible','ocupado')),
  unique (san_id, numero)
);

create index if not exists idx_numeros_san_san on numeros_san(san_id);
create index if not exists idx_numeros_san_participante on numeros_san(participante_id);

-- ---------------------------------------------------------
-- 4. PAGOS (cuotas que cada participante debe pagar)
-- ---------------------------------------------------------
create table if not exists pagos (
  id                uuid primary key default gen_random_uuid(),
  san_id            uuid not null references sanes(id) on delete cascade,
  participante_id   uuid not null references perfiles(id) on delete cascade,
  numero_cuota      int not null,             -- 1..num_participantes
  fecha_vencimiento date not null,
  monto_usd         numeric(14,2) not null,
  monto_ves         numeric(16,2),
  tasa_aplicada     numeric(12,4),
  fecha_pago        timestamptz,
  estado            text not null default 'pendiente'
                      check (estado in ('pendiente','reportado','validado','atrasado')),
  comprobante_url   text,
  referencia        text,
  validado_por      uuid references perfiles(id),
  created_at        timestamptz not null default now()
);

create index if not exists idx_pagos_san on pagos(san_id);
create index if not exists idx_pagos_participante on pagos(participante_id);
create index if not exists idx_pagos_estado on pagos(estado);

-- ---------------------------------------------------------
-- 5. SORTEOS (asignación aleatoria de números)
-- ---------------------------------------------------------
create table if not exists sorteos (
  id                uuid primary key default gen_random_uuid(),
  san_id            uuid not null references sanes(id) on delete cascade,
  fecha_sorteo      timestamptz not null default now(),
  numero_ganador    int,
  participante_id   uuid references perfiles(id),
  realizado         boolean not null default false,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 6. COBROS (entrega del "pozo" al participante de cada turno)
-- ---------------------------------------------------------
create table if not exists cobros (
  id                uuid primary key default gen_random_uuid(),
  san_id            uuid not null references sanes(id) on delete cascade,
  numero_turno      int not null,
  participante_id   uuid references perfiles(id),
  fecha_cobro       date not null,
  monto_total_usd   numeric(14,2) not null,
  estado            text not null default 'pendiente' check (estado in ('pendiente','entregado')),
  created_at        timestamptz not null default now()
);

create index if not exists idx_cobros_san on cobros(san_id);

-- ---------------------------------------------------------
-- 7. CONFIGURACIÓN (tasa manual de respaldo, textos, etc.)
-- ---------------------------------------------------------
create table if not exists configuracion (
  clave   text primary key,
  valor   text
);
insert into configuracion (clave, valor) values ('tasa_manual_usdt', '0')
  on conflict (clave) do nothing;

-- =========================================================
-- FUNCIONES (SECURITY DEFINER) — login propio de participantes
-- =========================================================

-- Login de participante por RIF + contraseña
create or replace function login_participante(p_rif text, p_password text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perfil perfiles%rowtype;
begin
  select * into v_perfil from perfiles
    where rif = p_rif and rol = 'participante' and activo = true
    limit 1;

  if not found then
    return json_build_object('ok', false, 'error', 'RIF no encontrado o inactivo');
  end if;

  if v_perfil.password_hash is null or v_perfil.password_hash <> crypt(p_password, v_perfil.password_hash) then
    return json_build_object('ok', false, 'error', 'Contraseña incorrecta');
  end if;

  return json_build_object(
    'ok', true,
    'id', v_perfil.id,
    'nombre_completo', v_perfil.nombre_completo,
    'rif', v_perfil.rif,
    'whatsapp', v_perfil.whatsapp,
    'direccion', v_perfil.direccion,
    'creado_por', v_perfil.creado_por,
    'primer_login', v_perfil.primer_login
  );
end;
$$;

grant execute on function login_participante(text, text) to anon, authenticated;

-- Crear participante con contraseña temporal (llamada por el creador autenticado)
create or replace function crear_participante(
  p_creador_id uuid, p_nombre text, p_rif text, p_whatsapp text,
  p_direccion text, p_password text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into perfiles (rol, nombre_completo, rif, whatsapp, direccion, password_hash, creado_por, primer_login)
  values ('participante', p_nombre, p_rif, p_whatsapp, p_direccion, crypt(p_password, gen_salt('bf')), p_creador_id, true)
  returning id into v_id;

  return json_build_object('ok', true, 'id', v_id);
exception when unique_violation then
  return json_build_object('ok', false, 'error', 'Ya existe un participante con ese RIF');
end;
$$;

grant execute on function crear_participante(uuid, text, text, text, text, text) to authenticated;

-- Restablecer contraseña de un participante (el creador genera una nueva clave temporal)
create or replace function resetear_password_participante(p_participante_id uuid, p_password text)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  update perfiles set password_hash = crypt(p_password, gen_salt('bf')), primer_login = true
    where id = p_participante_id and rol = 'participante';
  return json_build_object('ok', true);
end;
$$;

grant execute on function resetear_password_participante(uuid, text) to authenticated;

-- El participante (sesión propia, sin Supabase Auth) marca que ya completó su
-- panel de bienvenida / selección de número
create or replace function marcar_primer_login_completo(p_participante_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  update perfiles set primer_login = false
    where id = p_participante_id and rol = 'participante';
  return json_build_object('ok', true);
end;
$$;

grant execute on function marcar_primer_login_completo(uuid) to anon, authenticated;

-- El participante cambia su propia contraseña (requiere la actual)
create or replace function cambiar_password_participante(p_participante_id uuid, p_password_actual text, p_password_nueva text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
begin
  select password_hash into v_hash from perfiles where id = p_participante_id and rol = 'participante';
  if v_hash is null or v_hash <> crypt(p_password_actual, v_hash) then
    return json_build_object('ok', false, 'error', 'La contraseña actual no es correcta');
  end if;
  update perfiles set password_hash = crypt(p_password_nueva, gen_salt('bf')) where id = p_participante_id;
  return json_build_object('ok', true);
end;
$$;

grant execute on function cambiar_password_participante(uuid, text, text) to anon, authenticated;

-- =========================================================
-- TRIGGER — al asignar un número a un participante (self-select, manual o
-- sorteo) se generan automáticamente sus cuotas de pago y se vincula el
-- cobro (pozo) correspondiente a ese turno.
-- =========================================================
create or replace function on_numero_asignado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_san sanes%rowtype;
begin
  if new.participante_id is not null and (old.participante_id is null or old.participante_id <> new.participante_id) then
    select * into v_san from sanes where id = new.san_id;

    if not exists (select 1 from pagos where san_id = new.san_id and participante_id = new.participante_id) then
      insert into pagos (san_id, participante_id, numero_cuota, fecha_vencimiento, monto_usd)
      select
        new.san_id, new.participante_id, gs,
        (case v_san.frecuencia
           when 'semanal'   then v_san.fecha_inicio + ((gs - 1) * 7)
           when 'quincenal' then v_san.fecha_inicio + ((gs - 1) * 15)
           when 'mensual'   then (v_san.fecha_inicio + ((gs - 1) || ' months')::interval)::date
         end),
        v_san.monto_cuota
      from generate_series(1, v_san.num_participantes) gs;
    end if;

    update cobros set participante_id = new.participante_id
      where san_id = new.san_id and numero_turno = new.numero;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_numero_asignado on numeros_san;
create trigger trg_numero_asignado
  after insert or update of participante_id on numeros_san
  for each row execute function on_numero_asignado();

-- =========================================================
-- RLS (Row Level Security)
-- =========================================================
alter table perfiles enable row level security;
alter table sanes enable row level security;
alter table numeros_san enable row level security;
alter table pagos enable row level security;
alter table sorteos enable row level security;
alter table cobros enable row level security;
alter table configuracion enable row level security;

-- Helper: rol del usuario autenticado actual (admin/creador vía Supabase Auth)
create or replace function mi_rol()
returns text language sql stable security definer as $$
  select rol from perfiles where auth_user_id = auth.uid();
$$;

create or replace function mi_perfil_id()
returns uuid language sql stable security definer as $$
  select id from perfiles where auth_user_id = auth.uid();
$$;

-- perfiles: admin ve todo; creador ve su perfil y sus participantes; lectura pública
-- limitada de datos no sensibles se maneja vía RPC (login_participante) para el
-- panel del participante — el participante no usa auth.users, por eso su acceso a
-- filas propias se resuelve desde el cliente guardando su id tras el login RPC y
-- usando políticas "true" controladas a nivel de app en las tablas operativas.
create policy "admin_todo_perfiles" on perfiles for all
  using (mi_rol() = 'admin') with check (mi_rol() = 'admin');

create policy "creador_ve_su_perfil" on perfiles for select
  using (auth_user_id = auth.uid());

create policy "creador_gestiona_sus_participantes" on perfiles for all
  using (mi_rol() = 'creador' and creado_por = mi_perfil_id())
  with check (mi_rol() = 'creador' and creado_por = mi_perfil_id());

create policy "participante_lectura_publica_basica" on perfiles for select
  using (rol = 'participante');

-- sanes
create policy "admin_todo_sanes" on sanes for all
  using (mi_rol() = 'admin') with check (mi_rol() = 'admin');
create policy "creador_gestiona_sus_sanes" on sanes for all
  using (creador_id = mi_perfil_id()) with check (creador_id = mi_perfil_id());
create policy "lectura_publica_sanes" on sanes for select using (true);

-- numeros_san
create policy "admin_todo_numeros" on numeros_san for all
  using (mi_rol() = 'admin') with check (mi_rol() = 'admin');
create policy "creador_gestiona_numeros" on numeros_san for all
  using (san_id in (select id from sanes where creador_id = mi_perfil_id()))
  with check (san_id in (select id from sanes where creador_id = mi_perfil_id()));
create policy "lectura_publica_numeros" on numeros_san for select using (true);
-- Un participante solo puede tomar un número disponible para asignárselo a sí mismo
-- (no puede tocar números ya ocupados ni dejarlos disponibles de nuevo)
create policy "participante_toma_numero" on numeros_san for update
  using (estado = 'disponible')
  with check (estado = 'ocupado' and participante_id is not null);

-- pagos
create policy "admin_todo_pagos" on pagos for all
  using (mi_rol() = 'admin') with check (mi_rol() = 'admin');
create policy "creador_gestiona_pagos" on pagos for all
  using (san_id in (select id from sanes where creador_id = mi_perfil_id()))
  with check (san_id in (select id from sanes where creador_id = mi_perfil_id()));
create policy "lectura_publica_pagos" on pagos for select using (true);
-- Un participante solo puede "reportar" una cuota pendiente/atrasada (adjuntar
-- comprobante y pasarla a estado 'reportado'); solo el creador/admin puede validarla.
create policy "participante_reporta_pago" on pagos for update
  using (estado in ('pendiente','atrasado'))
  with check (estado = 'reportado');

-- sorteos
create policy "admin_todo_sorteos" on sorteos for all
  using (mi_rol() = 'admin') with check (mi_rol() = 'admin');
create policy "creador_gestiona_sorteos" on sorteos for all
  using (san_id in (select id from sanes where creador_id = mi_perfil_id()))
  with check (san_id in (select id from sanes where creador_id = mi_perfil_id()));
create policy "lectura_publica_sorteos" on sorteos for select using (true);

-- cobros
create policy "admin_todo_cobros" on cobros for all
  using (mi_rol() = 'admin') with check (mi_rol() = 'admin');
create policy "creador_gestiona_cobros" on cobros for all
  using (san_id in (select id from sanes where creador_id = mi_perfil_id()))
  with check (san_id in (select id from sanes where creador_id = mi_perfil_id()));
create policy "lectura_publica_cobros" on cobros for select using (true);

-- configuracion
create policy "admin_gestiona_config" on configuracion for all
  using (mi_rol() = 'admin') with check (mi_rol() = 'admin');
create policy "creador_lee_config" on configuracion for select using (true);

-- =========================================================
-- NOTA IMPORTANTE SOBRE SEGURIDAD (leer antes de producción)
-- =========================================================
-- Las políticas "lectura_publica_*" y las de escritura para participante
-- (participante_toma_numero, participante_reporta_pago) están abiertas porque
-- el participante NO inicia sesión con Supabase Auth (usa login_participante()),
-- así que no existe un auth.uid() propio para filtrar filas por dueño.
-- Esto es válido para un lanzamiento inicial controlado, pero para mayor
-- seguridad en producción se recomienda migrar el login de participantes a
-- Supabase Auth (con email sintético tipo rif@participantes.tudominio.app)
-- usando una Edge Function con la service_role key, y así poder restringir
-- cada política a auth.uid() = participante_id.

-- =========================================================
-- STORAGE — bucket para comprobantes de pago
-- =========================================================
insert into storage.buckets (id, name, public)
  values ('comprobantes', 'comprobantes', true)
  on conflict (id) do nothing;

create policy "subir_comprobantes" on storage.objects for insert
  with check (bucket_id = 'comprobantes');
create policy "leer_comprobantes" on storage.objects for select
  using (bucket_id = 'comprobantes');

-- =========================================================
-- USUARIO ADMIN INICIAL
-- =========================================================
-- 1) Crea el usuario en Authentication → Users → Add user (email + password).
-- 2) Copia su UUID y ejecuta (reemplaza los valores):
--
-- insert into perfiles (auth_user_id, rol, nombre_completo, whatsapp, email)
-- values ('PEGA-AQUI-EL-UUID', 'admin', 'Administrador DigitalSAN', '584228745777', 'admin@tudominio.com');
