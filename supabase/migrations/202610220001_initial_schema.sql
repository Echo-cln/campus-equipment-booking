-- Campus Equipment Booking: isolated production schema. Apply only to a new project.
create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '校园用户' check (char_length(display_name) between 1 and 40),
  role text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.create_profile_for_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, display_name)
  values (new.id, coalesce(nullif(left(new.raw_user_meta_data ->> 'display_name', 40), ''), '校园用户'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users
for each row execute function public.create_profile_for_auth_user();

create or replace function public.prevent_self_role_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.role() = 'authenticated' and new.role is distinct from old.role then
    raise exception 'profile role can only be changed by a trusted administrator';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role before update on public.profiles
for each row execute function public.prevent_self_role_change();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create table if not exists public.equipment (
  device_no text primary key,
  name text not null,
  use_count integer not null default 0 check (use_count >= 0),
  category text,
  description text,
  location text,
  model text,
  open_hours text,
  max_duration_minutes integer check (max_duration_minutes is null or max_duration_minutes > 0),
  status text not null default 'unknown' check (status in ('available','maintenance','disabled','unknown')),
  status_note text,
  updated_at timestamptz not null default now()
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  device_no text not null references public.equipment(device_no) on update cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  purpose text not null check (char_length(purpose) between 1 and 300),
  status text not null default 'pending' check (status in ('pending','confirmed','cancel_requested','completed','cancelled')),
  allow_coordination boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reservation_time_order check (ends_at > starts_at),
  constraint reservation_no_double_booking exclude using gist
    (device_no with =, tstzrange(starts_at, ends_at, '[)') with &&)
    where (status in ('pending','confirmed'))
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 3000),
  category text not null check (category in ('maintenance','fault','notice','update')),
  device_no text references public.equipment(device_no) on delete set null,
  published_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id)
);

create table if not exists public.maintenance_windows (
  id uuid primary key default gen_random_uuid(),
  device_no text not null references public.equipment(device_no) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  note text not null check (char_length(note) between 1 and 500),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  device_no text not null references public.equipment(device_no) on delete cascade,
  preferred_date date not null,
  status text not null default 'waiting' check (status in ('waiting','notified','closed')),
  created_at timestamptz not null default now(),
  unique(owner_id, device_no, preferred_date)
);

