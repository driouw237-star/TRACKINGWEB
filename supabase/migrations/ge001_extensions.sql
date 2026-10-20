-- ============================================================================
-- GlobalExpress — Complete Database Schema
-- File: supabase/migrations/001_initial_schema.sql
-- Target: Supabase (Postgres 15+)
-- Layers: schemas, types, functions, tables, indexes, triggers, RLS, seed
-- ============================================================================

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 0. SESSION PREAMBLE                                                      │
-- └──────────────────────────────────────────────────────────────────────────┘
set statement_timeout = 0;
set lock_timeout = 0;
set idle_in_transaction_session_timeout = 0;
set client_encoding = 'UTF8';
set standard_conforming_strings = on;
set check_function_bodies = false;
set xmloption = content;
set client_min_messages = warning;
set row_security = off;

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 1. SCHEMAS                                                               │
-- └──────────────────────────────────────────────────────────────────────────┘
create schema if not exists app;
create schema if not exists admin;
create schema if not exists audit;
create schema if not exists config;

comment on schema app    is 'Core domain: users, shipments, payments, wallet, tickets, notifications';
comment on schema admin  is 'Admin roles, permissions, grants';
comment on schema audit  is 'Immutable audit trail: append-only';
comment on schema config is 'Platform settings, feature flags, idempotency keys';

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 2. EXTENSIONS                                                            │
-- └──────────────────────────────────────────────────────────────────────────┘
create extension if not exists pgcrypto with schema public;
create extension if not exists citext   with schema public;
create extension if not exists pg_trgm  with schema public;
create extension if not exists "uuid-ossp" with schema public;

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 3. ENUM TYPES                                                            │
-- └──────────────────────────────────────────────────────────────────────────┘
do $$ begin
  create type app.user_role as enum ('user','support','finance','auditor','admin','super_admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.user_status as enum ('pending_verification','active','suspended','closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.shipment_status as enum ('Pending','In Transit','On Hold','Delivered','Cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.package_handling as enum ('None','Fragile','Perishable','Signature Required','Leave at Door');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.payment_method as enum ('Wallet','MTN MoMo','Orange Money','Card','Crypto');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.payment_kind as enum ('Shipment','Deposit','Refund','Withdraw');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.payment_status as enum ('Paid','Pending','Failed','Refunded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.wallet_txn_type as enum ('Deposit','Withdraw','Shipment','Refund','Adjustment');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.ledger_direction as enum ('debit','credit');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.ledger_entry_type as enum (
    'deposit','withdrawal','shipment_fee','refund','adjustment','referral_bonus','reversal'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.ticket_status as enum ('Open','In Progress','Resolved','Closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.ticket_priority as enum ('Low','Normal','High','Urgent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.notification_type as enum ('info','success','warning','error');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.notification_source as enum ('system','admin-broadcast','user-action');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.audit_actor_type as enum ('user','admin','system');
exception when duplicate_object then null; end $$;

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 4. HELPER FUNCTIONS — SESSION CONTEXT                                    │
-- └──────────────────────────────────────────────────────────────────────────┘

create or replace function app.current_user_id()
returns uuid
language sql stable parallel safe
as $$
  select coalesce(
    nullif(current_setting('app.current_user_id', true), '')::uuid,
    auth.uid()
  );
$$;
comment on function app.current_user_id() is 'Acting user UUID: prefers app.current_user_id GUC (for scripts), falls back to auth.uid().';

create or replace function app.current_role()
returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('app.current_role', true), ''),
    (select role::text from app.users where id = auth.uid())
  );
$$;
comment on function app.current_role() is 'Acting role: prefers app.current_role GUC (for scripts), falls back to app.users.role via auth.uid().';

create or replace function app.is_admin()
returns boolean
language sql stable
as $$
  select coalesce(app.current_role() in ('admin','super_admin'), false);
$$;
comment on function app.is_admin() is 'TRUE when the acting role is admin or super_admin.';

create or replace function app.is_staff()
returns boolean
language sql stable
as $$
  select coalesce(app.current_role() in ('support','finance','auditor','admin','super_admin'), false);
$$;
comment on function app.is_staff() is 'TRUE for any staff-level role.';

create or replace function app.current_correlation_id()
returns uuid
language plpgsql stable
as $$
declare v_raw text;
begin
  v_raw := current_setting('app.correlation_id', true);
  if v_raw is null or v_raw = '' then return null; end if;
  begin
    return v_raw::uuid;
  exception when invalid_text_representation then
    return null;
  end;
end;
$$;
comment on function app.current_correlation_id() is 'Request correlation UUID from app.correlation_id GUC.';

create or replace function app.assert_caller(p_user_id uuid)
returns void
language plpgsql stable
as $$
declare v_status app.user_status;
begin
  if p_user_id is null then
    raise exception 'assert_caller: p_user_id is NULL' using errcode = 'null_value_not_allowed';
  end if;
  if app.is_admin() then return; end if;
  if app.current_user_id() is null or app.current_user_id() <> p_user_id then
    raise exception 'assert_caller: caller % is not user %',
      coalesce(app.current_user_id()::text, '<null>'), p_user_id
      using errcode = 'insufficient_privilege';
  end if;
  select status into v_status from app.users where id = p_user_id;
  if not found then
    raise exception 'assert_caller: user % does not exist', p_user_id using errcode = 'no_data_found';
  end if;
  if v_status <> 'active' then
    raise exception 'assert_caller: user % not active (status=%)', p_user_id, v_status
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;
comment on function app.assert_caller(uuid) is 'Raises unless caller matches p_user_id or is admin, and the target user is active.';

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 5. TABLES — APP SCHEMA                                                   │
-- └──────────────────────────────────────────────────────────────────────────┘

create table if not exists app.users (
  id                uuid primary key default gen_random_uuid(),
  email             citext not null,
  phone             text,
  full_name         text,
  role              app.user_role   not null default 'user',
  status            app.user_status not null default 'active',
  wallet            numeric(20,6)   not null default 0,
  referral_code     text,
  flags             jsonb           not null default '{}'::jsonb,
  preferred_currency char(3)        not null default 'XAF',
  locale            text            not null default 'en-US',
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  last_login_at     timestamptz,
  failed_login_count integer        not null default 0,
  locked_until      timestamptz,
  created_at        timestamptz     not null default now(),
  updated_at        timestamptz     not null default now(),
  constraint users_email_format_chk check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint users_phone_format_chk check (phone is null or phone ~ '^\+?[0-9]{6,20}$'),
  constraint users_wallet_nonneg_chk check (wallet >= 0),
  constraint users_email_key unique (email),
  constraint users_referral_code_key unique (referral_code),
  constraint users_id_is_auth_fkey foreign key (id) references auth.users(id) on delete cascade
);
alter table app.users force row level security;
comment on table app.users is 'Profile extension of auth.users. One row per signed-up human.';
comment on column app.users.wallet is 'Cached wallet balance. Reconciled by apply_wallet_txn trigger.';

create table if not exists app.shipments (
  id                  uuid primary key default gen_random_uuid(),
  tracking_code       text not null,
  created_by          uuid not null references app.users(id) on delete cascade,
  status              app.shipment_status not null default 'Pending',
  origin_city         text,
  dest_city           text,
  current_location    text,
  estimated_delivery  text,
  package_type        text,
  weight              text,
  dimensions          text,
  contents            text,
  service_level       text,
  handling            app.package_handling default 'None',
  amount_paid         numeric(20,6) not null default 0,
  insured             boolean not null default false,
  sender_name         text,
  sender_company      text,
  sender_email        text,
  sender_phone        text,
  sender_address      text,
  receiver_name       text,
  receiver_company    text,
  receiver_email      text,
  receiver_phone      text,
  receiver_address    text,
  coords              jsonb not null default '{}'::jsonb,
  activities          jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint shipments_tracking_code_key unique (tracking_code),
  constraint shipments_tracking_code_format_chk check (tracking_code ~ '^GE-[0-9]{4}-[0-9]{4}-[A-Z]{2}$'),
  constraint shipments_amount_paid_nonneg_chk check (amount_paid >= 0)
);
alter table app.shipments force row level security;
comment on table app.shipments is 'Package lifecycle and routing. JSONB for coords/activities.';
comment on column app.shipments.coords is 'JSON: { origin:{lat,lng}, current:{lat,lng}, dest:{lat,lng} }';
comment on column app.shipments.activities is 'JSON array: [{ date, location, description }]';

create table if not exists app.payments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references app.users(id) on delete cascade,
  amount      numeric(20,6) not null,
  method      app.payment_method not null,
  kind        app.payment_kind   not null,
  status      app.payment_status not null default 'Pending',
  reference   text not null,
  description text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  constraint payments_reference_key unique (reference)
);
alter table app.payments force row level security;
comment on table app.payments is 'Immutable ledger of every financial transaction event.';

create table if not exists app.wallet_txns (
  id            bigserial primary key,
  user_id       uuid not null references app.users(id) on delete cascade,
  type          app.wallet_txn_type not null,
  amount        numeric(20,6) not null,
  balance_after numeric(20,6) not null default 0,
  description   text,
  reference     text,
  correlation_id uuid,
  created_at    timestamptz not null default now(),
  constraint wallet_txns_amount_nonzero_chk check (amount <> 0)
);
alter table app.wallet_txns force row level security;
comment on table app.wallet_txns is 'Running wallet ledger. balance_after is filled by trigger.';

create table if not exists app.tickets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references app.users(id) on delete cascade,
  subject    text not null,
  message    text not null,
  status     app.ticket_status   not null default 'Open',
  priority   app.ticket_priority not null default 'Normal',
  replies    jsonb not null default '[]'::jsonb,
  assigned_to uuid references app.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table app.tickets force row level security;
comment on table app.tickets is 'Customer support tickets. Replies are [{at, by, message}].';

create table if not exists app.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references app.users(id) on delete cascade,
  title        text not null,
  message      text not null,
  type         app.notification_type   not null default 'info',
  source       app.notification_source not null default 'system',
  is_read      boolean not null default false,
  read_at      timestamptz,
  link         text,
  broadcast_id uuid,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  constraint notifications_read_chk check ((is_read = false and read_at is null) or (is_read = true and read_at is not null))
);
alter table app.notifications force row level security;
comment on table app.notifications is 'In-app notifications. broadcast_id groups bulk sends.';

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 6. TABLES — AUDIT SCHEMA                                                 │
-- └──────────────────────────────────────────────────────────────────────────┘

