-- =====================================================================
-- Gestion Station MOBIL Boulouparis (SARL STATION PPAP BOULOUPARIS)
-- Base de données et règles de sécurité (Supabase). Peut être relancé.
--
-- Rôles :
--   gerant     : tout
--   comptable  : comptabilité, fournisseurs, caisse, carburant, planning.
--                Pas les fiches salariés ni les comptes utilisateurs.
--   caissier   : dépose des factures (à valider) et des décomptes de caisse
--                (brouillon), saisit les relevés de cuves, lit le planning.
--   desactive  : rien
-- Montants en francs CFP entiers.
-- =====================================================================

create table if not exists public.profiles (
  id       uuid primary key references auth.users(id) on delete cascade,
  nom      text,
  email    text,
  role     text not null default 'desactive' check (role in ('gerant','comptable','caissier','desactive')),
  cree_le  timestamptz default now()
);

create or replace function public.mon_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select role from profiles where id = auth.uid()), 'aucun')
$$;
create or replace function public.est_gerant() returns boolean language sql stable security definer set search_path = public as $$ select public.mon_role() = 'gerant' $$;
create or replace function public.est_compta() returns boolean language sql stable security definer set search_path = public as $$ select public.mon_role() in ('gerant','comptable') $$;
create or replace function public.est_equipe() returns boolean language sql stable security definer set search_path = public as $$ select public.mon_role() in ('gerant','comptable','caissier') $$;

create or replace function public.base_initialisee() returns boolean
language sql stable security definer set search_path = public as $$ select exists (select 1 from profiles where role = 'gerant') $$;

