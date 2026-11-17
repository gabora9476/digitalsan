-- =========================================================
-- DigitalSAN — Esquema de base de datos v2 (Supabase / Postgres)
-- IDEMPOTENTE: puedes ejecutarlo completo las veces que quieras
-- (SQL Editor → New query → pegar todo → Run). No borra tus datos.
-- Si ya habías ejecutado la versión anterior, este script la migra.
-- =========================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------
-- 1. PERFILES (admin, creador, participante)
-- ---------------------------------------------------------
-- admin y creador  -> login con Supabase Auth (email + password)
-- participante     -> login propio por RIF + password (ver funciones RPC),
--                     la clave vive en credenciales_participante (nunca expuesta)
create table if not exists perfiles (
  id                uuid primary key default gen_random_uuid(),
  auth_user_id      uuid unique references auth.users(id) on delete cascade,
  rol               text not null check (rol in ('admin','creador','participante')),
  nombre_completo   text not null,
  rif               text unique,
  whatsapp          text not null,
  direccion         text,
  email             text,
  creado_por        uuid references perfiles(id) on delete set null,
  primer_login      boolean not null default true,
  activo            boolean not null default true,
  created_at        timestamptz not null default now()
);

create index if not exists idx_perfiles_rol on perfiles(rol);
create index if not exists idx_perfiles_creado_por on perfiles(creado_por);
create index if not exists idx_perfiles_rif on perfiles(rif);

-- Tabla privada de claves de participantes (nadie del frontend puede leerla)
create table if not exists credenciales_participante (
  participante_id   uuid primary key references perfiles(id) on delete cascade,
  password_hash     text not null,
  intentos_fallidos int not null default 0,
  bloqueado_hasta   timestamptz,
  updated_at        timestamptz not null default now()
);

-- Sesiones del participante (token aleatorio que devuelve el login)
create table if not exists sesiones_participante (
  token             uuid primary key default gen_random_uuid(),
  participante_id   uuid not null references perfiles(id) on delete cascade,
  expira            timestamptz not null default (now() + interval '30 days'),
  created_at        timestamptz not null default now()
);
create index if not exists idx_sesiones_part on sesiones_participante(participante_id);

-- MIGRACIÓN desde la versión anterior (password_hash dentro de perfiles)
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'perfiles' and column_name = 'password_hash') then
    execute 'insert into credenciales_participante (participante_id, password_hash)
             select id, password_hash from perfiles where password_hash is not null
             on conflict (participante_id) do nothing';
    execute 'alter table perfiles drop column password_hash';
  end if;
end $$;

-- Un RIF no puede repetirse aunque se escriba distinto (V-123 / V123)
create unique index if not exists uq_perfiles_rif_norm
  on perfiles (upper(regexp_replace(rif, '[^A-Za-z0-9]', '', 'g')))
  where rol = 'participante' and rif is not null;

-- ---------------------------------------------------------
-- 2. SANES
-- ---------------------------------------------------------
create table if not exists sanes (
  id                   uuid primary key default gen_random_uuid(),
  creador_id           uuid not null references perfiles(id) on delete cascade,
  nombre               text not null,
  tipo                 text not null check (tipo in ('monetario','personalizado')) default 'monetario',
  descripcion_articulo text,
  moneda_base          text not null default 'USD' check (moneda_base in ('USD','VES')),
  monto_cuota          numeric(14,2) not null,
  num_participantes    int not null check (num_participantes > 1),
  monto_total          numeric(14,2) not null,
  frecuencia           text not null check (frecuencia in ('semanal','quincenal','mensual')),
  metodo_asignacion    text not null default 'sorteo' check (metodo_asignacion in ('sorteo','manual','libre')),
  fecha_inicio         date not null,
  fecha_fin            date,
  estado               text not null default 'planificacion'
                         check (estado in ('planificacion','activo','finalizado','cancelado')),
  created_at           timestamptz not null default now()
);
create index if not exists idx_sanes_creador on sanes(creador_id);