create table if not exists audit.logs (
  id           bigserial primary key,
  actor_id     uuid,
  actor_name   text,
  actor_type   app.audit_actor_type not null default 'system',
  action       text not null,
  target       text,
  details      text,
  before_state jsonb,
  after_state  jsonb,
  correlation_id uuid,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
alter table audit.logs force row level security;
comment on table audit.logs is 'Append-only audit trail. All admin actions + critical state changes.';

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 7. TABLES — ADMIN SCHEMA                                                 │
-- └──────────────────────────────────────────────────────────────────────────┘

create table if not exists admin.roles (
  code        text primary key,
  name        text not null,
  description text,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint admin_roles_code_chk check (code ~ '^[a-z][a-z0-9_]*$')
);
alter table admin.roles force row level security;
comment on table admin.roles is 'Named admin roles. Assigned via admin.user_roles.';

create table if not exists admin.permissions (
  code        text primary key,
  resource    text not null,
  action      text not null,
  description text,
  created_at  timestamptz not null default now(),
  constraint admin_permissions_code_chk check (code ~ '^[a-z][a-z0-9_.]*$')
);
alter table admin.permissions force row level security;
comment on table admin.permissions is 'Granular permissions (e.g. users.write, wallet.adjust).';

create table if not exists admin.role_permissions (
  role_code       text not null references admin.roles(code) on delete cascade,
  permission_code text not null references admin.permissions(code) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (role_code, permission_code)
);
alter table admin.role_permissions force row level security;

create table if not exists admin.user_roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references app.users(id) on delete cascade,
  role_code  text not null references admin.roles(code) on delete cascade,
  granted_by uuid references app.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  constraint admin_user_roles_unique unique (user_id, role_code)
);
alter table admin.user_roles force row level security;
comment on table admin.user_roles is 'Which user has which admin role. One row per grant.';

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 8. TABLES — CONFIG SCHEMA                                                │
-- └──────────────────────────────────────────────────────────────────────────┘

