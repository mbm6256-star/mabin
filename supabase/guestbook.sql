-- Supabase 대시보드 → SQL Editor에서 실행하세요.
-- 로그인 없는 공개 방명록: 누구나 글을 읽고 작성할 수 있습니다.
-- 기존 guestbook 테이블이 있다면 name/message/id/created_at 열 구조를 먼저 확인하세요.
begin;

create table if not exists public.guestbook (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  message text not null check (char_length(btrim(message)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists guestbook_created_at_id_idx
  on public.guestbook (created_at desc, id desc);

alter table public.guestbook enable row level security;

-- 공개 방문자는 읽기와 이름/내용 입력만 가능하며 수정·삭제할 수 없습니다.
revoke all on public.guestbook from anon, authenticated;
grant usage on schema public to anon;
grant select on public.guestbook to anon;
grant insert (name, message) on public.guestbook to anon;

drop policy if exists guestbook_public_read on public.guestbook;
create policy guestbook_public_read on public.guestbook
  for select to anon using (true);

drop policy if exists guestbook_public_insert on public.guestbook;
create policy guestbook_public_insert on public.guestbook
  for insert to anon with check (
    char_length(btrim(name)) between 1 and 40
    and char_length(btrim(message)) between 1 and 2000
  );

commit;
