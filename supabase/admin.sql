-- Étape 2 : administrateur et listes publiques modifiables depuis le site.
-- À coller dans Supabase : SQL Editor → New query → Run. Peut être relancé sans danger.

-- Drapeau administrateur : modifiable seulement ici, dans Supabase (aucune règle ne permet de le changer depuis le site).
alter table public.profiles add column if not exists is_admin boolean not null default false;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- Listes publiques (visibles par tous) ; seuls les administrateurs peuvent les écrire.
-- Une ligne avec hidden = true masque une liste du dépôt GitHub du même identifiant.
create table if not exists public.public_lists (
  id text primary key check (id ~ '^[a-z0-9-]{1,60}$'),
  title text not null,
  data jsonb,
  hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references public.profiles on delete set null
);
alter table public.public_lists enable row level security;
drop policy if exists "listes publiques lisibles" on public.public_lists;
create policy "listes publiques lisibles" on public.public_lists for select using (true);
drop policy if exists "admin écrit les listes publiques" on public.public_lists;
create policy "admin écrit les listes publiques" on public.public_lists for all
  using (public.is_admin()) with check (public.is_admin());
grant select on public.public_lists to anon, authenticated;
grant insert, update, delete on public.public_lists to authenticated;