create table if not exists config.settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  category    text not null default 'general',
  is_secret   boolean not null default false,
  updated_by  uuid references app.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- FIXED: Allowed uppercase letters for camelCase keys
  constraint config_settings_key_chk check (key ~ '^[a-zA-Z][a-zA-Z0-9_.]*$')
);
alter table config.settings force row level security;
comment on table config.settings is 'Platform configuration key-value store. is_secret rows are admin-only.';

create table if not exists config.idempotency_keys (
  id              bigserial primary key,
  scope           text not null,
  key             text not null,
  user_id         uuid references app.users(id) on delete cascade,
  request_hash    text not null,
  response_status integer,
  response_body   jsonb,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '24 hours'),
  constraint idempotency_scope_key_unique unique (scope, key)
);
alter table config.idempotency_keys force row level security;

create table if not exists config.feature_flags (
  code        text primary key,
  name        text not null,
  description text,
  is_enabled  boolean not null default false,
  rollout_percent integer not null default 0,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint feature_flags_rollout_range_chk check (rollout_percent between 0 and 100),
  -- FIXED: Allowed uppercase letters for camelCase keys
  constraint feature_flags_code_chk check (code ~ '^[a-zA-Z][a-zA-Z0-9_.]*$')
);
alter table config.feature_flags force row level security;

create table if not exists config.rate_limits (
  bucket_key  text primary key,
  window_start timestamptz not null,
  window_end   timestamptz not null,
  count        integer not null default 0,
  limit_value  integer not null,
  updated_at   timestamptz not null default now(),
  constraint rate_limits_count_nonneg_chk check (count >= 0),
  constraint rate_limits_limit_pos_chk check (limit_value > 0)
);
alter table config.rate_limits force row level security;

create table if not exists config.outbox (
  id             bigserial primary key,
  aggregate_type text not null,
  aggregate_id   uuid,
  event_type     text not null,
  payload        jsonb not null,
  status         text not null default 'pending',
  attempts       integer not null default 0,
  last_attempt_at timestamptz,
  processed_at   timestamptz,
  error_message  text,
  available_at   timestamptz not null default now(),
  correlation_id uuid,
  created_at     timestamptz not null default now(),
  constraint outbox_status_chk check (status in ('pending','processing','processed','failed','dead')),
  constraint outbox_attempts_nonneg_chk check (attempts >= 0)
);
comment on table config.outbox is 'Transactional outbox for async event delivery.';

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 9. INDEXES                                                               │
-- └──────────────────────────────────────────────────────────────────────────┘

-- users
create index if not exists idx_users_role        on app.users (role);
create index if not exists idx_users_status      on app.users (status);
create index if not exists idx_users_created_at  on app.users (created_at desc);
create index if not exists idx_users_email_trgm  on app.users using gin (email public.gin_trgm_ops);

-- shipments
create index if not exists idx_shipments_created_by  on app.shipments (created_by);
create index if not exists idx_shipments_status      on app.shipments (status);
create index if not exists idx_shipments_created_at  on app.shipments (created_at desc);
create index if not exists idx_shipments_tracking    on app.shipments (tracking_code);

