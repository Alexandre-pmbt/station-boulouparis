-- =====================================================================
-- Migration 2 : rôle expert-comptable (lecture seule), factures déposées
-- « à saisir », documents divers, fichiers EURODATA conservés.
-- Peut être relancée.
-- =====================================================================

-- Rôle expert-comptable
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('gerant','comptable','caissier','expert','desactive'));

create or replace function public.est_lecteur() returns boolean
language sql stable security definer set search_path = public as $$ select public.mon_role() in ('gerant','comptable','expert') $$;
revoke execute on function public.est_lecteur() from public, anon;
grant execute on function public.est_lecteur() to authenticated;
create or replace function public.est_equipe() returns boolean
language sql stable security definer set search_path = public as $$ select public.mon_role() in ('gerant','comptable','caissier','expert') $$;

-- Factures déposées sans saisie (photo ou PDF seulement)
alter table public.factures alter column tiers_id drop not null;
alter table public.factures alter column montant_ttc set default 0;
alter table public.factures drop constraint if exists factures_statut_check;
alter table public.factures add constraint factures_statut_check check (statut in ('a_saisir','a_valider','comptabilisee'));
alter table public.factures drop constraint if exists factures_saisie_check;
alter table public.factures add constraint factures_saisie_check check (statut = 'a_saisir' or tiers_id is not null);

-- TGC habituelle d'un fournisseur (pré-remplit la ventilation)
alter table public.tiers add column if not exists taux_tgc int check (taux_tgc in (0,3,6,11,22));

-- Fichier EURODATA d'origine conservé
alter table public.caisse_imports add column if not exists chemin text;

-- Documents divers (relevés bancaires, déclarations, contrats…)
create table if not exists public.documents (
  id        uuid primary key default gen_random_uuid(),
  mois      text not null check (mois ~ '^[0-9]{4}-[0-9]{2}$'),
  type      text not null,
  libelle   text,
  fichier   text not null,
  cree_par  uuid default auth.uid(),
  cree_le   timestamptz not null default now()
);
alter table public.documents enable row level security;
revoke all on public.documents from anon;

-- Règles : l'expert lit la comptabilité, les factures, la caisse et les pièces ; il n'écrit rien
drop policy if exists ecr_l on public.ecritures;
create policy ecr_l on public.ecritures for select to authenticated using (public.est_lecteur());
drop policy if exists lig_l on public.lignes;
create policy lig_l on public.lignes for select to authenticated using (public.est_lecteur());
drop policy if exists reg_l on public.reglements;
create policy reg_l on public.reglements for select to authenticated using (public.est_lecteur());
drop policy if exists fac_l on public.factures;
create policy fac_l on public.factures for select to authenticated using (public.est_lecteur() or (public.mon_role() = 'caissier' and cree_par = auth.uid()));
drop policy if exists fac_i on public.factures;
create policy fac_i on public.factures for insert to authenticated
  with check (public.est_compta() or (public.mon_role() = 'caissier' and statut in ('a_saisir','a_valider') and ecriture_id is null and not historique));
-- La caisse, l'expert : lecture seule ailleurs (les règles d'écriture existantes exigent est_compta ou est_equipe)
drop policy if exists cuv_e on public.cuves;
create policy cuv_e on public.cuves for all to authenticated
  using (public.mon_role() in ('gerant','comptable','caissier')) with check (public.mon_role() in ('gerant','comptable','caissier'));
drop policy if exists cai_i on public.caisse_imports;
create policy cai_i on public.caisse_imports for insert to authenticated
  with check (public.est_compta() or (public.mon_role() = 'caissier' and statut = 'brouillon' and ecriture_id is null));
drop policy if exists pla_l on public.plannings;
create policy pla_l on public.plannings for select to authenticated using (public.mon_role() in ('gerant','comptable','caissier'));
drop policy if exists sal_l on public.salaries;
create policy sal_l on public.salaries for select to authenticated using (public.mon_role() in ('gerant','comptable','caissier'));

drop policy if exists doc_l on public.documents;
drop policy if exists doc_i on public.documents;
drop policy if exists doc_d on public.documents;
create policy doc_l on public.documents for select to authenticated using (public.est_lecteur());
create policy doc_i on public.documents for insert to authenticated with check (public.est_compta());
create policy doc_d on public.documents for delete to authenticated using (public.est_compta());

drop policy if exists pieces_l on storage.objects;
drop policy if exists pieces_i on storage.objects;
create policy pieces_l on storage.objects for select to authenticated using (bucket_id = 'pieces' and (public.est_lecteur() or owner = auth.uid()));
create policy pieces_i on storage.objects for insert to authenticated with check (bucket_id = 'pieces' and public.mon_role() in ('gerant','comptable','caissier'));
