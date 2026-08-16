-- ═══════════════════════════════════════════════════════════════════════════
-- Resonance — Supabase (Postgres) senkron şeması
--
-- KURULUM: Supabase paneli → SQL Editor → bu dosyanın TAMAMINI yapıştır → Run.
-- Tekrar çalıştırmak güvenlidir (IF NOT EXISTS / DROP POLICY IF EXISTS).
--
-- TASARIM NOTLARI
--  • Her tabloda `user_id` var ve RLS ile kilitli: bir kullanıcı YALNIZCA
--    kendi satırlarını görebilir/yazabilir. anon key herkese açık olsa bile
--    başkasının verisine erişilemez.
--  • `synced_at` SUNUCU saatidir ve her yazımda trigger ile tazelenir.
--    İstemci "bu zamandan sonrasını ver" diye sorar. Cihaz saatleri
--    birbirini tutmadığı için teslimat penceresi ASLA cihaz saatine
--    bağlanamaz (bkz. src/lib/sync/engine.ts).
--  • `updated_at` CİHAZ saatidir ve yalnız çakışma çözümünde (last-write-wins)
--    kullanılır.
--  • ⚠️ BULUTTA YABANCI ANAHTAR (FK) YOK — bilerek. playlist_tracks satırı,
--    parçası henüz yüklenmemişken gelirse FK'lı şemada push komple patlardı.
--    Tutarlılık yerelde (SQLite) korunur; bulut yalnızca taşıyıcıdır.
--  • Silme = tombstone (`deleted = 1`), gerçek DELETE yok.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Tablolar ──────────────────────────────────────────────────────────────