-- payments
create index if not exists idx_payments_user_id    on app.payments (user_id);
create index if not exists idx_payments_status     on app.payments (status);
create index if not exists idx_payments_kind       on app.payments (kind);
create index if not exists idx_payments_created_at on app.payments (created_at desc);

-- wallet_txns
create index if not exists idx_wallet_txns_user_id    on app.wallet_txns (user_id, created_at desc);
create index if not exists idx_wallet_txns_created_at on app.wallet_txns (created_at desc);

-- tickets
create index if not exists idx_tickets_user_id    on app.tickets (user_id, created_at desc);
create index if not exists idx_tickets_status     on app.tickets (status);
create index if not exists idx_tickets_priority   on app.tickets (priority);
create index if not exists idx_tickets_assigned   on app.tickets (assigned_to) where assigned_to is not null;

-- notifications
create index if not exists idx_notifications_user_id    on app.notifications (user_id, created_at desc);
create index if not exists idx_notifications_unread     on app.notifications (user_id) where is_read = false;
create index if not exists idx_notifications_broadcast  on app.notifications (broadcast_id) where broadcast_id is not null;

-- audit
create index if not exists idx_audit_created_at  on audit.logs (created_at desc);
create index if not exists idx_audit_actor_id    on audit.logs (actor_id, created_at desc);
create index if not exists idx_audit_action      on audit.logs (action);
create index if not exists idx_audit_target      on audit.logs (target);

-- admin
create index if not exists idx_admin_user_roles_user on admin.user_roles (user_id);
create index if not exists idx_admin_user_roles_role on admin.user_roles (role_code);

-- config
create index if not exists idx_idempotency_expires on config.idempotency_keys (expires_at);
create index if not exists idx_outbox_pending      on config.outbox (available_at) where status = 'pending';
create index if not exists idx_rate_limits_window  on config.rate_limits (window_end);

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 10. UPDATED_AT TRIGGER                                                   │
-- └──────────────────────────────────────────────────────────────────────────┘

create or replace function app.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_users_updated_at        on app.users;
drop trigger if exists trg_shipments_updated_at    on app.shipments;
drop trigger if exists trg_tickets_updated_at      on app.tickets;
drop trigger if exists trg_settings_updated_at     on config.settings;
drop trigger if exists trg_feature_flags_updated_at on config.feature_flags;

create trigger trg_users_updated_at         before update on app.users        for each row execute function app.tg_set_updated_at();
create trigger trg_shipments_updated_at     before update on app.shipments    for each row execute function app.tg_set_updated_at();
create trigger trg_tickets_updated_at       before update on app.tickets      for each row execute function app.tg_set_updated_at();
create trigger trg_settings_updated_at      before update on config.settings  for each row execute function app.tg_set_updated_at();
create trigger trg_feature_flags_updated_at before update on config.feature_flags for each row execute function app.tg_set_updated_at();

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 11. AUTH TRIGGER — sync auth.users -> app.users                          │
-- └──────────────────────────────────────────────────────────────────────────┘

