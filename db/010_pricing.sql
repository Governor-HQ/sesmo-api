-- ============================================================
-- SESMO TELECOM — FLEXIBLE VTU PRICING (Wave 2)
-- Three layers, resolved in priority order for any plan:
--   1) fixed price for that exact plan_id  (vtu_plan_overrides)
--   2) else markup % for that plan's network (vtu_network_markup)
--   3) else the global markup %             (app_settings 'vtu_markup_percent')
-- ============================================================

-- per-network markup %, e.g. ('MTN', 5.0)
create table if not exists vtu_network_markup (
  network    text primary key,
  percent    numeric(6,2) not null check (percent >= 0),
  updated_at timestamptz not null default now()
);

-- fixed customer price (in kobo) pinned to a specific SABVTU plan_id
create table if not exists vtu_plan_overrides (
  plan_id    text primary key,
  network    text,
  name       text,
  price_kobo bigint not null check (price_kobo > 0),
  updated_at timestamptz not null default now()
);

-- Resolve the customer price (kobo) for one plan, given its SABVTU cost (naira).
-- cost_naira is numeric because SABVTU prices can carry decimals.
create or replace function vtu_resolve_price_kobo(
  p_plan_id text, p_network text, p_cost_naira numeric, p_global_pct numeric
) returns bigint as $$
declare v_fixed bigint; v_net numeric; v_pct numeric;
begin
  -- 1) fixed price for this exact plan?
  select price_kobo into v_fixed from vtu_plan_overrides where plan_id = p_plan_id;
  if v_fixed is not null then return v_fixed; end if;

  -- 2) network markup?
  select percent into v_net from vtu_network_markup where network = p_network;
  v_pct := coalesce(v_net, p_global_pct, 5);

  -- 3) cost + markup, rounded UP to whole naira -> kobo
  if p_cost_naira is null or p_cost_naira <= 0 then return null; end if;
  return (ceil(p_cost_naira * (1 + v_pct/100.0)))::bigint * 100;
end;
$$ language plpgsql;