-- ---------------------------------------------------------
-- 3. NÚMEROS / CUPOS
-- ---------------------------------------------------------
create table if not exists numeros_san (
  id                uuid primary key default gen_random_uuid(),
  san_id            uuid not null references sanes(id) on delete cascade,
  numero            int not null,
  participante_id   uuid references perfiles(id) on delete set null,
  fecha_turno       date,
  estado            text not null default 'disponible' check (estado in ('disponible','ocupado')),
  unique (san_id, numero)
);
create index if not exists idx_numeros_san_san on numeros_san(san_id);
create index if not exists idx_numeros_san_participante on numeros_san(participante_id);

-- ---------------------------------------------------------
-- 4. PAGOS
-- ---------------------------------------------------------
create table if not exists pagos (
  id                uuid primary key default gen_random_uuid(),
  san_id            uuid not null references sanes(id) on delete cascade,
  participante_id   uuid not null references perfiles(id) on delete cascade,
  numero_cuota      int not null,
  fecha_vencimiento date not null,
  monto_usd         numeric(14,2) not null,
  monto_ves         numeric(16,2),
  tasa_aplicada     numeric(12,4),
  fecha_pago        timestamptz,
  estado            text not null default 'pendiente'
                      check (estado in ('pendiente','reportado','validado','atrasado')),
  comprobante_url   text,      -- ruta dentro del bucket "comprobantes" (o URL completa en datos antiguos)
  referencia        text,
  validado_por      uuid references perfiles(id),
  created_at        timestamptz not null default now()
);
create index if not exists idx_pagos_san on pagos(san_id);
create index if not exists idx_pagos_participante on pagos(participante_id);
create index if not exists idx_pagos_estado on pagos(estado);

-- ---------------------------------------------------------
-- 5. SORTEOS
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
-- 6. COBROS
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
-- 7. CONFIGURACIÓN
-- ---------------------------------------------------------
create table if not exists configuracion (
  clave   text primary key,
  valor   text
);
insert into configuracion (clave, valor) values ('tasa_manual_usdt', '0')
  on conflict (clave) do nothing;

-- =========================================================
-- HELPERS DE ROL (SECURITY DEFINER: no disparan recursión de RLS)
-- =========================================================
create or replace function mi_rol()
returns text language sql stable security definer set search_path = public as $$
  select rol from perfiles where auth_user_id = auth.uid() and activo = true limit 1;
$$;

create or replace function mi_perfil_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from perfiles where auth_user_id = auth.uid() and activo = true limit 1;
$$;