create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql security definer
set search_path = app, public
as $$
begin
  insert into app.users (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'name',
      new.raw_user_meta_data->>'full_name',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_auth_user();

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 12. WALLET LEDGER TRIGGER                                                │
-- │ Every wallet_txns INSERT atomically updates app.users.wallet.            │
-- └──────────────────────────────────────────────────────────────────────────┘

create or replace function app.apply_wallet_txn()
returns trigger
language plpgsql security definer
set search_path = app, public
as $$
declare
  v_new_balance numeric(20,6);
begin
  update app.users
     set wallet = wallet + new.amount
   where id = new.user_id
   returning wallet into v_new_balance;

  if not found then
    raise exception 'apply_wallet_txn: user % not found', new.user_id using errcode = 'no_data_found';
  end if;

  if v_new_balance < 0 then
    raise exception 'apply_wallet_txn: insufficient funds (would be %)', v_new_balance
      using errcode = 'check_violation';
  end if;

  new.balance_after := v_new_balance;
  new.correlation_id := coalesce(new.correlation_id, app.current_correlation_id());
  return new;
end;
$$;

drop trigger if exists trg_wallet_txn_apply on app.wallet_txns;
create trigger trg_wallet_txn_apply
  before insert on app.wallet_txns
  for each row execute function app.apply_wallet_txn();

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 13. AUDIT TRIGGERS                                                       │
-- └──────────────────────────────────────────────────────────────────────────┘

create or replace function app.write_audit()
returns trigger
language plpgsql security definer
set search_path = app, audit, public
as $$
declare
  v_actor_id   uuid := app.current_user_id();
  v_actor_name text;
  v_actor_type app.audit_actor_type := 'system';
  v_action     text;
  v_target     text;
  v_before     jsonb;
  v_after      jsonb;
begin
  if v_actor_id is not null then
    select coalesce(full_name, email::text) into v_actor_name
      from app.users where id = v_actor_id;
    if found then
      v_actor_type := case when app.is_admin() then 'admin' else 'user' end;
    else
      v_actor_id := null;
    end if;
  end if;

  v_action := tg_table_schema || '.' || tg_table_name || '.' || lower(tg_op);
  v_target := tg_table_name || ':' || coalesce(
    (case when tg_op = 'DELETE' then old else new end)::text,
    'unknown'
  );

  if tg_op in ('UPDATE','DELETE') then v_before := to_jsonb(old); end if;
  if tg_op in ('INSERT','UPDATE') then v_after  := to_jsonb(new); end if;

  insert into audit.logs (
    actor_id, actor_name, actor_type, action, target,
    before_state, after_state, correlation_id
  ) values (
    v_actor_id, v_actor_name, v_actor_type, v_action, v_target,
    v_before, v_after, app.current_correlation_id()
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_audit_users        on app.users;
drop trigger if exists trg_audit_shipments    on app.shipments;
drop trigger if exists trg_audit_payments     on app.payments;
drop trigger if exists trg_audit_wallet_txns  on app.wallet_txns;
drop trigger if exists trg_audit_tickets      on app.tickets;

create trigger trg_audit_users       after insert or update or delete on app.users       for each row execute function app.write_audit();
create trigger trg_audit_shipments   after insert or update or delete on app.shipments   for each row execute function app.write_audit();
create trigger trg_audit_payments    after insert or update or delete on app.payments    for each row execute function app.write_audit();
create trigger trg_audit_wallet_txns after insert or update or delete on app.wallet_txns for each row execute function app.write_audit();
create trigger trg_audit_tickets     after insert or update or delete on app.tickets     for each row execute function app.write_audit();

-- ── Immutability: audit.logs cannot be updated or deleted ──────────────────
create or replace function audit.tg_logs_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit.logs is append-only: % not permitted', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists trg_audit_logs_no_update on audit.logs;
drop trigger if exists trg_audit_logs_no_delete on audit.logs;

create trigger trg_audit_logs_no_update before update on audit.logs for each row execute function audit.tg_logs_immutable();
create trigger trg_audit_logs_no_delete before delete on audit.logs for each row execute function audit.tg_logs_immutable();

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 14. SHIPMENT HELPERS                                                     │
-- └──────────────────────────────────────────────────────────────────────────┘

create or replace function app.gen_tracking_code()
returns text
language plpgsql
as $$
declare
  v_code text;
  v_attempts int := 0;
begin
  loop
    v_attempts := v_attempts + 1;
    if v_attempts > 20 then
      raise exception 'gen_tracking_code: exhausted retries';
    end if;
    v_code := 'GE-' ||
      lpad(floor(random()*10000)::int::text, 4, '0') || '-' ||
      lpad(floor(random()*10000)::int::text, 4, '0') || '-US';
    perform 1 from app.shipments where tracking_code = v_code;
    if not found then return v_code; end if;
  end loop;
end;
$$;

create or replace function app.create_shipment(
  p_user_id           uuid,
  p_origin_city       text,
  p_dest_city         text,
  p_package_type      text,
  p_weight            text,
  p_contents          text,
  p_service_level     text,
  p_sender_name       text,
  p_sender_address    text,
  p_receiver_name     text,
  p_receiver_address  text,
  p_amount_paid       numeric
)
returns uuid
language plpgsql security definer
set search_path = app, public
as $$
declare
  v_tracking   text;
  v_shipment_id uuid;
  v_ref        text;
begin
  perform app.assert_caller(p_user_id);
  if p_amount_paid < 0 then raise exception 'amount_paid must be >= 0'; end if;

  v_tracking := app.gen_tracking_code();

  insert into app.shipments (
    tracking_code, created_by, origin_city, dest_city,
    package_type, weight, contents, service_level,
    sender_name, sender_address, receiver_name, receiver_address,
    amount_paid, activities
  ) values (
    v_tracking, p_user_id, p_origin_city, p_dest_city,
    p_package_type, p_weight, p_contents, p_service_level,
    p_sender_name, p_sender_address, p_receiver_name, p_receiver_address,
    p_amount_paid,
    jsonb_build_array(jsonb_build_object(
      'date', to_char(now(), 'Mon DD, YYYY · HH12:MI AM'),
      'location', p_origin_city,
      'description', 'Shipment created'
    ))
  )
  returning id into v_shipment_id;

  if p_amount_paid > 0 then
    v_ref := 'TXN-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 10));
    insert into app.wallet_txns (user_id, type, amount, description, reference)
    values (p_user_id, 'Shipment', -p_amount_paid, 'Shipping fee for ' || v_tracking, v_ref);
    insert into app.payments (user_id, amount, method, kind, status, reference, description, metadata)
    values (p_user_id, p_amount_paid, 'Wallet', 'Shipment', 'Paid', v_ref, 'Shipping fee for ' || v_tracking,
            jsonb_build_object('shipment_id', v_shipment_id, 'tracking_code', v_tracking));
  end if;

  insert into app.notifications (user_id, title, message, type)
  values (p_user_id, 'Shipment created', 'Your shipment ' || v_tracking || ' is ready for pickup.', 'success');

  return v_shipment_id;
end;
$$;
comment on function app.create_shipment is 'Atomically creates a shipment, deducts shipping fee, and notifies the user.';

create or replace function app.update_shipment_status(
  p_shipment_id     uuid,
  p_status          app.shipment_status,
  p_current_location text default null,
  p_estimated_delivery text default null,
  p_note            text default null
)
returns void
language plpgsql security definer
set search_path = app, public
as $$
declare
  v_shipment app.shipments%rowtype;
  v_event    jsonb;
begin
  if not app.is_admin() then
    raise exception 'update_shipment_status requires admin' using errcode = 'insufficient_privilege';
  end if;

  select * into v_shipment from app.shipments where id = p_shipment_id for update;
  if not found then raise exception 'shipment % not found', p_shipment_id; end if;

  v_event := jsonb_build_object(
    'date', to_char(now(), 'Mon DD, YYYY · HH12:MI AM'),
    'location', coalesce(p_current_location, v_shipment.current_location, 'Unknown'),
    'description', coalesce(p_note, 'Status changed to ' || p_status::text)
  );

  update app.shipments
     set status = p_status,
         current_location = coalesce(p_current_location, current_location),
         estimated_delivery = coalesce(p_estimated_delivery, estimated_delivery),
         activities = activities || jsonb_build_array(v_event)
   where id = p_shipment_id;
end;
$$;

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 15. BROADCAST RPC                                                        │
-- └──────────────────────────────────────────────────────────────────────────┘

create or replace function app.broadcast_notification(
  p_title     text,
  p_message   text,
  p_type      app.notification_type default 'info',
  p_audience  text default 'all',
  p_link      text default null
)
returns uuid
language plpgsql security definer
set search_path = app, public
as $$
declare
  v_broadcast_id uuid := gen_random_uuid();
  v_count int;
begin
  if not app.is_admin() then
    raise exception 'broadcast_notification requires admin' using errcode = 'insufficient_privilege';
  end if;

  insert into app.notifications (user_id, title, message, type, source, broadcast_id, link)
  select u.id, p_title, p_message, p_type, 'admin-broadcast', v_broadcast_id, p_link
    from app.users u
   where u.role = 'user'
     and (
       p_audience = 'all'
       or (p_audience = 'zero-wallet' and coalesce(u.wallet,0) = 0)
       or (p_audience = 'active-shippers' and exists (
             select 1 from app.shipments s
              where s.created_by = u.id and s.status not in ('Delivered','Cancelled')))
     );

  get diagnostics v_count = row_count;
  insert into audit.logs (actor_id, actor_name, actor_type, action, target, details)
  values (app.current_user_id(),
          (select coalesce(full_name, email::text) from app.users where id = app.current_user_id()),
          'admin', 'notification.broadcast', p_audience::text,
          'Broadcast to ' || v_count || ' users: ' || p_title);
  return v_broadcast_id;
end;
$$;

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 16. RLS POLICIES — APP SCHEMA                                            │
-- └──────────────────────────────────────────────────────────────────────────┘

-- ── users ────────────────────────────────────────────────────────────────────
drop policy if exists users_self_read on app.users;
create policy users_self_read on app.users
  for select using (id = auth.uid() or app.is_admin());

drop policy if exists users_self_update on app.users;
create policy users_self_update on app.users
  for update using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select role from app.users where id = auth.uid())
    and wallet = (select wallet from app.users where id = auth.uid())
  );