create or replace function public.premier_gerant(p_nom text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  lock table profiles in exclusive mode;
  if exists (select 1 from profiles where role = 'gerant') then return false; end if;
  insert into profiles (id, nom, email, role)
    values (auth.uid(), p_nom, (select email from auth.users where id = auth.uid()), 'gerant')
    on conflict (id) do update set role = 'gerant', nom = excluded.nom;
  return true;
end $$;

-- ---------- Paramètres, plan comptable, tiers ----------
create table if not exists public.parametres (
  id    int primary key default 1 check (id = 1),
  data  jsonb not null default '{}'::jsonb
);

create table if not exists public.comptes (
  numero   text primary key check (numero ~ '^[0-9]{3,10}$'),
  libelle  text not null,
  actif    boolean not null default true
);

create table if not exists public.tiers (
  id         uuid primary key default gen_random_uuid(),
  nom        text not null unique,
  type       text not null default 'fournisseur' check (type in ('fournisseur','client','organisme','autre')),
  compte     text not null default '401000' references public.comptes(numero),
  categorie  text,
  delai_jours int default 30,
  actif      boolean not null default true,
  notes      text
);

-- ---------- Écritures comptables ----------
create table if not exists public.ecritures (
  id         uuid primary key default gen_random_uuid(),
  journal    text not null check (journal in ('CA','AC','BQ','OD','SA','AN','VT')),
  date       date not null,
  piece      text,
  libelle    text not null,
  source     text not null default 'od' check (source in ('caisse','facture','reglement','paie','od','an','tgc','import')),
  source_id  uuid,
  cree_par   uuid default auth.uid(),
  cree_le    timestamptz not null default now()
);
create index if not exists ecritures_date_idx on public.ecritures (date);

create table if not exists public.lignes (
  id           bigserial primary key,
  ecriture_id  uuid not null references public.ecritures(id) on delete cascade,
  compte       text not null references public.comptes(numero),
  tiers_id     uuid references public.tiers(id),
  libelle      text,
  debit        bigint not null default 0 check (debit >= 0),
  credit       bigint not null default 0 check (credit >= 0),
  lettrage     text
);
create index if not exists lignes_ecr_idx on public.lignes (ecriture_id);
create index if not exists lignes_compte_idx on public.lignes (compte);

create table if not exists public.periodes_closes (
  mois     text primary key check (mois ~ '^[0-9]{4}-[0-9]{2}$'),
  close_le timestamptz default now(),
  close_par uuid default auth.uid()
);

create or replace function public.periode_close(d date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from periodes_closes where mois = to_char(d, 'YYYY-MM'))
$$;

-- Vue de lecture : lignes avec l'en-tête de leur écriture
create or replace view public.v_lignes with (security_invoker = true) as
  select l.id, l.ecriture_id, e.journal, e.date, e.piece, e.libelle as ecriture_libelle, e.source,
         l.compte, l.tiers_id, coalesce(l.libelle, e.libelle) as libelle, l.debit, l.credit, l.lettrage
  from public.lignes l join public.ecritures e on e.id = l.ecriture_id;

-- ---------- Caisse EURODATA ----------
create table if not exists public.caisse_imports (
  id          uuid primary key default gen_random_uuid(),
  date_debut  date not null,
  date_fin    date not null,
  fichier     text,
  data        jsonb not null,
  total_ttc   bigint,
  ecart       bigint,
  statut      text not null default 'brouillon' check (statut in ('brouillon','comptabilise')),
  ecriture_id uuid references public.ecritures(id) on delete set null,
  cree_par    uuid default auth.uid(),
  cree_le     timestamptz not null default now(),
  unique (date_debut, date_fin)
);

-- ---------- Factures fournisseurs et règlements ----------
create table if not exists public.factures (
  id            uuid primary key default gen_random_uuid(),
  tiers_id      uuid not null references public.tiers(id),
  numero        text,
  date_facture  date not null,
  echeance      date,
  categorie     text,
  libelle       text,
  montant_ttc   bigint not null,
  ventilation   jsonb not null default '[]'::jsonb,  -- [{compte, taux, ht, tgc}]
  statut        text not null default 'a_valider' check (statut in ('a_valider','comptabilisee')),
  regle         bigint not null default 0,
  fichier       text,
  historique    boolean not null default false,       -- reprise du fichier Excel, hors comptabilité
  ecriture_id   uuid references public.ecritures(id) on delete set null,
  cree_par      uuid default auth.uid(),
  cree_le       timestamptz not null default now()
);
create index if not exists factures_tiers_idx on public.factures (tiers_id);

create table if not exists public.reglements (
  id           uuid primary key default gen_random_uuid(),
  tiers_id     uuid not null references public.tiers(id),
  date         date not null,
  mode         text not null,
  compte_tresorerie text not null default '512000' references public.comptes(numero),
  montant      bigint not null check (montant > 0),
  reference    text,
  factures     uuid[] not null default '{}',
  historique   boolean not null default false,
  ecriture_id  uuid references public.ecritures(id) on delete set null,
  cree_le      timestamptz not null default now()
);

-- ---------- Carburant : relevés de cuves et livraisons ----------
create table if not exists public.cuves (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  produit     text not null check (produit in ('GAZOLE','SANS PLOMB')),
  jauge       numeric,          -- litres mesurés en fin de journée
  livraison   numeric default 0, -- litres livrés ce jour
  note        text,
  cree_par    uuid default auth.uid(),
  unique (date, produit)
);

-- ---------- Personnel ----------
create table if not exists public.salaries (
  id     uuid primary key default gen_random_uuid(),
  nom    text not null,
  prenom text,
  poste  text,
  actif  boolean not null default true
);
-- Données de paie et de contrat : gérant uniquement
create table if not exists public.salaries_prive (
  id   uuid primary key references public.salaries(id) on delete cascade,
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.plannings (
  semaine text primary key check (semaine ~ '^[0-9]{4}-W[0-9]{2}$'),
  data    jsonb not null default '{}'::jsonb,
  maj_le  timestamptz default now()
);

create table if not exists public.paies (
  mois   text primary key check (mois ~ '^[0-9]{4}-[0-9]{2}$'),
  data   jsonb not null default '{}'::jsonb,
  ecriture_id uuid references public.ecritures(id) on delete set null
);

-- =====================================================================
-- Passer une écriture (seul moyen d'écrire en comptabilité)
-- p = {journal, date, piece, libelle, source, source_id, lignes:[{compte, tiers_id, libelle, debit, credit}]}
-- =====================================================================
create or replace function public.passer_ecriture(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_date date := (p->>'date')::date; v_d bigint; v_c bigint; v_n int;
  v_src text := coalesce(p->>'source','od'); v_sid uuid := nullif(p->>'source_id','')::uuid;
begin
  if not public.est_compta() then raise exception 'Accès refusé' using errcode = '42501'; end if;
  if v_date is null then raise exception 'Date manquante'; end if;
  if public.periode_close(v_date) then raise exception 'La période % est clôturée', to_char(v_date,'MM/YYYY'); end if;
  select count(*), coalesce(sum((l->>'debit')::bigint),0), coalesce(sum((l->>'credit')::bigint),0)
    into v_n, v_d, v_c from jsonb_array_elements(p->'lignes') l
    where coalesce((l->>'debit')::bigint,0) <> 0 or coalesce((l->>'credit')::bigint,0) <> 0;
  if v_n < 2 then raise exception 'Une écriture doit avoir au moins deux lignes'; end if;
  if v_d <> v_c then raise exception 'Écriture déséquilibrée : débit % / crédit %', v_d, v_c; end if;
  if v_sid is not null and exists (select 1 from ecritures where source = v_src and source_id = v_sid) then
    raise exception 'Cette pièce est déjà comptabilisée';
  end if;

  insert into ecritures (journal, date, piece, libelle, source, source_id)
    values (p->>'journal', v_date, p->>'piece', p->>'libelle', v_src, v_sid) returning id into v_id;
  insert into lignes (ecriture_id, compte, tiers_id, libelle, debit, credit)
    select v_id, l->>'compte', nullif(l->>'tiers_id','')::uuid, nullif(l->>'libelle',''),
           coalesce((l->>'debit')::bigint,0), coalesce((l->>'credit')::bigint,0)
    from jsonb_array_elements(p->'lignes') l
    where coalesce((l->>'debit')::bigint,0) <> 0 or coalesce((l->>'credit')::bigint,0) <> 0;

  if v_sid is not null then
    if v_src = 'caisse' then update caisse_imports set ecriture_id = v_id, statut = 'comptabilise' where id = v_sid;
    elsif v_src = 'facture' then update factures set ecriture_id = v_id, statut = 'comptabilisee' where id = v_sid;
    elsif v_src = 'reglement' then update reglements set ecriture_id = v_id where id = v_sid;
    end if;
  end if;
  return v_id;
end $$;

create or replace function public.supprimer_ecriture(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_date date; v_src text; v_sid uuid;
begin
  if not public.est_compta() then raise exception 'Accès refusé' using errcode = '42501'; end if;
  select date, source, source_id into v_date, v_src, v_sid from ecritures where id = p_id;
  if v_date is null then raise exception 'Écriture introuvable'; end if;
  if public.periode_close(v_date) then raise exception 'La période % est clôturée', to_char(v_date,'MM/YYYY'); end if;
  if v_src = 'caisse' then update caisse_imports set statut = 'brouillon', ecriture_id = null where id = v_sid;
  elsif v_src = 'facture' then update factures set statut = 'a_valider', ecriture_id = null where id = v_sid;
  end if;
  delete from ecritures where id = p_id;
end $$;

-- Les écritures ne se modifient pas directement : passer_ecriture / supprimer_ecriture
create or replace function public.lignes_lettrer(p_ids bigint[], p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.est_compta() then raise exception 'Accès refusé' using errcode = '42501'; end if;
  if p_code is not null and (select coalesce(sum(debit - credit),0) from lignes where id = any(p_ids)) <> 0 then
    raise exception 'Lettrage impossible : les lignes ne sont pas soldées';
  end if;
  update lignes set lettrage = p_code where id = any(p_ids);
end $$;

-- Droits sur les fonctions
revoke all on function public.premier_gerant(text), public.passer_ecriture(jsonb), public.supprimer_ecriture(uuid),
  public.lignes_lettrer(bigint[], text) from public, anon;
grant execute on function public.premier_gerant(text), public.passer_ecriture(jsonb), public.supprimer_ecriture(uuid),
  public.lignes_lettrer(bigint[], text) to authenticated;
grant execute on function public.base_initialisee() to anon, authenticated;
revoke execute on function public.mon_role(), public.est_gerant(), public.est_compta(), public.est_equipe(),
  public.periode_close(date) from public, anon;
grant execute on function public.mon_role(), public.est_gerant(), public.est_compta(), public.est_equipe(),
  public.periode_close(date) to authenticated;

-- =====================================================================
-- Règles d'accès (RLS)
-- =====================================================================
do $$ declare t text; begin
  foreach t in array array['profiles','parametres','comptes','tiers','ecritures','lignes','periodes_closes',
    'caisse_imports','factures','reglements','cuves','salaries','salaries_prive','plannings','paies'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Supprime les anciennes règles pour pouvoir relancer le script
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Profils
create policy p_lecture on public.profiles for select to authenticated using (id = auth.uid() or public.est_gerant());
create policy p_creation on public.profiles for insert to authenticated with check (public.est_gerant());
create policy p_modif on public.profiles for update to authenticated
  using (public.est_gerant()) with check (public.est_gerant() and (id <> auth.uid() or role = 'gerant'));
create policy p_suppr on public.profiles for delete to authenticated using (public.est_gerant() and id <> auth.uid());

-- Paramètres, plan comptable, tiers : lecture équipe, écriture compta
create policy par_l on public.parametres for select to authenticated using (public.est_equipe());
create policy par_e on public.parametres for all to authenticated using (public.est_compta()) with check (public.est_compta());
create policy cpt_l on public.comptes for select to authenticated using (public.est_equipe());
create policy cpt_e on public.comptes for all to authenticated using (public.est_compta()) with check (public.est_compta());
create policy tie_l on public.tiers for select to authenticated using (public.est_equipe());
create policy tie_e on public.tiers for all to authenticated using (public.est_compta()) with check (public.est_compta());

-- Comptabilité : lecture compta ; écriture uniquement via les fonctions
create policy ecr_l on public.ecritures for select to authenticated using (public.est_compta());
create policy lig_l on public.lignes for select to authenticated using (public.est_compta());
create policy per_l on public.periodes_closes for select to authenticated using (public.est_equipe());
create policy per_i on public.periodes_closes for insert to authenticated with check (public.est_compta());
create policy per_d on public.periodes_closes for delete to authenticated using (public.est_gerant());

-- Caisse : la caisse dépose des brouillons, la compta fait le reste
create policy cai_l on public.caisse_imports for select to authenticated using (public.est_equipe());
create policy cai_i on public.caisse_imports for insert to authenticated
  with check (public.est_compta() or (public.mon_role() = 'caissier' and statut = 'brouillon' and ecriture_id is null));
create policy cai_u on public.caisse_imports for update to authenticated
  using (public.est_compta() or (public.mon_role() = 'caissier' and statut = 'brouillon'))
  with check (public.est_compta() or (public.mon_role() = 'caissier' and statut = 'brouillon' and ecriture_id is null));
create policy cai_d on public.caisse_imports for delete to authenticated using (public.est_compta() and statut = 'brouillon');

-- Factures : la caisse dépose (à valider) et voit ce qu'elle a déposé
create policy fac_l on public.factures for select to authenticated using (public.est_compta() or (public.mon_role() = 'caissier' and cree_par = auth.uid()));
create policy fac_i on public.factures for insert to authenticated
  with check (public.est_compta() or (public.mon_role() = 'caissier' and statut = 'a_valider' and ecriture_id is null and not historique));
create policy fac_u on public.factures for update to authenticated using (public.est_compta()) with check (public.est_compta());
create policy fac_d on public.factures for delete to authenticated using (public.est_compta() and ecriture_id is null);

create policy reg_l on public.reglements for select to authenticated using (public.est_compta());
create policy reg_e on public.reglements for all to authenticated using (public.est_compta()) with check (public.est_compta());

-- Cuves : toute l'équipe saisit
create policy cuv_l on public.cuves for select to authenticated using (public.est_equipe());
create policy cuv_e on public.cuves for all to authenticated using (public.est_equipe()) with check (public.est_equipe());

-- Personnel : fiches réservées au gérant ; planning lu par l'équipe, écrit par la compta
create policy sal_l on public.salaries for select to authenticated using (public.est_equipe());
create policy sal_e on public.salaries for all to authenticated using (public.est_gerant()) with check (public.est_gerant());
create policy sp_e on public.salaries_prive for all to authenticated using (public.est_gerant()) with check (public.est_gerant());
create policy pla_l on public.plannings for select to authenticated using (public.est_equipe());
create policy pla_e on public.plannings for all to authenticated using (public.est_compta()) with check (public.est_compta());
create policy pai_l on public.paies for select to authenticated using (public.est_gerant());
create policy pai_e on public.paies for all to authenticated using (public.est_gerant()) with check (public.est_gerant());

grant select on public.v_lignes to authenticated;

-- ---------- Stockage des pièces (factures scannées) ----------
insert into storage.buckets (id, name, public) values ('pieces', 'pieces', false) on conflict (id) do nothing;
drop policy if exists pieces_l on storage.objects;
drop policy if exists pieces_i on storage.objects;
drop policy if exists pieces_d on storage.objects;
create policy pieces_l on storage.objects for select to authenticated using (bucket_id = 'pieces' and (public.est_compta() or owner = auth.uid()));
create policy pieces_i on storage.objects for insert to authenticated with check (bucket_id = 'pieces' and public.est_equipe());
create policy pieces_d on storage.objects for delete to authenticated using (bucket_id = 'pieces' and public.est_compta());

-- =====================================================================
-- Plan comptable de départ (complété automatiquement par les imports)
-- =====================================================================
insert into public.comptes (numero, libelle) values
 ('101000','Capital'),('106800','Autres réserves'),('110000','Report à nouveau'),('120000','Résultat de l''exercice'),
 ('164000','Emprunts auprès des établissements de crédit'),('455000','Associés - comptes courants'),
 ('213500','Installations générales, agencements'),('215400','Matériel et outillage'),('218300','Matériel de bureau et informatique'),
 ('281350','Amortissements agencements'),('281540','Amortissements matériel'),
 ('370000','Stock de marchandises'),
 ('401000','Fournisseurs'),('408000','Fournisseurs - factures non parvenues'),('411000','Clients - crédits locaux'),('411100','Clients - paiements suspendus'),
 ('421000','Personnel - rémunérations dues'),('425000','Personnel - avances et acomptes'),('431000','CAFAT'),('437000','Autres organismes sociaux (retraite, mutuelle)'),
 ('445510','TGC à décaisser'),('445661','TGC déductible 3 %'),('445662','TGC déductible 6 %'),('445663','TGC déductible 11 %'),('445664','TGC déductible 22 %'),
 ('445711','TGC collectée 3 %'),('445712','TGC collectée 6 %'),('445713','TGC collectée 11 %'),('445714','TGC collectée 22 %'),
 ('447000','Autres impôts et taxes'),('467000','Autres débiteurs et créditeurs'),('471000','Compte d''attente'),
 ('512000','Banque BNC'),('531000','Caisse'),('531101','Caisse - espèces'),('531201','Chèques à remettre'),
 ('531401','Cartes AMEX à encaisser'),('531402','Cartes VISA à encaisser'),('531403','Cartes Mastercard à encaisser'),
 ('531404','Cartes MOBIL à encaisser'),('531406','Cartes JADE à encaisser'),('531501','Bons d''achat'),('531502','Bons d''achat Conso Plus'),
 ('531506','Virements à recevoir'),('580000','Virements internes'),
 ('603700','Variation des stocks de marchandises'),
 ('607100','Achats boutique'),('607200','Achats tabacs'),('607300','Achats snacking'),('607400','Achats carburants'),('607500','Achats lubrifiants'),
 ('607600','Achats gaz'),('607700','Achats recharges et cartes (Carte Liberté)'),
 ('606100','Électricité, eau'),('606300','Petit équipement, fournitures'),('606400','Fournitures administratives'),
 ('613200','Locations immobilières'),('613500','Locations mobilières'),('615000','Entretien et réparations'),('615500','Travaux'),('616000','Assurances'),
 ('622600','Honoraires'),('623000','Publicité'),('624000','Transports'),('625000','Déplacements, réceptions'),('626000','Télécommunications'),
 ('627000','Frais bancaires'),('628000','Frais divers'),('635000','Impôts et taxes'),
 ('641000','Salaires bruts'),('645100','Cotisations CAFAT patronales'),('645300','Cotisations retraite et prévoyance patronales'),('647000','Autres charges sociales'),
 ('658000','Différences de caisse'),('661000','Intérêts des emprunts'),('681100','Dotations aux amortissements'),
 ('707000','Ventes de marchandises'),('758000','Produits divers de gestion'),('758100','Différences de caisse positives'),('999999','Autres recettes de caisse (à affecter)')
on conflict (numero) do nothing;

insert into public.parametres (id, data) values (1, jsonb_build_object(
  'societe', 'SARL STATION PPAP BOULOUPARIS',
  'enseigne', 'MOBIL BOULOUPARIS',
  'adresse', 'Lot 10, Les Haras de Boulouparis, Complexe Mercier, 98812 Boulouparis',
  'debut_compta', '2026-01-01',
  'compte_autres_recettes', '758000',
  'categories', jsonb_build_object(
    'BOUTIQUE','607100','TABACS','607200','SNACKING','607300','CARBURANT','607400','LUBRIFIANT','607500','GAZ','607600',
    'CARTE LIBERTE','607700','FRAIS GENERAUX','606300','ENTRETIEN','615000','TRAVAUX','615500','FRAIS ANNEXE','628000',
    'CHARGES SOCIALES','645100','CHARGES PATRONALES','645100','ELECTRICITE','606100','TELEPHONE','626000','LOYER','613200',
    'ASSURANCE','616000','HONORAIRES','622600','BANQUE','627000','IMPOTS','635000','TRANSPORT','624000'),
  'modes', jsonb_build_object('VIREMENT','512000','CHEQUE','512000','PRELEVEMENT','512000','CB','512000','ESPECES','531101','RETOUR DE FONDS','531101')
)) on conflict (id) do nothing;

-- Temps réel
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='caisse_imports') then
      alter publication supabase_realtime add table public.caisse_imports, public.factures, public.ecritures, public.plannings, public.cuves;
    end if;
  end if;
end $$;