create table if not exists public.issues (
  id uuid primary key default gen_random_uuid(),
  device_no text not null references public.equipment(device_no) on delete cascade,
  reported_by uuid not null references public.profiles(id),
  description text not null check (char_length(description) between 1 and 2000),
  status text not null default 'open' check (status in ('open','in_progress','resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (reservation_id, created_by)
);
create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at);
create index if not exists reservations_device_start_idx on public.reservations(device_no, starts_at);

-- Public reservation slots contain no borrower identity or purpose.
create or replace function public.reservation_slots(p_from timestamptz, p_to timestamptz)
returns table(reservation_id uuid, device_no text, starts_at timestamptz, ends_at timestamptz, status text, owner_name text, allow_coordination boolean, is_mine boolean)
language sql stable security definer set search_path = '' as $$
  select r.id, r.device_no, r.starts_at, r.ends_at, r.status, p.display_name, r.allow_coordination, (r.owner_id = auth.uid())
  from public.reservations r join public.profiles p on p.id = r.owner_id
  where r.status in ('pending','confirmed')
    and r.starts_at < p_to and r.ends_at > p_from
    and p_from < p_to
  order by r.starts_at;
$$;

-- A conversation can only be opened from a current, coordination-enabled reservation.
create or replace function public.start_reservation_conversation(target_reservation uuid)
returns table(conversation_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  reservation_owner uuid;
  allow_chat boolean;
  new_conversation uuid;
begin
  if caller is null then raise exception 'authentication required'; end if;
  select owner_id, allow_coordination into reservation_owner, allow_chat
    from public.reservations
    where id = target_reservation and status in ('pending','confirmed') and ends_at > now();
  if reservation_owner is null then raise exception 'reservation unavailable'; end if;
  if caller = reservation_owner then raise exception 'cannot open a conversation with yourself'; end if;
  if not allow_chat then raise exception 'reservation owner has closed coordination'; end if;
  insert into public.conversations(reservation_id, created_by)
    values (target_reservation, caller)
    on conflict (reservation_id, created_by) do update set reservation_id = excluded.reservation_id
    returning id into new_conversation;
  insert into public.conversation_members(conversation_id, user_id)
    values (new_conversation, caller), (new_conversation, reservation_owner)
    on conflict do nothing;
  return query select new_conversation;
end;
$$;

alter table public.profiles enable row level security;
alter table public.equipment enable row level security;
alter table public.reservations enable row level security;
alter table public.announcements enable row level security;
alter table public.maintenance_windows enable row level security;
alter table public.issues enable row level security;
alter table public.waitlist enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

create policy profiles_read_authenticated on public.profiles for select to authenticated using (true);
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy equipment_read_authenticated on public.equipment for select to authenticated using (true);
create policy equipment_admin_write on public.equipment for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy reservation_read_owner_or_admin on public.reservations for select to authenticated using (owner_id = auth.uid() or public.is_admin());
create policy reservation_insert_owner on public.reservations for insert to authenticated with check (owner_id = auth.uid());
create policy reservation_update_owner_or_admin on public.reservations for update to authenticated using (owner_id = auth.uid() or public.is_admin()) with check (owner_id = auth.uid() or public.is_admin());
create policy announcements_read_authenticated on public.announcements for select to authenticated using (true);
create policy announcements_admin_write on public.announcements for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy maintenance_read_authenticated on public.maintenance_windows for select to authenticated using (true);
create policy maintenance_admin_write on public.maintenance_windows for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy issues_read_owner_or_admin on public.issues for select to authenticated using (reported_by = auth.uid() or public.is_admin());
create policy issues_insert_reporter on public.issues for insert to authenticated with check (reported_by = auth.uid());
create policy issues_admin_update on public.issues for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy waitlist_read_owner_or_admin on public.waitlist for select to authenticated using (owner_id = auth.uid() or public.is_admin());
create policy waitlist_insert_owner on public.waitlist for insert to authenticated with check (owner_id = auth.uid());
create policy waitlist_update_owner_or_admin on public.waitlist for update to authenticated using (owner_id = auth.uid() or public.is_admin()) with check (owner_id = auth.uid() or public.is_admin());
create policy waitlist_delete_owner_or_admin on public.waitlist for delete to authenticated using (owner_id = auth.uid() or public.is_admin());
create policy conversations_read_member on public.conversations for select to authenticated using (exists(select 1 from public.conversation_members m where m.conversation_id = id and m.user_id = auth.uid()));
create policy members_read_self on public.conversation_members for select to authenticated using (user_id = auth.uid());
create policy messages_read_member on public.messages for select to authenticated using (exists(select 1 from public.conversation_members m where m.conversation_id = conversation_id and m.user_id = auth.uid()));
create policy messages_send_member on public.messages for insert to authenticated with check (sender_id = auth.uid() and exists(select 1 from public.conversation_members m where m.conversation_id = conversation_id and m.user_id = auth.uid()));

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.equipment, public.announcements, public.maintenance_windows, public.issues to authenticated;
grant select, insert, update on public.reservations, public.waitlist to authenticated;
grant delete on public.waitlist to authenticated;
grant select on public.conversations, public.conversation_members, public.messages to authenticated;
grant insert on public.messages to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.reservation_slots(timestamptz,timestamptz) to authenticated;
grant execute on function public.start_reservation_conversation(uuid) to authenticated;

-- Activate message change events for realtime subscriptions when the default publication exists.
do $$ begin
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages;
  end if;
exception when duplicate_object then null;
end $$;

create or replace function public.guard_reservation_insert()
returns trigger language plpgsql set search_path = '' as $$
declare
  equipment_status text;
  max_duration integer;
begin
  select status, max_duration_minutes into equipment_status, max_duration from public.equipment where device_no = new.device_no;
  if equipment_status is null then raise exception 'equipment not found'; end if;
  if equipment_status <> 'available' then raise exception 'equipment is not open for booking'; end if;
  if new.starts_at <= now() then raise exception 'reservation must start in the future'; end if;
  if auth.role() = 'authenticated' and not public.is_admin() and new.status <> 'pending' then raise exception 'new reservations must start pending'; end if;
  if max_duration is not null and new.ends_at - new.starts_at > make_interval(mins => max_duration) then raise exception 'reservation exceeds the allowed duration'; end if;
  if exists(select 1 from public.maintenance_windows m where m.device_no = new.device_no and tstzrange(m.starts_at,m.ends_at,'[)') && tstzrange(new.starts_at,new.ends_at,'[)')) then
    raise exception 'equipment is under maintenance for the selected time';
  end if;
  return new;
end;
$$;
drop trigger if exists reservations_guard_insert on public.reservations;
create trigger reservations_guard_insert before insert or update of device_no, starts_at, ends_at on public.reservations
for each row when (new.status in ('pending','confirmed')) execute function public.guard_reservation_insert();

create or replace function public.increment_completed_use_count()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    update public.equipment set use_count = use_count + 1, updated_at = now() where device_no = new.device_no;
  end if;
  return new;
end;
$$;
drop trigger if exists reservations_count_completed on public.reservations;
create trigger reservations_count_completed after update of status on public.reservations
for each row execute function public.increment_completed_use_count();

revoke all on function public.is_admin() from public, anon;
revoke all on function public.reservation_slots(timestamptz,timestamptz) from public, anon;
revoke all on function public.start_reservation_conversation(uuid) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.reservation_slots(timestamptz,timestamptz) to authenticated;
grant execute on function public.start_reservation_conversation(uuid) to authenticated;

create or replace function public.guard_reservation_status_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.role() = 'authenticated' and not public.is_admin() then
    if new.status is distinct from old.status and new.status <> 'cancelled' then
      raise exception 'only an administrator may confirm or complete a reservation';
    end if;
    if new.owner_id is distinct from old.owner_id or new.created_at is distinct from old.created_at then
      raise exception 'reservation owner and creation time are immutable';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists reservations_guard_status_change on public.reservations;
create trigger reservations_guard_status_change before update on public.reservations
for each row execute function public.guard_reservation_status_change();

create or replace function public.reservation_counts(p_from timestamptz, p_to timestamptz)
returns table(device_no text, reservation_count bigint)
language sql stable security definer set search_path = '' as $$
  select r.device_no, count(*)
  from public.reservations r
  where r.starts_at >= p_from and r.starts_at < p_to
    and r.status <> 'cancelled'
    and p_from < p_to
  group by r.device_no;
$$;
revoke all on function public.reservation_counts(timestamptz,timestamptz) from public, anon;
grant execute on function public.reservation_counts(timestamptz,timestamptz) to authenticated;