-- Devuelve el id del participante dueño de un token de sesión válido (o null)
create or replace function participante_desde_token(p_token uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select s.participante_id
  from sesiones_participante s
  join perfiles p on p.id = s.participante_id
  where s.token = p_token and s.expira > now() and p.activo = true and p.rol = 'participante';
$$;
revoke execute on function participante_desde_token(uuid) from public, anon, authenticated;

-- =========================================================
-- FUNCIONES DEL PARTICIPANTE (login propio por RIF + clave)
-- =========================================================

-- Login: devuelve el perfil + un token de sesión
create or replace function login_participante(p_rif text, p_password text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rif    text := upper(regexp_replace(coalesce(p_rif, ''), '[^A-Za-z0-9]', '', 'g'));
  v_perfil perfiles%rowtype;
  v_cred   credenciales_participante%rowtype;
  v_token  uuid;
begin
  select * into v_perfil from perfiles
   where rol = 'participante' and activo = true
     and upper(regexp_replace(coalesce(rif, ''), '[^A-Za-z0-9]', '', 'g')) = v_rif
   limit 1;

  if not found then
    return json_build_object('ok', false, 'error', 'Cédula/RIF o contraseña incorrectos');
  end if;

  select * into v_cred from credenciales_participante where participante_id = v_perfil.id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Cédula/RIF o contraseña incorrectos');
  end if;

  if v_cred.bloqueado_hasta is not null and v_cred.bloqueado_hasta > now() then
    return json_build_object('ok', false, 'error', 'Demasiados intentos fallidos. Intenta de nuevo en 10 minutos.');
  end if;

  if v_cred.password_hash <> crypt(coalesce(p_password, ''), v_cred.password_hash) then
    update credenciales_participante set
      intentos_fallidos = case when intentos_fallidos + 1 >= 5 then 0 else intentos_fallidos + 1 end,
      bloqueado_hasta   = case when intentos_fallidos + 1 >= 5 then now() + interval '10 minutes' else bloqueado_hasta end
    where participante_id = v_perfil.id;
    return json_build_object('ok', false, 'error', 'Cédula/RIF o contraseña incorrectos');
  end if;

  update credenciales_participante set intentos_fallidos = 0, bloqueado_hasta = null
   where participante_id = v_perfil.id;

  delete from sesiones_participante where participante_id = v_perfil.id and expira < now();
  insert into sesiones_participante (participante_id) values (v_perfil.id) returning token into v_token;

  return json_build_object(
    'ok', true,
    'token', v_token,
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

-- Carga TODO lo que necesita el panel del participante en una sola llamada
create or replace function part_cargar_datos(p_token uuid)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pid      uuid := participante_desde_token(p_token);
  v_perfil   perfiles%rowtype;
  v_numeros  jsonb;
  v_abiertos jsonb;
  v_pagos    jsonb;
begin
  if v_pid is null then
    return json_build_object('ok', false, 'error', 'sesion_invalida');
  end if;
  select * into v_perfil from perfiles where id = v_pid;

  select coalesce(jsonb_agg(to_jsonb(n) || jsonb_build_object('sanes', to_jsonb(s)) order by s.created_at, n.numero), '[]'::jsonb)
    into v_numeros
  from numeros_san n join sanes s on s.id = n.san_id
  where n.participante_id = v_pid;

  select coalesce(jsonb_agg(
           to_jsonb(s) || jsonb_build_object('numeros_san',
             (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'numero', n.numero, 'estado', n.estado, 'fecha_turno', n.fecha_turno) order by n.numero), '[]'::jsonb)
                from numeros_san n where n.san_id = s.id))
           order by s.created_at), '[]'::jsonb)
    into v_abiertos
  from sanes s
  where s.creador_id = v_perfil.creado_por
    and s.metodo_asignacion = 'libre'
    and s.estado in ('planificacion', 'activo')
    and not exists (select 1 from numeros_san n where n.san_id = s.id and n.participante_id = v_pid)
    and exists (select 1 from numeros_san n where n.san_id = s.id and n.estado = 'disponible');

  select coalesce(jsonb_agg(
           to_jsonb(p) || jsonb_build_object('sanes', jsonb_build_object('nombre', s.nombre, 'moneda_base', s.moneda_base))
           order by p.fecha_vencimiento, p.numero_cuota), '[]'::jsonb)
    into v_pagos
  from pagos p join sanes s on s.id = p.san_id
  where p.participante_id = v_pid;

  return json_build_object(
    'ok', true,
    'perfil', json_build_object(
      'id', v_perfil.id, 'nombre_completo', v_perfil.nombre_completo, 'rif', v_perfil.rif,
      'whatsapp', v_perfil.whatsapp, 'direccion', v_perfil.direccion,
      'creado_por', v_perfil.creado_por, 'primer_login', v_perfil.primer_login
    ),
    'numeros', v_numeros,
    'abiertos', v_abiertos,
    'pagos', v_pagos
  );
end;
$$;
grant execute on function part_cargar_datos(uuid) to anon, authenticated;

