-- Base de données du site quizz (comptes, listes perso, scores, défis).
-- À coller une seule fois dans Supabase : SQL Editor → New query → Run.
-- Le script peut être relancé sans danger.

-- ============ Profils (nom d'utilisateur) ============
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_.-]{3,20}$'),
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_username_key on public.profiles (lower(username));
alter table public.profiles enable row level security;
drop policy if exists "profils lisibles" on public.profiles;
create policy "profils lisibles" on public.profiles for select using (true);

-- Création automatique du profil à l'inscription.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username) values (new.id, new.raw_user_meta_data ->> 'username');
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ Listes personnelles (privées) ============
create table if not exists public.user_lists (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.user_lists enable row level security;
drop policy if exists "mes listes" on public.user_lists;
create policy "mes listes" on public.user_lists for all
  using (owner = auth.uid()) with check (owner = auth.uid());

-- ============ Défis (mêmes questions pour tous) ============
create table if not exists public.challenges (
  id text primary key default substr(md5(random()::text || clock_timestamp()::text), 1, 8),
  creator uuid not null default auth.uid() references public.profiles on delete cascade,
  title text not null,
  list_id text not null,
  list_snapshot jsonb,
  config jsonb not null,
  questions jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.challenges enable row level security;
drop policy if exists "défis lisibles" on public.challenges;
create policy "défis lisibles" on public.challenges for select using (true);
drop policy if exists "créer un défi" on public.challenges;
create policy "créer un défi" on public.challenges for insert with check (creator = auth.uid());
drop policy if exists "supprimer mon défi" on public.challenges;
create policy "supprimer mon défi" on public.challenges for delete using (creator = auth.uid());

-- ============ Scores ============
create table if not exists public.scores (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  list_id text not null,
  list_title text not null,
  mode text,
  exercise text,
  score int not null,
  total int not null,
  seconds int,
  challenge_id text references public.challenges on delete cascade,
  created_at timestamptz not null default now(),
  check (total > 0 and score between 0 and total)
);
-- Une seule tentative par défi et par joueur.
create unique index if not exists scores_one_try_per_challenge on public.scores (user_id, challenge_id) where challenge_id is not null;
alter table public.scores enable row level security;
drop policy if exists "scores lisibles" on public.scores;
create policy "scores lisibles" on public.scores for select using (true);
drop policy if exists "ajouter mes scores" on public.scores;
create policy "ajouter mes scores" on public.scores for insert with check (user_id = auth.uid());

-- ============ Classements ============
create or replace view public.leaderboard with (security_invoker = on) as
  select p.username, sum(s.score)::int as points, count(*)::int as sessions,
         round(100.0 * sum(s.score) / sum(s.total))::int as pct, max(s.created_at) as last_at
  from public.scores s join public.profiles p on p.id = s.user_id
  group by p.username;

create or replace view public.list_leaderboard with (security_invoker = on) as
  select s.list_id, max(s.list_title) as list_title, p.username,
         sum(s.score)::int as points, count(*)::int as sessions,
         max(round(100.0 * s.score / s.total))::int as best_pct,
         round(100.0 * sum(s.score) / sum(s.total))::int as pct
  from public.scores s join public.profiles p on p.id = s.user_id
  where s.challenge_id is null
  group by s.list_id, p.username;

-- ============ Droits d'accès par l'API ============
grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.scores, public.challenges, public.leaderboard, public.list_leaderboard to anon, authenticated;
grant insert, delete on public.challenges to authenticated;
grant insert on public.scores to authenticated;
grant select, insert, update, delete on public.user_lists to authenticated;
