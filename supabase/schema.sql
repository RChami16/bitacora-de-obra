-- Bitácora de Obra — esquema inicial de Supabase.
-- Pega y corre esto en: tu proyecto de Supabase → SQL Editor → New query → Run.

-- Tabla de obras (proyectos), ligada al usuario que la crea.
create table if not exists public.obras (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  color text not null default '#e67e22',
  imagen_url text,
  -- Empresa dueña de la obra: nombre y logo, para que todos los PDF que se
  -- generen de esta obra los incluyan automáticamente.
  empresa text,
  logo_url text,
  creado_por uuid not null references auth.users(id) on delete cascade,
  creado_en timestamptz not null default now()
);

-- Por si ya habías creado la tabla antes de que existieran estas columnas
-- (re-correr este script completo es seguro).
alter table public.obras add column if not exists empresa text;
alter table public.obras add column if not exists logo_url text;

alter table public.obras enable row level security;

-- Por ahora cada quien ve/edita solo lo suyo. Cuando agreguemos "invitar
-- a otros usuarios a una obra", esto se amplía con una tabla obra_members
-- y políticas que también revisen esa tabla.
create policy "obras_select_propias" on public.obras
  for select using (auth.uid() = creado_por);

create policy "obras_insert_propias" on public.obras
  for insert with check (auth.uid() = creado_por);

create policy "obras_update_propias" on public.obras
  for update using (auth.uid() = creado_por);

create policy "obras_delete_propias" on public.obras
  for delete using (auth.uid() = creado_por);

-- Bucket de Storage para los íconos/imágenes de cada obra.
insert into storage.buckets (id, name, public)
values ('obra-iconos', 'obra-iconos', true)
on conflict (id) do nothing;