drop policy if exists users_admin_write on app.users;
create policy users_admin_write on app.users
  for all using (app.is_admin());

-- ── shipments ────────────────────────────────────────────────────────────────
drop policy if exists shipments_select on app.shipments;
create policy shipments_select on app.shipments
  for select using (created_by = auth.uid() or app.is_admin());

drop policy if exists shipments_insert on app.shipments;
create policy shipments_insert on app.shipments
  for insert with check (created_by = auth.uid());

drop policy if exists shipments_update_self on app.shipments;
create policy shipments_update_self on app.shipments
  for update using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists shipments_admin_write on app.shipments;
create policy shipments_admin_write on app.shipments
  for all using (app.is_admin());

drop policy if exists shipments_public_read on app.shipments;
create policy shipments_public_read on app.shipments
  for select to anon
  using (true);

-- ── payments ────────────────────────────────────────────────────────────────
drop policy if exists payments_select on app.payments;
create policy payments_select on app.payments
  for select using (user_id = auth.uid() or app.is_admin());

drop policy if exists payments_admin_write on app.payments;
create policy payments_admin_write on app.payments
  for all using (app.is_admin());

-- ── wallet_txns ─────────────────────────────────────────────────────────────
drop policy if exists wallet_txns_select on app.wallet_txns;
create policy wallet_txns_select on app.wallet_txns
  for select using (user_id = auth.uid() or app.is_admin());

drop policy if exists wallet_txns_admin_write on app.wallet_txns;
create policy wallet_txns_admin_write on app.wallet_txns
  for all using (app.is_admin());

-- ── tickets ─────────────────────────────────────────────────────────────────
drop policy if exists tickets_select on app.tickets;
create policy tickets_select on app.tickets
  for select using (user_id = auth.uid() or app.is_admin());

drop policy if exists tickets_insert on app.tickets;
create policy tickets_insert on app.tickets
  for insert with check (user_id = auth.uid());

drop policy if exists tickets_update_self on app.tickets;
create policy tickets_update_self on app.tickets
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists tickets_admin_write on app.tickets;
create policy tickets_admin_write on app.tickets
  for all using (app.is_admin());

