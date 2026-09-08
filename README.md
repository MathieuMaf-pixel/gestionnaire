# Gestionnaire MAF — suivi des demandes, du CDC au plan validé

CRM maison du service commercial : chaque **demande** est suivie depuis la saisie du
cahier des charges par le commercial jusqu'au plan d'implantation validé par la
direction technique.

```
brouillon → envoyee → en_implantation → a_valider → validee → chiffree
  (com)      (com)        (impl)          (impl)      (dt)      (com)
                            ↑                │
                            └──── refusee ◄──┘   refus motivé de la DT
```

| Rôle | Interface | Ce qu'il fait |
|---|---|---|
| `com` Commercial | `/commercial/` | ses clients, ses demandes, saisie des CDC, envoi aux implantations, chiffrage |
| `impl` Implantation | `/implantation/` | reçoit les demandes, produit les indices de plan, envoie en validation |
| `dt` Direction technique | `/direction/` | valide ou refuse (motif obligatoire → retour implantation) |
| `admin` | `/admin/` | comptes & rôles, vue globale, boîte mail de test |

## Lancer en local (test)

1. Python 3 installé (cocher *Add to PATH*).
2. Double-cliquer **`run.bat`** (Windows) ou `./run.sh` (Linux/macOS).
3. Ouvrir <http://localhost:5000> — depuis un autre PC du réseau : `http://<IP-du-PC>:5000`.

Au premier lancement (base vide), le serveur charge le **jeu de démonstration** (`demo.py`) :
il est déterministe, donc **identique sur tous les PC** — vous partez tous de la même base.
Comptes (mot de passe = identifiant) : `admin` · `com1` · `com2` · `impl1` · `impl2` · `dt1`.
17 clients fictifs (15 dans le Sud-Ouest pour `com1`, géolocalisés, avec leur production ; 2 pour `com2`), 62 demandes
réparties sur 2023-2026 à tous les statuts, dont 14 pour « CLIENT A » étalées sur 4 ans (arborescence par année).

- **Remettre la base de test à zéro** : arrêter le serveur, double-cliquer `reset-demo.bat`.
- **Partager un état précis** (ex. après une séance de test à deux) : `python demo.py export data/export.json`,
  envoyer le fichier, et sur l'autre PC (serveur arrêté) `python demo.py import data/export.json`.
- Base vraiment vide (seul compte admin) : lancer avec `DEMO=0`.
- Rappel : la base (`data/`) n'est **pas** dans Git, volontairement. Pour tester le flux à deux en simultané,
  un seul serveur tourne et l'autre s'y connecte via `http://<IP>:5000`.

Les mails **ne sont pas envoyés** en test (`MAIL_MODE=file`) : ils sont écrits dans
`data/mails/` et visibles dans l'onglet « Boîte mail (test) » (implantation, admin).

## Organisation du dossier (travail à deux)

```
Gestionnaire/
├── server.py            noyau : API, rôles, machine à états, notifications   ← une seule personne
├── demo.py              jeu de démonstration déterministe · export/import de la base (reset-demo.bat)
├── db.py                schéma SQLite + accès base                            ← une seule personne
├── requirements.txt · run.bat · run.sh · Dockerfile · docker-compose.yml
├── data/                base gestionnaire.db, clé de session, mails/ (ne pas partager)
└── static/
    ├── common/          maf.css (charte), api.js (appels API, en-tête, notifs), demande.js (fiche commune), logo.png
    ├── login.html
    ├── commercial/      index.html + app.js + portefeuille.js + carte.js + commercial.css + vendor/  ─┐  (Leaflet,
    ├── implantation/    index.html + app.js                                                          │   fonds vectoriels, CSV/XLSX)
    ├── direction/       index.html + app.js    une interface = un dossier autonome,                   │
    ├── admin/           index.html + app.js    ne parle au serveur que par /api/…                    ─┘
    └── cdc/             precalibrage.html (page CDC d'origine, inchangée) + bridge.js (pont API)
                         emballage.html + emballage.js + emballage-catalogue.js (CDC Emballage par lignes)
```

