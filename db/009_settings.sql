-- ============================================================
-- SESMO TELECOM — APP SETTINGS (Wave 2): live-editable config
-- Holds the VTU markup so admins can reprice all data without a redeploy.
-- ============================================================
create table if not exists app_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
insert into app_settings (key, value) values ('vtu_markup_percent', '5')
  on conflict (key) do nothing;
