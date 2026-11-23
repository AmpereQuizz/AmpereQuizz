-- Étape 3 : gestion des administrateurs depuis l'onglet « Admin » du site.
-- Seul un administrateur peut donner ou retirer le rôle, et le dernier administrateur ne peut pas être retiré.
create or replace function public.set_admin(target uuid, value boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs';
  end if;
  if not value and (select count(*) from public.profiles where is_admin and id <> target) = 0 then
    raise exception 'Impossible de retirer le dernier administrateur';
  end if;
  update public.profiles set is_admin = value where id = target;
end $$;
revoke execute on function public.set_admin(uuid, boolean) from public, anon;
grant execute on function public.set_admin(uuid, boolean) to authenticated;
