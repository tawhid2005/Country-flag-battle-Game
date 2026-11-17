-- Run once in a NEW Supabase project's SQL editor. No client has direct access.
create table public.cfb_accounts (
  id uuid primary key,
  username text not null unique,
  email text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);
create table public.cfb_orders (
  id uuid primary key,
  account_id uuid not null references public.cfb_accounts(id),
  provider text not null check (provider in ('polar','sslcommerz','manual')),
  plan_id text not null,
  amount_minor integer not null check (amount_minor > 0),
  currency text not null,
  status text not null default 'pending',
  checkout_id text unique,
  provider_order_id text unique,
  paid_at timestamptz,
  activation_nonce uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);
create table public.cfb_entitlements (
  account_id uuid primary key references public.cfb_accounts(id),
  plan_id text not null,
  expires_at timestamptz not null,
  revoked boolean not null default false
);
create table public.cfb_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.cfb_orders(id),
  kind text not null,
  detail text not null,
  created_at timestamptz not null default now()
);
create table public.cfb_limits (
  key text primary key,
  hits integer not null,
  window_start timestamptz not null
);
alter table public.cfb_accounts enable row level security;
alter table public.cfb_orders enable row level security;
alter table public.cfb_entitlements enable row level security;
alter table public.cfb_events enable row level security;
alter table public.cfb_limits enable row level security;
revoke all on public.cfb_accounts, public.cfb_orders, public.cfb_entitlements, public.cfb_events, public.cfb_limits from anon, authenticated;
grant all on public.cfb_accounts, public.cfb_orders, public.cfb_entitlements, public.cfb_events, public.cfb_limits to service_role;

-- Lock the order and account: concurrent IPN + browser reconciliation grant once.
create function public.cfb_complete_order(p_id uuid, p_provider_id text, p_days integer)
returns void language plpgsql security definer set search_path = public as $$
declare o cfb_orders; begin
  select * into o from cfb_orders where id = p_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status = 'paid' then return; end if;
  if o.status not in ('pending','checkout_failed') then raise exception 'Order cannot be fulfilled'; end if;
  if p_days < 1 or p_days > 36500 then raise exception 'Invalid duration'; end if;
  perform 1 from cfb_accounts where id = o.account_id for update;
  insert into cfb_entitlements(account_id, plan_id, expires_at)
    values(o.account_id, o.plan_id, now() + make_interval(days => p_days))
  on conflict(account_id) do update set
    expires_at = greatest(now(), case when cfb_entitlements.revoked then now() else cfb_entitlements.expires_at end) + make_interval(days => p_days),
    plan_id = excluded.plan_id, revoked = false;
  update cfb_orders set status = 'paid', paid_at = now(), provider_order_id = p_provider_id where id = p_id;
  insert into cfb_events(order_id, kind, detail) values(p_id, 'activated', 'Verified payment granted access');
end $$;
create function public.cfb_rate_limit(p_key text, p_max integer, p_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare n integer; begin
  insert into cfb_limits(key,hits,window_start) values(p_key,1,now())
  on conflict(key) do update set
    hits = case when cfb_limits.window_start < now() - make_interval(secs=>p_seconds) then 1 else cfb_limits.hits+1 end,
    window_start = case when cfb_limits.window_start < now() - make_interval(secs=>p_seconds) then now() else cfb_limits.window_start end
  returning hits into n;
  return n <= p_max;
end $$;
revoke all on function public.cfb_complete_order(uuid,text,integer) from public, anon, authenticated;
revoke all on function public.cfb_rate_limit(text,integer,integer) from public, anon, authenticated;
grant execute on function public.cfb_complete_order(uuid,text,integer) to service_role;
grant execute on function public.cfb_rate_limit(text,integer,integer) to service_role;
