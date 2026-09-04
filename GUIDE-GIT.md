# Guide Git — travailler à deux sur le Gestionnaire

Dépôt : `gestionnaire_commercial` (GitHub, privé). Une branche `main`, chacun dans son dossier.

## Installation (une fois par PC)
1. Installer **GitHub Desktop** (https://desktop.github.com) et se connecter avec son compte GitHub.
2. *File → Clone repository* → choisir `gestionnaire_commercial` → dossier local de son choix.
3. Lancer `run.bat` dans le dossier cloné : chacun a son serveur et sa base de test locale
   (`data/` n'est pas dans Git, chacun garde ses données).

## Au quotidien (GitHub Desktop)
- **Avant de commencer** : bouton *Fetch origin* puis *Pull* → on récupère le travail de l'autre.
- **Travailler** : modifier les fichiers (ou laisser Claude le faire) dans son dossier d'interface.
- **Dès qu'un morceau marche** : dans GitHub Desktop, cocher les fichiers, écrire un message court
  (ex. `implantation : filtre par commercial`), *Commit to main*, puis *Push origin*.
- Petits commits fréquents > gros commit du vendredi.

## Les mêmes actions en ligne de commande
```
git pull                      # récupérer
git add -A                    # tout ajouter (data/ est ignoré automatiquement)
git commit -m "message"       # enregistrer
git push                      # envoyer
```

## Qui touche quoi (évite 95 % des conflits)
| Zone | Qui |
|---|---|
| `server.py`, `db.py`, `static/common/` | une seule personne à la fois — prévenir avant |
| `static/commercial/`, `static/implantation/`, `static/direction/`, `static/admin/`, `static/cdc/` | chacun son dossier |
| `README.md` | tout le monde, par petites touches |

## En cas de conflit
GitHub Desktop signale « conflicts » au *Pull*. Ouvrir le fichier : les deux versions sont encadrées par
`<<<<<<<`, `=======`, `>>>>>>>`. Garder la bonne (ou les deux), supprimer les marqueurs, puis *Commit* → *Push*.
Si c'est le bazar : copier son fichier ailleurs, *Branch → Discard all changes*, *Pull*, remettre sa modif à la main.

## Ce qui ne doit jamais partir sur GitHub
`data/` (base, mails, clé de session), `__pycache__/`, les zips — déjà exclus par `.gitignore`.
Aucune donnée client réelle dans les jeux de test : clients fictifs uniquement.

## Revenir en arrière
GitHub Desktop → onglet *History* → clic droit sur un commit → *Revert changes in commit*.
Ou consulter n'importe quel fichier à n'importe quelle date sur github.com.