create table if not exists public.tracks (
  user_id     uuid not null default auth.uid(),
  id          text not null,
  source      text not null default 'youtube',
  source_id   text not null default '',
  title       text not null default '',
  artist      text not null default '',
  album       text,
  duration_ms bigint not null default 0,
  thumbnail   text,
  added_at    bigint not null default 0,
  updated_at  bigint not null default 0,
  synced_at   timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.playlists (
  user_id     uuid not null default auth.uid(),
  id          text not null,
  name        text not null default '',
  description text,
  source      text not null default 'local',
  source_url  text,
  created_at  bigint not null default 0,
  updated_at  bigint not null default 0,
  deleted     smallint not null default 0,
  synced_at   timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.playlist_tracks (
  user_id     uuid not null default auth.uid(),
  playlist_id text not null,
  track_id    text not null,
  position    integer not null default 0,
  added_at    bigint not null default 0,
  vote        integer not null default 0,
  updated_at  bigint not null default 0,
  deleted     smallint not null default 0,
  synced_at   timestamptz not null default now(),
  primary key (user_id, playlist_id, track_id)
);

create table if not exists public.votes (
  user_id     uuid not null default auth.uid(),
  uid         text not null,
  track_id    text not null,
  playlist_id text,
  value       integer not null default 0,
  created_at  bigint not null default 0,
  hour        integer not null default 0,
  dow         integer not null default 0,
  device_id   text,
  updated_at  bigint not null default 0,
  deleted     smallint not null default 0,
  synced_at   timestamptz not null default now(),
  primary key (user_id, uid)
);

create table if not exists public.play_history (
  user_id    uuid not null default auth.uid(),
  uid        text not null,
  track_id   text not null,
  played_at  bigint not null default 0,
  ms_played  bigint not null default 0,
  hour       integer not null default 0,
  dow        integer not null default 0,
  device_id  text,
  updated_at bigint not null default 0,
  synced_at  timestamptz not null default now(),
  primary key (user_id, uid)
);

create table if not exists public.recommendation_history (
  user_id        uuid not null default auth.uid(),
  uid            text not null,
  track_id       text not null,
  recommended_at bigint not null default 0,
  device_id      text,
  updated_at     bigint not null default 0,
  synced_at      timestamptz not null default now(),
  primary key (user_id, uid)
);

create table if not exists public.now_playing (
  user_id     uuid not null default auth.uid(),
  device_id   text not null,
  device_name text,
  track_id    text,
  source_id   text,
  title       text,
  artist      text,
  thumbnail   text,
  duration_ms bigint not null default 0,
  position_ms bigint not null default 0,
  playing     smallint not null default 0,
  updated_at  bigint not null default 0,
  deleted     smallint not null default 0,
  synced_at   timestamptz not null default now(),
  primary key (user_id, device_id)
);

create table if not exists public.blocked_artists (
  user_id    uuid not null default auth.uid(),
  artist     text not null,
  created_at bigint not null default 0,
  updated_at bigint not null default 0,
  deleted    smallint not null default 0,
  device_id  text,
  synced_at  timestamptz not null default now(),
  primary key (user_id, artist)
);

-- ── synced_at trigger'ı (sunucu saati) ────────────────────────────────────

create or replace function public.touch_synced_at()
returns trigger
language plpgsql
as $$
begin
  new.synced_at = now();
  return new;
end;
$$;

do $$
declare tbl text;
begin
  foreach tbl in array array[
    'tracks','playlists','playlist_tracks',
    'votes','play_history','recommendation_history','now_playing',
    'blocked_artists'
  ] loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$I', tbl);
    execute format(
      'create trigger trg_touch_%1$s before insert or update on public.%1$I
       for each row execute function public.touch_synced_at()', tbl);
  end loop;
end $$;

-- ── Pull sorgusu indeksleri (user_id + synced_at) ─────────────────────────

create index if not exists idx_tracks_sync   on public.tracks(user_id, synced_at);
create index if not exists idx_pl_sync       on public.playlists(user_id, synced_at);
create index if not exists idx_pt_sync       on public.playlist_tracks(user_id, synced_at);
create index if not exists idx_votes_sync    on public.votes(user_id, synced_at);
create index if not exists idx_hist_sync     on public.play_history(user_id, synced_at);
create index if not exists idx_rechist_sync  on public.recommendation_history(user_id, synced_at);
create index if not exists idx_np_sync       on public.now_playing(user_id, synced_at);
create index if not exists idx_blocked_sync  on public.blocked_artists(user_id, synced_at);

-- ── RLS: herkes yalnız KENDİ satırını görür/yazar ─────────────────────────

do $$
declare tbl text;
begin
  foreach tbl in array array[
    'tracks','playlists','playlist_tracks',
    'votes','play_history','recommendation_history','now_playing',
    'blocked_artists'
  ] loop
    execute format('alter table public.%I enable row level security', tbl);

    execute format('drop policy if exists p_select on public.%I', tbl);
    execute format('drop policy if exists p_insert on public.%I', tbl);
    execute format('drop policy if exists p_update on public.%I', tbl);
    execute format('drop policy if exists p_delete on public.%I', tbl);

    execute format(
      'create policy p_select on public.%I for select
       using (user_id = auth.uid())', tbl);
    execute format(
      'create policy p_insert on public.%I for insert
       with check (user_id = auth.uid())', tbl);
    execute format(
      'create policy p_update on public.%I for update
       using (user_id = auth.uid()) with check (user_id = auth.uid())', tbl);
    execute format(
      'create policy p_delete on public.%I for delete
       using (user_id = auth.uid())', tbl);
  end loop;
end $$;

-- ── Realtime (canlı senkron) ──────────────────────────────────────────────
-- Bu olmadan diğer cihazın değişikliği ANINDA gelmez; yalnız periyodik
-- (5 dk) ve odaklanma tetikleriyle gelir.

do $$
declare tbl text;
begin
  foreach tbl in array array[
    'tracks','playlists','playlist_tracks',
    'votes','play_history','recommendation_history','now_playing',
    'blocked_artists'
  ] loop
    -- Zaten ekliyse hata verir; yoksay.
    begin
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
