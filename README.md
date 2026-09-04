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

Comptes de démonstration créés au premier lancement (mot de passe = identifiant) :
`admin` · `com1` · `com2` · `impl1` · `dt1`. Clients fictifs « CLIENT A/B/C ».

Les mails **ne sont pas envoyés** en test (`MAIL_MODE=file`) : ils sont écrits dans
`data/mails/` et visibles dans l'onglet « Boîte mail (test) » (implantation, admin).

Pour repartir de zéro : arrêter le serveur, supprimer `data/gestionnaire.db` (et `data/mails/`).

## Organisation du dossier (travail à deux)

```
Gestionnaire/
├── server.py            noyau : API, rôles, machine à états, notifications   ← une seule personne
├── db.py                schéma SQLite + accès base                            ← une seule personne
├── requirements.txt · run.bat · run.sh · Dockerfile · docker-compose.yml
├── data/                base gestionnaire.db, clé de session, mails/ (ne pas partager)
└── static/
    ├── common/          maf.css (charte), api.js (appels API, en-tête, notifs), demande.js (fiche commune), logo.png
    ├── login.html
    ├── commercial/      index.html + app.js   ─┐
    ├── implantation/    index.html + app.js    │  une interface = un dossier autonome,
    ├── direction/       index.html + app.js    │  ne parle au serveur que par /api/…
    ├── admin/           index.html + app.js   ─┘
    └── cdc/             precalibrage.html (page CDC d'origine, inchangée) + bridge.js (pont API)
                         emballage.html (provisoire, à remplacer par la vraie page)
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

- **v0.1** (04/09/2026) — première version bout en bout : 4 interfaces, machine à états,
  notifications + boîte mail factice, intégration de la page CDC Précalibrage, page CDC
  Emballage provisoire, 44 contrôles API + parcours navigateur automatisés.
