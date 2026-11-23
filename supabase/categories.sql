-- Étape 5 : catégories (et sous-catégories) pour ranger les listes publiques.
-- Lecture pour tous, écriture réservée aux administrateurs. Peut être relancé sans danger.
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 60),
  parent uuid references public.categories on delete set null,
  position int not null default 0,
  created_at timestamptz not null default now(),
  check (parent is distinct from id)
);
alter table public.categories enable row level security;
drop policy if exists "catégories lisibles" on public.categories;
create policy "catégories lisibles" on public.categories for select using (true);
drop policy if exists "admin écrit les catégories" on public.categories;
create policy "admin écrit les catégories" on public.categories for all
  using (public.is_admin()) with check (public.is_admin());

-- Rangement des listes publiques (du dépôt ou publiées en ligne) dans une catégorie.
create table if not exists public.list_categories (
  list_id text primary key,
  category_id uuid not null references public.categories on delete cascade
);
alter table public.list_categories enable row level security;
drop policy if exists "rangement lisible" on public.list_categories;
create policy "rangement lisible" on public.list_categories for select using (true);
drop policy if exists "admin range les listes" on public.list_categories;
create policy "admin range les listes" on public.list_categories for all
  using (public.is_admin()) with check (public.is_admin());

grant select on public.categories, public.list_categories to anon, authenticated;
grant insert, update, delete on public.categories, public.list_categories to authenticated;
