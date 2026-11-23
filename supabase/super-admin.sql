-- Étape 4 : super administrateur. Il est toujours admin, et personne ne peut lui retirer ce rôle depuis le site.
-- Le drapeau is_super_admin ne se change qu'ici, dans Supabase.
alter table public.profiles add column if not exists is_super_admin boolean not null default false;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin or is_super_admin from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_super_admin from public.profiles where id = auth.uid()), false)
$$;
grant execute on function public.is_super_admin() to anon, authenticated;

-- Tout admin peut nommer un admin ; seul le super admin peut en retirer un ; personne ne touche au super admin.
create or replace function public.set_admin(target uuid, value boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs';
  end if;
  if (select is_super_admin from public.profiles where id = target) then
    raise exception 'Le super admin ne peut pas être modifié';
  end if;
  if not value and not public.is_super_admin() then
    raise exception 'Seul le super admin peut retirer un admin';
  end if;
  update public.profiles set is_admin = value where id = target;
end $$;
revoke execute on function public.set_admin(uuid, boolean) from public, anon;
grant execute on function public.set_admin(uuid, boolean) to authenticated;

update public.profiles set is_super_admin = true, is_admin = true where lower(username) = lower('Gladuro');