-- ── notifications ────────────────────────────────────────────────────────────
drop policy if exists notifications_select on app.notifications;
create policy notifications_select on app.notifications
  for select using (user_id = auth.uid() or app.is_admin());

drop policy if exists notifications_update_self on app.notifications;
create policy notifications_update_self on app.notifications
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists notifications_admin_write on app.notifications;
create policy notifications_admin_write on app.notifications
  for all using (app.is_admin());

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 17. RLS POLICIES — AUDIT SCHEMA                                          │
-- └──────────────────────────────────────────────────────────────────────────┘

drop policy if exists audit_admin_read on audit.logs;
create policy audit_admin_read on audit.logs
  for select using (app.is_admin());

drop policy if exists audit_admin_insert on audit.logs;
create policy audit_admin_insert on audit.logs
  for insert with check (app.is_admin());

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 18. RLS POLICIES — ADMIN SCHEMA                                          │
-- └──────────────────────────────────────────────────────────────────────────┘

drop policy if exists admin_roles_read on admin.roles;
create policy admin_roles_read on admin.roles
  for select using (app.is_staff());

drop policy if exists admin_roles_admin on admin.roles;
create policy admin_roles_admin on admin.roles
  for all using (app.is_admin());

drop policy if exists admin_permissions_read on admin.permissions;
create policy admin_permissions_read on admin.permissions
  for select using (app.is_staff());

drop policy if exists admin_permissions_admin on admin.permissions;
create policy admin_permissions_admin on admin.permissions
  for all using (app.is_admin());

drop policy if exists admin_role_permissions_read on admin.role_permissions;
create policy admin_role_permissions_read on admin.role_permissions
  for select using (app.is_staff());

drop policy if exists admin_role_permissions_admin on admin.role_permissions;
create policy admin_role_permissions_admin on admin.role_permissions
  for all using (app.is_admin());

drop policy if exists admin_user_roles_self on admin.user_roles;
create policy admin_user_roles_self on admin.user_roles
  for select using (user_id = auth.uid() or app.is_staff());

drop policy if exists admin_user_roles_admin on admin.user_roles;
create policy admin_user_roles_admin on admin.user_roles
  for all using (app.is_admin());

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 19. RLS POLICIES — CONFIG SCHEMA                                         │
-- └──────────────────────────────────────────────────────────────────────────┘

drop policy if exists settings_public_read on config.settings;
create policy settings_public_read on config.settings
  for select to anon, authenticated
  using (not is_secret);

drop policy if exists settings_admin_read_secret on config.settings;
create policy settings_admin_read_secret on config.settings
  for select using (is_secret and app.is_admin());

drop policy if exists settings_admin_write on config.settings;
create policy settings_admin_write on config.settings
  for all using (app.is_admin());

drop policy if exists idempotency_self on config.idempotency_keys;
create policy idempotency_self on config.idempotency_keys
  for all using (user_id = auth.uid() or app.is_admin());

drop policy if exists feature_flags_public_read on config.feature_flags;
create policy feature_flags_public_read on config.feature_flags
  for select to anon, authenticated
  using (true);

drop policy if exists feature_flags_admin_write on config.feature_flags;
create policy feature_flags_admin_write on config.feature_flags
  for all using (app.is_admin());

drop policy if exists rate_limits_admin on config.rate_limits;
create policy rate_limits_admin on config.rate_limits
  for all using (app.is_admin());

drop policy if exists outbox_admin on config.outbox;
create policy outbox_admin on config.outbox
  for all using (app.is_admin());

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 20. GRANTS                                                               │
-- └──────────────────────────────────────────────────────────────────────────┘

grant usage on schema app, admin, audit, config to anon, authenticated;

grant select on app.users, app.shipments, app.payments, app.wallet_txns,
                app.tickets, app.notifications to authenticated;
grant select on app.shipments to anon;

grant select on admin.roles, admin.permissions, admin.role_permissions,
                admin.user_roles to authenticated;

grant select on audit.logs to authenticated;

grant select on config.settings, config.feature_flags to anon, authenticated;
grant select on config.idempotency_keys to authenticated;

grant execute on function app.create_shipment to authenticated;
grant execute on function app.update_shipment_status to authenticated;
grant execute on function app.broadcast_notification to authenticated;
grant execute on function app.assert_caller to authenticated;
grant execute on function app.is_admin to authenticated;
grant execute on function app.is_staff to authenticated;
grant execute on function app.current_user_id to authenticated;
grant execute on function app.current_role to authenticated;
grant execute on function app.current_correlation_id to authenticated;

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 21. SEED DATA                                                            │
-- └──────────────────────────────────────────────────────────────────────────┘

-- Admin roles
insert into admin.roles (code, name, description, is_system) values
  ('super_admin', 'Super Admin', 'Full access; can manage other admins', true),
  ('admin',       'Admin',       'Standard admin access', true),
  ('support',     'Support',     'Read-only support access', true),
  ('finance',     'Finance',     'Deposits, withdrawals, settlements', true),
  ('auditor',     'Auditor',     'Read-only audit access', true)
on conflict (code) do nothing;

