# Gestion Station MOBIL Boulouparis

Outil de gestion de la SARL STATION PPAP BOULOUPARIS : caisse EURODATA, fournisseurs, carburant, planning et paie, comptabilité complète (journaux, grand livre, balance, résultat, bilan, TGC, export FEC).

- **Site** : fichiers à la racine de ce dépôt, publiés par GitHub Pages.
- **Base de données et comptes** : Supabase, projet `station-boulouparis` (Sydney).
- **Sécurité** : `supabase/schema.sql`. Les règles d'accès sont appliquées par la base elle-même. Une écriture comptable ne peut être passée qu'équilibrée, et jamais dans un mois clôturé.

Aucune donnée n'est stockée dans ce dépôt.

## Mise en route (une seule fois)

1. **Supabase, onglet Authentication, puis Sign In / Providers, puis Email** : désactivez **Confirm email**. Laissez **Allow new users to sign up** activé. Le site s'en sert pour créer les comptes, et un compte sans rôle n'a accès à rien.
2. **GitHub, onglet Settings, puis Pages** : choisissez *Deploy from a branch*, branche `main`, dossier `/ (root)`. L'adresse du site s'affiche au bout d'une à deux minutes.
3. **Supabase, onglet Authentication, puis URL Configuration** : collez cette adresse dans **Site URL**.
4. Ouvrez le site **tout de suite** et créez le compte du gérant : le premier compte créé reçoit tous les droits.

## Premiers pas

1. **Paramètres, onglet Société** : réglez la date de début de la comptabilité dans l'outil, par exemple le 1er janvier 2027.
2. **Comptabilité, onglet Saisie, journal AN** : saisissez le bilan d'ouverture remis par l'expert-comptable. Le bouton « ajouter les soldes fournisseurs non réglés » détaille le compte 401.
3. **Fournisseurs, onglet Reprise Excel** : importez le fichier « Règlement fournisseurs » (onglet RECAP PAIEMENTS).
4. **Caisse** : importez chaque jour le « Décompte de caisse cumulé » exporté d'EURODATA au format Excel, puis cliquez sur « Comptabiliser ».

## Rôles

| Rôle | Accès |
|---|---|
| Gérant | Tout, y compris les salariés, la paie, les utilisateurs et la réouverture d'un mois clôturé. |
| Comptable | Comptabilité, fournisseurs, caisse, carburant, planning. Ne voit ni les fiches salariés ni la paie. |
| Caisse | Importe les décomptes, dépose les factures en photo (elles restent « à valider »), saisit les jauges, consulte le planning. |
| Désactivé | Rien. À appliquer le jour d'un départ. |

## Comptes utilisés automatiquement

- Ventes : comptes 707xxx fournis par EURODATA. TGC collectée : 445711 (3 %), 445712 (6 %), 445713 (11 %), 445714 (22 %).
- Encaissements : comptes 531xxx d'EURODATA (espèces, chèques, cartes). Les remises en banque les soldent vers le 512000.
- Écart de caisse : 658000 pour un manque, 758100 pour un excédent.
- Achats : comptes 607xxx et 6xxxxx par catégorie (modifiables dans Paramètres). TGC déductible : 445661 à 445664. Fournisseurs : 401000.
- Paie : 641000, 645100 et 645300, contre 421000, 425000, 431000 et 437000.

## Fichiers

`index.html` (mise en page), `app.js` (écrans), `compta.js` (moteur comptable et lecture des fichiers EURODATA), `db.js` (accès à Supabase), `supabase-config.js` (adresse du projet, sans secret), `supabase/schema.sql` (base et sécurité).