-- Cada usuario solo puede subir/editar/borrar archivos dentro de una carpeta
-- con su propio user id (p.ej. "abc123.../mi-obra-uuid.jpg"). La lectura es
-- pública porque el bucket es público (son solo íconos, nada sensible).
create policy "obra_iconos_insert_propios" on storage.objects
  for insert with check (
    bucket_id = 'obra-iconos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "obra_iconos_update_propios" on storage.objects
  for update using (
    bucket_id = 'obra-iconos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "obra_iconos_delete_propios" on storage.objects
  for delete using (
    bucket_id = 'obra-iconos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "obra_iconos_lectura_publica" on storage.objects
  for select using (bucket_id = 'obra-iconos');

-- ============================================================
-- PARTE 2 — Colaboradores por obra + notas/observaciones compartidas.
-- Corre solo esto (de aquí para abajo) en el SQL Editor: lo de arriba
-- ya se corrió antes. Todo aquí es seguro de volver a correr si hace falta.
-- ============================================================

-- Personas (aparte de quien creó la obra) con acceso a verla y agregar
-- notas/observaciones.
create table if not exists public.obra_members (
  obra_id uuid not null references public.obras(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  agregado_en timestamptz not null default now(),
  primary key (obra_id, user_id)
);

-- ¿El usuario actual puede ver/usar esta obra? (la creó o es colaborador).
-- security definer + su propia consulta a obras/obra_members para no caer
-- en una referencia circular con las políticas de esas mismas tablas.
create or replace function public.es_miembro_obra(p_obra_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.obras o where o.id = p_obra_id and o.creado_por = auth.uid()
  ) or exists (
    select 1 from public.obra_members m where m.obra_id = p_obra_id and m.user_id = auth.uid()
  );
$$;

-- Busca el id de un usuario ya registrado por su correo, para poder
-- agregarlo como colaborador (no expone el resto de auth.users).
create or replace function public.buscar_usuario_id_por_email(p_email text)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

grant execute on function public.es_miembro_obra(uuid) to authenticated;
grant execute on function public.buscar_usuario_id_por_email(text) to authenticated;

alter table public.obra_members enable row level security;

drop policy if exists "obra_members_select" on public.obra_members;
create policy "obra_members_select" on public.obra_members
  for select using (public.es_miembro_obra(obra_id));

drop policy if exists "obra_members_insert_dueno" on public.obra_members;
create policy "obra_members_insert_dueno" on public.obra_members
  for insert with check (
    exists (select 1 from public.obras o where o.id = obra_id and o.creado_por = auth.uid())
  );

drop policy if exists "obra_members_delete_dueno" on public.obra_members;
create policy "obra_members_delete_dueno" on public.obra_members
  for delete using (
    exists (select 1 from public.obras o where o.id = obra_id and o.creado_por = auth.uid())
  );

-- Amplía quién puede VER una obra: quien la creó, y ahora también sus
-- colaboradores (antes solo la veía quien la había creado).
drop policy if exists "obras_select_propias" on public.obras;
drop policy if exists "obras_select_propias_o_miembro" on public.obras;
create policy "obras_select_propias_o_miembro" on public.obras
  for select using (auth.uid() = creado_por or public.es_miembro_obra(id));

-- Notas y observaciones de una obra — visibles y editables por todo el
-- equipo que tenga acceso (no solo por quien las escribió).
create table if not exists public.entradas (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obras(id) on delete cascade,
  autor uuid not null references auth.users(id) on delete cascade,
  autor_email text,
  tipo text not null default 'nota' check (tipo in ('nota', 'observacion')),
  fecha timestamptz not null default now(),
  texto text,
  -- Solo aplica a observaciones: 'por_atender' | 'en_proceso' | 'atendido'.
  estado text check (estado in ('por_atender', 'en_proceso', 'atendido')),
  fotos text[] not null default '{}',
  creado_en timestamptz not null default now(),
  atendido_en timestamptz
);

alter table public.entradas enable row level security;

drop policy if exists "entradas_select_miembros" on public.entradas;
create policy "entradas_select_miembros" on public.entradas
  for select using (public.es_miembro_obra(obra_id));

drop policy if exists "entradas_insert_miembros" on public.entradas;
create policy "entradas_insert_miembros" on public.entradas
  for insert with check (public.es_miembro_obra(obra_id) and autor = auth.uid());

drop policy if exists "entradas_update_miembros" on public.entradas;
create policy "entradas_update_miembros" on public.entradas
  for update using (public.es_miembro_obra(obra_id));

drop policy if exists "entradas_delete_miembros" on public.entradas;
create policy "entradas_delete_miembros" on public.entradas
  for delete using (public.es_miembro_obra(obra_id));

-- Bucket PRIVADO para fotos de notas/observaciones (a diferencia de los
-- íconos de obra, aquí sí puede haber evidencia sensible del proyecto que
-- no debe quedar pública en internet).
insert into storage.buckets (id, name, public)
values ('entradas-fotos', 'entradas-fotos', false)
on conflict (id) do nothing;

drop policy if exists "entradas_fotos_insert_miembros" on storage.objects;
create policy "entradas_fotos_insert_miembros" on storage.objects
  for insert with check (
    bucket_id = 'entradas-fotos'
    and public.es_miembro_obra(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "entradas_fotos_select_miembros" on storage.objects;
create policy "entradas_fotos_select_miembros" on storage.objects
  for select using (
    bucket_id = 'entradas-fotos'
    and public.es_miembro_obra(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "entradas_fotos_delete_miembros" on storage.objects;
create policy "entradas_fotos_delete_miembros" on storage.objects
  for delete using (
    bucket_id = 'entradas-fotos'
    and public.es_miembro_obra(((storage.foldername(name))[1])::uuid)
  );

-- Faltaba: al subir con "upsert" (reemplazar si ya existía, p.ej. al
-- reintentar una foto que ya se había intentado subir antes con el mismo
-- nombre), Supabase Storage necesita también permiso de UPDATE, no solo de
-- INSERT — sin esto, cualquier segundo intento sobre el mismo archivo
-- fallaba siempre, aunque el primero hubiera funcionado.
drop policy if exists "entradas_fotos_update_miembros" on storage.objects;
create policy "entradas_fotos_update_miembros" on storage.objects
  for update using (
    bucket_id = 'entradas-fotos'
    and public.es_miembro_obra(((storage.foldername(name))[1])::uuid)
  );

-- ============================================================
-- PARTE 4 — Datos de contacto de la empresa (dirección, teléfono, etc.),
-- para que salgan junto con el logo en el encabezado del PDF.
-- ============================================================
alter table public.obras add column if not exists empresa_datos text;

-- ============================================================
-- PARTE 5 — Nombres personalizados de las carpetas por semana (notas y
-- observaciones se agrupan solas por semana en la app; esto solo guarda el
-- nombre si alguien decide cambiarlo, para que lo vea todo el equipo).
-- ============================================================
create table if not exists public.semanas_nombre (
  obra_id uuid not null references public.obras(id) on delete cascade,
  tipo text not null check (tipo in ('nota', 'observacion')),
  semana_inicio date not null,
  nombre text not null,
  actualizado_en timestamptz not null default now(),
  primary key (obra_id, tipo, semana_inicio)
);

alter table public.semanas_nombre enable row level security;

drop policy if exists "semanas_nombre_select" on public.semanas_nombre;
create policy "semanas_nombre_select" on public.semanas_nombre
  for select using (public.es_miembro_obra(obra_id));

drop policy if exists "semanas_nombre_insert" on public.semanas_nombre;
create policy "semanas_nombre_insert" on public.semanas_nombre
  for insert with check (public.es_miembro_obra(obra_id));

drop policy if exists "semanas_nombre_update" on public.semanas_nombre;
create policy "semanas_nombre_update" on public.semanas_nombre
  for update using (public.es_miembro_obra(obra_id));

-- ============================================================
-- PARTE 6 — Tipo de trabajo por entrada, y permisos de borrado más finos:
-- cualquiera puede seguir cambiando el estatus de una observación (no
-- cambia nada ahí), pero borrar una nota/observación ahora solo lo puede
-- hacer quien la creó, o quien creó la obra.
-- ============================================================
alter table public.entradas add column if not exists categoria text
  check (categoria in ('albanileria', 'herreria', 'instalaciones', 'acabados', 'otro'));

drop policy if exists "entradas_delete_miembros" on public.entradas;
drop policy if exists "entradas_delete_propias_o_dueno" on public.entradas;
create policy "entradas_delete_propias_o_dueno" on public.entradas
  for delete using (
    autor = auth.uid()
    or exists (select 1 from public.obras o where o.id = obra_id and o.creado_por = auth.uid())
  );