-- Admin permissions
insert into admin.permissions (code, resource, action, description) values
  ('users.read',         'users',         'read',    'View user profiles'),
  ('users.write',        'users',         'write',   'Modify user profiles'),
  ('users.suspend',      'users',         'suspend', 'Suspend or reactivate users'),
  ('shipments.read',     'shipments',     'read',    'View shipments'),
  ('shipments.write',    'shipments',     'write',   'Modify shipments and status'),
  ('payments.read',      'payments',      'read',    'View payments'),
  ('payments.write',     'payments',      'write',   'Record payments and refunds'),
  ('wallet.read',        'wallet',        'read',    'View wallet ledger'),
  ('wallet.adjust',      'wallet',        'adjust',  'Adjust wallet balances'),
  ('tickets.read',       'tickets',       'read',    'View support tickets'),
  ('tickets.write',      'tickets',       'write',   'Reply to and resolve tickets'),
  ('notifications.send', 'notifications', 'send',    'Send broadcasts'),
  ('settings.read',      'settings',      'read',    'View platform settings'),
  ('settings.write',     'settings',      'write',   'Modify platform settings'),
  ('audit.read',         'audit',         'read',    'Read audit logs'),
  ('admins.manage',      'admins',        'manage',  'Manage admin roles')
on conflict (code) do nothing;

-- Role → permission mapping
insert into admin.role_permissions (role_code, permission_code) values
  ('super_admin','users.read'),('super_admin','users.write'),('super_admin','users.suspend'),
  ('super_admin','shipments.read'),('super_admin','shipments.write'),
  ('super_admin','payments.read'),('super_admin','payments.write'),
  ('super_admin','wallet.read'),('super_admin','wallet.adjust'),
  ('super_admin','tickets.read'),('super_admin','tickets.write'),
  ('super_admin','notifications.send'),
  ('super_admin','settings.read'),('super_admin','settings.write'),
  ('super_admin','audit.read'),('super_admin','admins.manage'),
  ('admin','users.read'),('admin','users.write'),('admin','users.suspend'),
  ('admin','shipments.read'),('admin','shipments.write'),
  ('admin','payments.read'),('admin','payments.write'),
  ('admin','wallet.read'),('admin','wallet.adjust'),
  ('admin','tickets.read'),('admin','tickets.write'),
  ('admin','notifications.send'),
  ('admin','settings.read'),('admin','audit.read'),
  ('support','users.read'),
  ('support','shipments.read'),
  ('support','payments.read'),
  ('support','tickets.read'),('support','tickets.write'),
  ('finance','payments.read'),('finance','payments.write'),
  ('finance','wallet.read'),('finance','wallet.adjust'),
  ('finance','users.read'),
  ('auditor','users.read'),
  ('auditor','shipments.read'),
  ('auditor','payments.read'),
  ('auditor','wallet.read'),
  ('auditor','audit.read'),
  ('auditor','settings.read')
on conflict (role_code, permission_code) do nothing;

-- Platform settings
insert into config.settings (key, value, description, category) values
  ('shippingFee',         '4000'::jsonb,                  'Base shipping fee in XAF',                    'fees'),
  ('currencyLabel',       '"Fr."'::jsonb,                 'Display currency symbol',                     'general'),
  ('minDeposit',          '500'::jsonb,                   'Minimum deposit amount (XAF)',                'fees'),
  ('maxDeposit',          '5000000'::jsonb,               'Maximum deposit amount (XAF)',                'fees'),
  ('minWithdrawal',       '1000'::jsonb,                  'Minimum withdrawal amount (XAF)',             'fees'),
  ('maxWithdrawal',       '2000000'::jsonb,               'Maximum withdrawal amount (XAF)',             'fees'),
  ('withdrawalFeePercent','0.01'::jsonb,                  'Withdrawal fee as fraction (0.01 = 1%)',      'fees'),
  ('supportEmail',        '"support@globalexpress.test"'::jsonb, 'Public support email',                 'general'),
  ('supportPhone',        '"+237 6XX XXX XXX"'::jsonb,    'Public support phone',                        'general'),
  ('enableReferrals',     'true'::jsonb,                  'Enable referral program',                     'features'),
  ('enable2FA',           'false'::jsonb,                 'Enable two-factor authentication',            'security'),
  ('enableCrypto',        'false'::jsonb,                 'Enable crypto payments',                      'features'),
  ('maintenanceMode',     'false'::jsonb,                 'Lock the customer portal during maintenance', 'general'),
  ('sessionTimeoutMins',  '60'::jsonb,                    'Session idle timeout (minutes)',              'security'),
  ('maxLoginAttempts',    '5'::jsonb,                     'Failed login attempts before lockout',        'security')
on conflict (key) do nothing;

-- Feature flags
insert into config.feature_flags (code, name, description, is_enabled, rollout_percent) values
  ('investments.enabled',      'Investments',      'Enable investment products',      false, 0),
  ('withdrawals.auto_approve', 'Auto Withdrawals', 'Auto-approve trusted withdrawals', false, 0),
  ('kyc.enabled',              'KYC',              'Require KYC before withdrawals',   false, 0),
  ('push.enabled',             'Push',             'Send push notifications',          false, 0)
on conflict (code) do nothing;

-- ============================================================================
-- End of file.
-- ============================================================================