Règle simple : chacun travaille dans **son** dossier d'interface et livre le dossier entier ;
`server.py` / `db.py` / `static/common/` ne sont modifiés que par une personne à la fois.
Avant de fusionner, zipper une version (`gestionnaire-v0.x.zip`).

## Intégrer une page CDC existante

Une page CDC autonome (comme `cdc-precalibrage_5.html`) s'intègre **sans la modifier** :
copier le fichier dans `static/cdc/<type>.html` et ajouter avant `</body>` :

```html
<script src="/cdc/bridge.js"></script>
```

`bridge.js` détecte `?demande=<id>` dans l'URL, charge/sauvegarde l'état `S` via
`GET/PUT /api/demandes/<id>/cdc/<type>`, préremplit la page « Général » depuis la demande
et transforme « Envoyer le CDC » en « Terminer le CDC » (retour sur la fiche).
Le type est déduit du nom de fichier (`precalibrage.html` → `precalibrage`) et doit exister
dans `CDC_TYPES` (server.py).

## CDC Emballage — logique par lignes

`static/cdc/emballage.html` reprend le design du CDC Précalibrage mais construit le projet :

- **Projet** : emballage neuf multi-lignes · ligne unique · modification de lignes existantes.
- **Palox & formats** : deux catalogues (fiche palox identique au préca ; fiche format = nom, type, L×l×h,
  poids net, colis/couche, couches, intercalaires, demi-palette, palettes utilisées, cornières, liens).
- **Vidage** (multi-lignes) : indépendant / mutualisé / mixte ; chaque groupe = type (DIR2, DIR3, Robobin,
  immersion…), lignes alimentées, **palox obligatoires**.
- **Lignes** : tête de ligne (cuve, élévateur, brosseuse, répartition), machines de conditionnement dans
  l'ordre du flux avec leurs accessoires, **formats de colis obligatoires**, notes partout.
- **Palettisation** : même logique de groupes que le vidage (palettiseur ± liaison cercleuse, roulades).
- **Schéma** : généré automatiquement (SVG), les ressources partagées enjambent les lignes ; inclus au PDF.

Le catalogue des machines / accessoires / vidages / palettisations est dans **`emballage-catalogue.js`** :
c'est le seul fichier à modifier pour enrichir les listes (ne jamais changer une clé `k` déjà utilisée).
Test automatisé : `tests/test_cdc_emballage.py`.

## Interface commerciale — carte des clients

`/commercial/` est organisée autour du **portefeuille du commercial** (`static/commercial/`, autonome) :