-- El participante elige un número disponible (método "libre")
create or replace function part_tomar_numero(p_token uuid, p_numero_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pid  uuid := participante_desde_token(p_token);
  v_num  numeros_san%rowtype;
  v_san  sanes%rowtype;
  v_dueno uuid;
begin
  if v_pid is null then
    return json_build_object('ok', false, 'error', 'sesion_invalida');
  end if;

  select * into v_num from numeros_san where id = p_numero_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Número no encontrado');
  end if;

  select * into v_san from sanes where id = v_num.san_id;
  select creado_por into v_dueno from perfiles where id = v_pid;

  if v_san.creador_id is distinct from v_dueno then
    return json_build_object('ok', false, 'error', 'No puedes participar en este San');
  end if;
  if v_san.metodo_asignacion <> 'libre' or v_san.estado not in ('planificacion', 'activo') then
    return json_build_object('ok', false, 'error', 'Este San no permite elegir número');
  end if;
  if v_num.estado <> 'disponible' then
    return json_build_object('ok', false, 'error', 'Ese número ya fue tomado, elige otro');
  end if;
  if exists (select 1 from numeros_san where san_id = v_num.san_id and participante_id = v_pid) then
    return json_build_object('ok', false, 'error', 'Ya tienes un número en este San');
  end if;

  update numeros_san set participante_id = v_pid, estado = 'ocupado' where id = p_numero_id;
  return json_build_object('ok', true);
end;
$$;
grant execute on function part_tomar_numero(uuid, uuid) to anon, authenticated;

-- El participante reporta un pago (referencia + ruta del comprobante ya subido)
create or replace function part_reportar_pago(
  p_token uuid, p_pago_id uuid, p_referencia text, p_ruta text, p_tasa numeric, p_monto_ves numeric
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pid  uuid := participante_desde_token(p_token);
  v_pago pagos%rowtype;
begin
  if v_pid is null then
    return json_build_object('ok', false, 'error', 'sesion_invalida');
  end if;

  select * into v_pago from pagos where id = p_pago_id and participante_id = v_pid for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Pago no encontrado');
  end if;
  if v_pago.estado not in ('pendiente', 'atrasado') then
    return json_build_object('ok', false, 'error', 'Este pago ya fue reportado o validado');
  end if;
  if coalesce(trim(p_referencia), '') = '' then
    return json_build_object('ok', false, 'error', 'Indica la referencia del pago');
  end if;
  if p_ruta is not null and p_ruta not like (p_pago_id::text || '/%') then
    return json_build_object('ok', false, 'error', 'Comprobante inválido');
  end if;

  update pagos set
    estado = 'reportado',
    referencia = left(trim(p_referencia), 80),
    comprobante_url = p_ruta,
    fecha_pago = now(),
    tasa_aplicada = p_tasa,
    monto_ves = p_monto_ves
  where id = p_pago_id;

  return json_build_object('ok', true);
end;
$$;
grant execute on function part_reportar_pago(uuid, uuid, text, text, numeric, numeric) to anon, authenticated;

create or replace function part_primer_login_completo(p_token uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v_pid uuid := participante_desde_token(p_token);
begin
  if v_pid is null then
    return json_build_object('ok', false, 'error', 'sesion_invalida');
  end if;
  update perfiles set primer_login = false where id = v_pid;
  return json_build_object('ok', true);
end;
$$;
grant execute on function part_primer_login_completo(uuid) to anon, authenticated;

create or replace function part_cambiar_password(p_token uuid, p_actual text, p_nueva text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pid  uuid := participante_desde_token(p_token);
  v_hash text;
begin
  if v_pid is null then
    return json_build_object('ok', false, 'error', 'sesion_invalida');
  end if;
  if length(coalesce(p_nueva, '')) < 6 then
    return json_build_object('ok', false, 'error', 'La nueva contraseña debe tener al menos 6 caracteres');
  end if;
  select password_hash into v_hash from credenciales_participante where participante_id = v_pid;
  if v_hash is null or v_hash <> crypt(coalesce(p_actual, ''), v_hash) then
    return json_build_object('ok', false, 'error', 'La contraseña actual no es correcta');
  end if;
  update credenciales_participante set password_hash = crypt(p_nueva, gen_salt('bf')), updated_at = now()
   where participante_id = v_pid;
  return json_build_object('ok', true);
end;
$$;
grant execute on function part_cambiar_password(uuid, text, text) to anon, authenticated;

create or replace function part_cerrar_sesion(p_token uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from sesiones_participante where token = p_token;
  return json_build_object('ok', true);
end;
$$;
grant execute on function part_cerrar_sesion(uuid) to anon, authenticated;

-- Funciones antiguas (inseguras) que ya no se usan
drop function if exists marcar_primer_login_completo(uuid);
drop function if exists cambiar_password_participante(uuid, text, text);

-- =========================================================
-- FUNCIONES DEL CREADOR / ADMIN
-- =========================================================

-- Crear participante con contraseña temporal
create or replace function crear_participante(
  p_creador_id uuid, p_nombre text, p_rif text, p_whatsapp text,
  p_direccion text, p_password text
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id     uuid;
  v_rol    text := mi_rol();
  v_caller uuid := mi_perfil_id();
  v_rif    text := upper(regexp_replace(coalesce(p_rif, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if v_rol is null or v_rol not in ('creador', 'admin') then
    return json_build_object('ok', false, 'error', 'No autorizado');
  end if;
  if v_rol = 'creador' and p_creador_id is distinct from v_caller then
    return json_build_object('ok', false, 'error', 'No autorizado');
  end if;
  if v_rif = '' or coalesce(trim(p_nombre), '') = '' or coalesce(trim(p_whatsapp), '') = '' then
    return json_build_object('ok', false, 'error', 'Faltan datos obligatorios');
  end if;
  if length(coalesce(p_password, '')) < 6 then
    return json_build_object('ok', false, 'error', 'La contraseña temporal es muy corta');
  end if;
  if exists (select 1 from perfiles
              where rol = 'participante'
                and upper(regexp_replace(coalesce(rif, ''), '[^A-Za-z0-9]', '', 'g')) = v_rif) then
    return json_build_object('ok', false, 'error', 'Ya existe un participante con ese RIF');
  end if;

  insert into perfiles (rol, nombre_completo, rif, whatsapp, direccion, creado_por, primer_login)
  values ('participante', trim(p_nombre), v_rif, trim(p_whatsapp),
          nullif(trim(coalesce(p_direccion, '')), ''), p_creador_id, true)
  returning id into v_id;

  insert into credenciales_participante (participante_id, password_hash)
  values (v_id, crypt(p_password, gen_salt('bf')));

  return json_build_object('ok', true, 'id', v_id);
exception when unique_violation then
  return json_build_object('ok', false, 'error', 'Ya existe un participante con ese RIF');
end;
$$;
revoke execute on function crear_participante(uuid, text, text, text, text, text) from public, anon;
grant execute on function crear_participante(uuid, text, text, text, text, text) to authenticated;

-- Restablecer contraseña de un participante (solo su creador o el admin)
create or replace function resetear_password_participante(p_participante_id uuid, p_password text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rol    text := mi_rol();
  v_caller uuid := mi_perfil_id();
begin
  if v_rol is null or v_rol not in ('creador', 'admin') then
    return json_build_object('ok', false, 'error', 'No autorizado');
  end if;
  if length(coalesce(p_password, '')) < 6 then
    return json_build_object('ok', false, 'error', 'La contraseña temporal es muy corta');
  end if;
  if v_rol = 'creador' and not exists (
       select 1 from perfiles where id = p_participante_id and rol = 'participante' and creado_por = v_caller) then
    return json_build_object('ok', false, 'error', 'No autorizado');
  end if;

  insert into credenciales_participante (participante_id, password_hash)
  values (p_participante_id, crypt(p_password, gen_salt('bf')))
  on conflict (participante_id) do update
    set password_hash = excluded.password_hash, intentos_fallidos = 0, bloqueado_hasta = null, updated_at = now();

  update perfiles set primer_login = true where id = p_participante_id and rol = 'participante';
  delete from sesiones_participante where participante_id = p_participante_id;
  return json_build_object('ok', true);
end;
$$;
revoke execute on function resetear_password_participante(uuid, text) from public, anon;
grant execute on function resetear_password_participante(uuid, text) to authenticated;

-- =========================================================
-- TRIGGER — al asignar/liberar un número se generan o limpian sus cuotas
-- =========================================================
create or replace function on_numero_asignado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_san  sanes%rowtype;
  v_prev uuid := null;
begin
  if tg_op = 'UPDATE' then
    v_prev := old.participante_id;
  end if;

  -- Liberación o cambio de dueño: se quitan las cuotas aún pendientes del anterior
  if v_prev is not null and new.participante_id is distinct from v_prev then
    if not exists (select 1 from numeros_san
                    where san_id = new.san_id and participante_id = v_prev and id <> new.id) then
      delete from pagos where san_id = new.san_id and participante_id = v_prev and estado = 'pendiente';
    end if;
    update cobros set participante_id = null
     where san_id = new.san_id and numero_turno = new.numero;
  end if;

  -- Asignación nueva: se generan las cuotas que falten y se vincula el cobro
  if new.participante_id is not null and new.participante_id is distinct from v_prev then
    select * into v_san from sanes where id = new.san_id;

    insert into pagos (san_id, participante_id, numero_cuota, fecha_vencimiento, monto_usd)
    select new.san_id, new.participante_id, gs,
           case v_san.frecuencia
             when 'semanal'   then v_san.fecha_inicio + ((gs - 1) * 7)
             when 'quincenal' then v_san.fecha_inicio + ((gs - 1) * 15)
             else (v_san.fecha_inicio + make_interval(months => gs - 1))::date
           end,
           v_san.monto_cuota
    from generate_series(1, v_san.num_participantes) gs
    where not exists (select 1 from pagos p
                       where p.san_id = new.san_id and p.participante_id = new.participante_id
                         and p.numero_cuota = gs);

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
-- PERMISOS DE TABLA + RLS
-- =========================================================
-- El frontend anónimo (participantes) NO toca tablas: solo usa las funciones RPC.
-- Admin y creador (Supabase Auth, rol "authenticated") acceden filtrados por RLS.
alter table perfiles                  enable row level security;
alter table sanes                     enable row level security;
alter table numeros_san               enable row level security;
alter table pagos                     enable row level security;
alter table sorteos                   enable row level security;
alter table cobros                    enable row level security;
alter table configuracion             enable row level security;
alter table credenciales_participante enable row level security;
alter table sesiones_participante     enable row level security;

revoke all on perfiles, sanes, numeros_san, pagos, sorteos, cobros from anon;
revoke all on perfiles, sanes, numeros_san, pagos, sorteos, cobros from authenticated;
grant select, insert, update, delete on perfiles, sanes, numeros_san, pagos, sorteos, cobros to authenticated;

revoke all on configuracion from anon, authenticated;
grant select on configuracion to anon;
grant select, insert, update on configuracion to authenticated;

revoke all on credenciales_participante, sesiones_participante from anon, authenticated;

-- Limpieza de políticas antiguas (versión anterior)
drop policy if exists "participante_lectura_publica_basica" on perfiles;
drop policy if exists "lectura_publica_sanes"     on sanes;
drop policy if exists "lectura_publica_numeros"   on numeros_san;
drop policy if exists "participante_toma_numero"  on numeros_san;
drop policy if exists "lectura_publica_pagos"     on pagos;
drop policy if exists "participante_reporta_pago" on pagos;
drop policy if exists "lectura_publica_sorteos"   on sorteos;
drop policy if exists "lectura_publica_cobros"    on cobros;

-- perfiles
drop policy if exists "admin_todo_perfiles" on perfiles;
create policy "admin_todo_perfiles" on perfiles for all
  using (mi_rol() = 'admin') with check (mi_rol() = 'admin');

drop policy if exists "creador_ve_su_perfil" on perfiles;
create policy "creador_ve_su_perfil" on perfiles for select
  using (auth_user_id = auth.uid());

drop policy if exists "creador_gestiona_sus_participantes" on perfiles;
drop policy if exists "creador_ve_sus_participantes" on perfiles;
create policy "creador_ve_sus_participantes" on perfiles for select
  using (mi_rol() = 'creador' and rol = 'participante' and creado_por = mi_perfil_id());

drop policy if exists "creador_edita_sus_participantes" on perfiles;
create policy "creador_edita_sus_participantes" on perfiles for update
  using (mi_rol() = 'creador' and rol = 'participante' and creado_por = mi_perfil_id())
  with check (mi_rol() = 'creador' and rol = 'participante' and creado_por = mi_perfil_id());

-- sanes
drop policy if exists "admin_todo_sanes" on sanes;
create policy "admin_todo_sanes" on sanes for all
  using (mi_rol() = 'admin') with check (mi_rol() = 'admin');
drop policy if exists "creador_gestiona_sus_sanes" on sanes;
create policy "creador_gestiona_sus_sanes" on sanes for all
  using (mi_rol() = 'creador' and creador_id = mi_perfil_id())
  with check (mi_rol() = 'creador' and creador_id = mi_perfil_id());

-- numeros_san
drop policy if exists "admin_todo_numeros" on numeros_san;
create policy "admin_todo_numeros" on numeros_san for all
  using (mi_rol() = 'admin') with check (mi_rol() = 'admin');
drop policy if exists "creador_gestiona_numeros" on numeros_san;
create policy "creador_gestiona_numeros" on numeros_san for all
  using (san_id in (select id from sanes where creador_id = mi_perfil_id()))
  with check (san_id in (select id from sanes where creador_id = mi_perfil_id()));

-- pagos
drop policy if exists "admin_todo_pagos" on pagos;
create policy "admin_todo_pagos" on pagos for all
  using (mi_rol() = 'admin') with check (mi_rol() = 'admin');
drop policy if exists "creador_gestiona_pagos" on pagos;
create policy "creador_gestiona_pagos" on pagos for all
  using (san_id in (select id from sanes where creador_id = mi_perfil_id()))
  with check (san_id in (select id from sanes where creador_id = mi_perfil_id()));

-- sorteos
drop policy if exists "admin_todo_sorteos" on sorteos;
create policy "admin_todo_sorteos" on sorteos for all
  using (mi_rol() = 'admin') with check (mi_rol() = 'admin');
drop policy if exists "creador_gestiona_sorteos" on sorteos;
create policy "creador_gestiona_sorteos" on sorteos for all
  using (san_id in (select id from sanes where creador_id = mi_perfil_id()))
  with check (san_id in (select id from sanes where creador_id = mi_perfil_id()));

-- cobros
drop policy if exists "admin_todo_cobros" on cobros;
create policy "admin_todo_cobros" on cobros for all
  using (mi_rol() = 'admin') with check (mi_rol() = 'admin');
drop policy if exists "creador_gestiona_cobros" on cobros;
create policy "creador_gestiona_cobros" on cobros for all
  using (san_id in (select id from sanes where creador_id = mi_perfil_id()))
  with check (san_id in (select id from sanes where creador_id = mi_perfil_id()));

-- configuracion (la tasa manual de respaldo la lee cualquiera; solo el admin la edita)
drop policy if exists "admin_gestiona_config" on configuracion;
create policy "admin_gestiona_config" on configuracion for all
  using (mi_rol() = 'admin') with check (mi_rol() = 'admin');
drop policy if exists "creador_lee_config" on configuracion;
create policy "creador_lee_config" on configuracion for select using (true);

-- =========================================================
-- STORAGE — bucket para comprobantes de pago
-- =========================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes', 'comprobantes', true, 5242880,
        array['image/jpeg','image/png','image/webp','image/gif','application/pdf'])
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','application/pdf'];

drop policy if exists "subir_comprobantes" on storage.objects;
create policy "subir_comprobantes" on storage.objects for insert
  with check (bucket_id = 'comprobantes' and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$');

drop policy if exists "leer_comprobantes" on storage.objects;
create policy "leer_comprobantes" on storage.objects for select
  using (bucket_id = 'comprobantes');
