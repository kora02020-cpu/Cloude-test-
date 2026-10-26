-- 今日のボード:Supabase のテーブル定義
-- Supabase の SQL Editor にこのファイルの中身を貼り付けて、Run で実行する。
-- 何度実行しても壊れないように書いてある。

create table if not exists public.records (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text        not null,              -- visit / order / expense / goal(将来:calendar など)
  id         text        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null,              -- 端末で記録した時刻(後勝ちの判定に使う)
  deleted    boolean     not null default false, -- 削除は印を付けて同期する
  server_at  timestamptz not null default now(),-- サーバーに届いた時刻(差分取得に使う)
  primary key (user_id, kind, id)
);

create index if not exists records_user_server_at on public.records (user_id, server_at);

-- 行単位のアクセス制限:自分の行だけ読み書きできる
alter table public.records enable row level security;

drop policy if exists "records_select_own" on public.records;
create policy "records_select_own" on public.records
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "records_insert_own" on public.records;
create policy "records_insert_own" on public.records
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "records_update_own" on public.records;
create policy "records_update_own" on public.records
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update on public.records to authenticated;

-- 後勝ち:サーバーにある方が新しければ上書きしない。届いた時刻を記録する
create or replace function public.records_lww()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  new.server_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists records_lww on public.records;
create trigger records_lww
  before insert or update on public.records
  for each row execute function public.records_lww();