- **Portefeuille** (page d'accueil, `portefeuille.js`) : à gauche l'arbre *client → année → projet* (dérouler / sélectionner),
  au milieu les projets du niveau choisi en **tuiles** avec le processus en 6 étapes (1 CDC · 2 Envoyée · 3 Implantation ·
  4 Validation DT · 5 Plan validé · 6 Chiffrage) cochées au fil de l'avancement, refus en rouge, prochaine action et alertes
  (retour souhaité dépassé, sans mouvement) ; à droite la carte des clients synchronisée avec la sélection (clic marqueur = client).
  URL : `#/portefeuille?c=<client>&a=<année>&d=<demande>`.

- **À faire** : ce qui attend une action (CDC à finir, chiffrage à saisir, refus DT à traiter, envoyées sans
  nouvelle) — la « prochaine action » est déduite du statut et de l'âge de la demande, côté navigateur.
- **Carte** : carte Leaflet (fond vectoriel embarqué : 96 départements + pays voisins, aucun réseau requis ;
  bascule « Fond OSM » si le réseau le permet) + liste synchronisée. Un marqueur par client, silhouette du produit
  principal (issue de `varietes.json`), halo vert = demande en cours, orange = action à faire, rouge = retard.
  Filtres : recherche, département, produit, « avec demande / à faire ». KPI : clients, tonnage annuel, demandes, départements.
- **Fiche client** : coordonnées, contact, production par produit (t/an), mini-carte, demandes du client (ouvrir / créer).
- **Import** : CSV ou Excel (colonnes reconnues : nom, activité, adresse, cp, ville, pays, contact, tel, email, fruits,
  volumes, lat, lng, notes) avec aperçu ; géocodage optionnel des adresses (Nominatim, réseau).
- **Adresse en direct** (fiche client) : propositions pendant la saisie — France : géocodeur Géoplateforme / Base Adresse
  Nationale (sans clé), autres pays : Nominatim ; le choix remplit adresse, CP, ville, département et coordonnées.
- **Demandes** : kanban par statut ↔ tableau (bascule), même filtres.

Côté serveur (08/09/2026) la table `clients` gagne `adresse, cp, dept, lat, lng, tel, email, activite, fruits`
(JSON `[{"produit":"pommes","volume_t":1200}]`, clés = produits de `varietes.json`). Colonnes ajoutées par
`MIGRATIONS` dans `db.py` sur une base existante (ALTER TABLE, sans perte) ; `demo.py` renseigne ces champs.
`GET /api/demandes` renvoie en plus `client_id` et `cdc_complet`.

## API (résumé)

```
POST /api/login {username,password}         GET /api/me          POST /api/logout
GET  /api/config                             GET /api/notifications   POST /api/notifications/lu {ids}
GET  /api/clients        POST /api/clients   PUT /api/clients/<id>
GET  /api/demandes[?archive=1]  POST /api/demandes  GET|PUT /api/demandes/<id>
GET|PUT /api/demandes/<id>/cdc/<type>        {data, complet}
POST /api/demandes/<id>/envoyer              com   : CDC complet → implantations
POST /api/demandes/<id>/prendre              impl  : prise en charge
POST /api/demandes/<id>/plans {indice?,fichier,commentaire}   PUT …/plans/<pid>
POST /api/demandes/<id>/envoyer-validation {plan_id?,commentaire?}
POST /api/demandes/<id>/valider {note?}      dt
POST /api/demandes/<id>/refuser {note}       dt (motif obligatoire)
POST /api/demandes/<id>/devis {devis}        com
POST /api/demandes/<id>/archiver             POST /api/demandes/<id>/commentaire {texte}
GET  /api/users  POST /api/users  PUT /api/users/<u>   (admin)      GET /api/mails
```

## Déploiement (service informatique)

- `docker compose up -d` : un seul conteneur, base SQLite dans le volume `gestionnaire-data`.
- Variables d'environnement : `SECRET_KEY`, `APP_URL`, `MAIL_MODE=smtp`, `SMTP_HOST`, `SMTP_PORT`,
  `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_TLS=1`, `SMTP_FROM`, `SESSION_DAYS`.
- Passage à MariaDB/PostgreSQL si nécessaire : seule la couche `db.py` change.
- Authentification : comptes locaux pour le test ; à raccorder au SSO d'entreprise en production.

## Historique

- **08/09/2026 — interface commerciale v2** : accueil « Portefeuille » (arbre client → année → projet, tuiles processus,
  carte synchronisée), vue « À faire », carte des clients (fond vectoriel embarqué), fiche client CRM (production, contacts,
  géolocalisation), import CSV/Excel, kanban ↔ tableau des demandes. Schéma `clients` étendu (migrations additives),
  `demo.py` : 15 clients Sud-Ouest géolocalisés pour `com1`.

- **v0.3** (07/09/2026) — jeu de démonstration déterministe commun (demo.py, reset-demo.bat, export/import),
  compte impl2.

- **v0.2** (07/09/2026) — CDC Emballage refait (logique par lignes, catalogues, vidage/palettisation
  mutualisables, schéma automatique, récap PDF) ; run-dev.bat, auto-pull.bat, GUIDE-GIT.md.

- **v0.1** (04/09/2026) — première version bout en bout : 4 interfaces, machine à états,
  notifications + boîte mail factice, intégration de la page CDC Précalibrage, page CDC
  Emballage provisoire, 44 contrôles API + parcours navigateur automatisés.
