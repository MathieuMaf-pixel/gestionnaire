# -*- coding: utf-8 -*-
"""
Jeu de démonstration du Gestionnaire — DÉTERMINISTE.

Le même script produit exactement les mêmes données sur tous les PC (graine fixe),
ce qui donne à chacun une base de test commune au démarrage.

- Chargé automatiquement par server.py quand la base est vide.
- En ligne de commande :
    python demo.py reset            supprime la base et la régénère (serveur arrêté !)
    python demo.py export [f.json]  exporte toute la base en JSON (pour partager un état précis)
    python demo.py import  f.json   remplace la base par le contenu du JSON (serveur arrêté !)

Toutes les données sont FICTIVES : clients « CLIENT A… », personnes « Commercial Test 1 »…
Aucun nom réel ne doit être ajouté ici.
"""
import os
import sys
import json
import random
from datetime import datetime, timedelta

import db as D
from werkzeug.security import generate_password_hash

GRAINE = 20260904
ANNEES = (2023, 2024, 2025, 2026)
AUJOURDHUI = datetime(2026, 9, 7, 9, 0, 0)     # date de référence fixe → données identiques partout

USERS = [
    # username, mot de passe, nom affiché, rôle, email
    ('admin', 'admin', 'Administrateur',      'admin', 'admin@exemple.local'),
    ('com1',  'com1',  'Commercial Test 1',   'com',   'com1@exemple.local'),
    ('com2',  'com2',  'Commercial Test 2',   'com',   'com2@exemple.local'),
    ('impl1', 'impl1', 'Implantation Test 1', 'impl',  'impl1@exemple.local'),
    ('impl2', 'impl2', 'Implantation Test 2', 'impl',  'impl2@exemple.local'),
    ('dt1',   'dt1',   'Directeur Technique', 'dt',    'dt1@exemple.local'),
]

# (nom, pays, ville, commercial, nb de projets visés)
CLIENTS = [
    ('CLIENT A (fictif)', 'France',   'Ville A', 'com1', 14),   # ← le client « à arborescence » : projets sur 4 ans
    ('CLIENT B (fictif)', 'Espagne',  'Ville B', 'com1', 4),
    ('CLIENT C (fictif)', 'Italie',   'Ville C', 'com1', 4),
    ('CLIENT D (fictif)', 'France',   'Ville D', 'com1', 3),
    ('CLIENT E (fictif)', 'Portugal', 'Ville E', 'com1', 3),
    ('CLIENT F (fictif)', 'Belgique', 'Ville F', 'com1', 2),
    ('CLIENT G (fictif)', 'Pologne',  'Ville G', 'com1', 2),
    ('CLIENT H (fictif)', 'France',   'Ville H', 'com2', 4),
    ('CLIENT I (fictif)', 'Chili',    'Ville I', 'com2', 3),
    ('CLIENT J (fictif)', 'Maroc',    'Ville J', 'com2', 3),
]

TITRES = [
    ('Ligne précalibrage {fruit} {th} T/h', ['precalibrage']),
    ('Station d\'emballage {nl} lignes', ['emballage']),
    ('Précalibrage + emballage {fruit}', ['precalibrage', 'emballage']),
    ('Extension ligne emballage existante', ['emballage']),
    ('Remplacement calibreuse {fruit}', ['precalibrage']),
    ('Nouvelle ligne flowpack {fruit}', ['emballage']),
    ('Modernisation vidage palox (DIR 3)', ['precalibrage']),
    ('Ligne unique emballage plateaux', ['emballage']),
    ('Projet complet nouvelle station {fruit}', ['precalibrage', 'emballage']),
    ('Ajout palettiseur automatique', ['emballage']),
]
FRUITS = ['pomme', 'poire', 'pomme/poire', 'kiwi', 'agrumes', 'pêche']
VARIETES = {'pomme': 'Gala, Golden, Granny', 'poire': 'Conférence, Williams', 'pomme/poire': 'Gala, Golden, Conférence',
            'kiwi': 'Hayward', 'agrumes': 'Clémentine, Orange Navel', 'pêche': 'Pêche jaune, Nectarine'}
FICHIERS = ['{cli}_precal_ind{ind}.dwg', '{cli}_emballage_ind{ind}.dwg', '{cli}_implantation_ind{ind}.dwg']
REFUS = ['Manque la zone de stockage des palox vides.', 'Passage chariot trop étroit devant le palettiseur.',
         'Prévoir l\'accès maintenance côté calibreuse.', 'Sens de circulation à inverser pour la reprise des palettes.']
NOTES_DT = ['OK pour chiffrage.', 'Validé — vérifier la hauteur sous poutre à l\'implantation.', '', 'Bon pour présentation client.']
COMM_IMPL = ['Première implantation selon CDC.', 'Variante avec vidage mutualisé.', 'Reprise suite remarques DT.', '']

# Répartition des statuts selon l'âge du projet
STATUTS_ANCIENS = ['chiffree'] * 6 + ['validee'] * 2 + ['chiffree_archive'] * 2
STATUTS_2025 = ['chiffree'] * 4 + ['validee'] * 3 + ['en_implantation'] + ['refusee'] + ['chiffree_archive']
STATUTS_2026 = ['brouillon'] * 3 + ['envoyee'] * 3 + ['en_implantation'] * 4 + ['a_valider'] * 3 + ['refusee'] * 2 + ['validee'] * 3 + ['chiffree'] * 2


def iso(dt):
    return dt.strftime('%Y-%m-%dT%H:%M:%S')


def fr(dt):
    return dt.strftime('%d/%m/%Y')


def generer(db, verbose=True):
    """Remplit une base VIDE avec le jeu de démonstration (déterministe)."""
    rnd = random.Random(GRAINE)
    ts0 = iso(AUJOURDHUI)
    # — comptes —
    for un, pw, name, role, mail in USERS:
        db.execute("INSERT INTO users VALUES (?,?,?,?,?,1,?)", (un, generate_password_hash(pw), name, role, mail, ts0))
    # — clients —
    clients = []
    for k, (nom, pays, ville, com, nb) in enumerate(CLIENTS):
        cid = 'cl_demo_%02d' % (k + 1)
        db.execute("INSERT INTO clients VALUES (?,?,?,?,?,?,?,?)",
                   (cid, nom, pays, ville, com, 'Contact fictif %s' % nom[7], '', iso(datetime(2023, 1, 10 + k, 9, 0))))
        clients.append({'id': cid, 'nom': nom, 'pays': pays, 'com': com, 'nb': nb, 'code': nom[7]})
    # — demandes : on tire les dates puis on numérote dans l'ordre chronologique —
    brouillons = []
    for c in clients:
        n = c['nb']
        # CLIENT A : réparti sur les 4 années (arborescence par année), les autres surtout récents
        if c['code'] == 'A':
            annees = [2023, 2023, 2023, 2024, 2024, 2024, 2024, 2025, 2025, 2025, 2026, 2026, 2026, 2026][:n]
        else:
            annees = [rnd.choice([2024, 2025, 2025, 2026, 2026, 2026]) for _ in range(n)]
        for a in annees:
            if a == 2026:
                d = datetime(2026, rnd.randint(1, 9), rnd.randint(1, 28), rnd.randint(8, 17), rnd.randint(0, 59))
                d = min(d, AUJOURDHUI - timedelta(days=1))
            else:
                d = datetime(a, rnd.randint(1, 12), rnd.randint(1, 28), rnd.randint(8, 17), rnd.randint(0, 59))
            brouillons.append((d, c))
    brouillons.sort(key=lambda x: x[0])
    impls = ['impl1', 'impl1', 'impl2']
    nb_par_statut = {}
    for numero, (d, c) in enumerate(brouillons, start=1):
        titre_t, types = rnd.choice(TITRES)
        fruit = rnd.choice(FRUITS)
        th = rnd.choice([6, 8, 10, 12, 15, 20, 25, 30])
        titre = titre_t.format(fruit=fruit, th=th, nl=rnd.choice([2, 3, 4]))
        age_j = (AUJOURDHUI - d).days
        if d.year <= 2024:
            statut = rnd.choice(STATUTS_ANCIENS)
        elif d.year == 2025:
            statut = rnd.choice(STATUTS_2025)
        else:
            statut = rnd.choice(STATUTS_2026)
            if age_j < 10 and statut not in ('brouillon', 'envoyee', 'en_implantation'):
                statut = rnd.choice(['brouillon', 'envoyee', 'en_implantation'])
        archive = 0
        if statut == 'chiffree_archive':
            statut, archive = 'chiffree', 1
        did = 'dem_demo_%03d' % numero
        impl = rnd.choice(impls)
        retour = d + timedelta(days=rnd.choice([21, 30, 45, 60]))
        t = d                                     # horloge du dossier
        journal = []                              # (ts, acteur, role, texte)
        com_nom = 'Commercial Test 1' if c['com'] == 'com1' else 'Commercial Test 2'
        impl_nom = 'Implantation Test 1' if impl == 'impl1' else 'Implantation Test 2'

        def j(acteur, role, texte, jours=0, heures=0):
            nonlocal t
            prec = t
            t = t + timedelta(days=jours, hours=heures, minutes=rnd.randint(1, 50))
            if t > AUJOURDHUI:                      # jamais dans le futur : on tasse sur la dernière heure, en restant croissant
                t = min(AUJOURDHUI, max(prec + timedelta(minutes=1), AUJOURDHUI - timedelta(minutes=max(1, 59 - len(journal) * 3))))
            journal.append((iso(t), acteur, role, texte))
            return t
        j(com_nom, 'Commercial', 'Demande créée (brouillon) — CDC à compléter : ' + ', '.join({'precalibrage': 'CDC Précalibrage', 'emballage': 'CDC Emballage'}[x] for x in types))
        etapes = ['brouillon', 'envoyee', 'en_implantation', 'a_valider', 'validee', 'chiffree']
        rang = etapes.index('a_valider' if statut == 'refusee' else statut)
        envoyee_le = validee_le = None
        cdc_complet = rang >= 1 or rnd.random() < 0.3
        plans = []
        if rang >= 1:
            for x in types:
                j(com_nom, 'Commercial', {'precalibrage': 'CDC Précalibrage', 'emballage': 'CDC Emballage'}[x] + ' complété.', jours=rnd.randint(0, 3))
            envoyee_le = iso(j(com_nom, 'Commercial', 'CDC complet — demande envoyée aux implantations.', jours=rnd.randint(0, 2)))
        if rang >= 2:
            j(impl_nom, 'Implantation', 'Prise en charge par l\'implantation (%s).' % impl_nom, jours=rnd.randint(1, 4))
            fic = rnd.choice(FICHIERS).format(cli='CLIENT' + c['code'], ind='A')
            tA = j(impl_nom, 'Implantation', 'Plan indice A ajouté — ' + fic + '.', jours=rnd.randint(2, 8))
            plans.append({'id': 'pl_%s_A' % did, 'indice': 'A', 'fichier': fic, 'commentaire': rnd.choice(COMM_IMPL), 'statut': 'brouillon', 'note_dt': '', 'cree_le': iso(tA), 'decide_le': None, 'decide_par': None})
        if rang >= 3:
            plans[-1]['statut'] = 'a_valider'
            j(impl_nom, 'Implantation', 'Plan indice A envoyé en validation à la direction technique.', jours=rnd.randint(0, 2))
            if statut == 'refusee' or (rang >= 4 and rnd.random() < 0.35):
                motif = rnd.choice(REFUS)
                tR = j('Directeur Technique', 'Direction technique', 'Plan indice A refusé par la direction technique : ' + motif, jours=rnd.randint(1, 3))
                plans[-1].update({'statut': 'refuse', 'note_dt': motif, 'decide_le': iso(tR), 'decide_par': 'dt1'})
                if statut != 'refusee':
                    fic = rnd.choice(FICHIERS).format(cli='CLIENT' + c['code'], ind='B')
                    tB = j(impl_nom, 'Implantation', 'Plan indice B ajouté — ' + fic + '.', jours=rnd.randint(2, 6))
                    plans.append({'id': 'pl_%s_B' % did, 'indice': 'B', 'fichier': fic, 'commentaire': 'Reprise suite remarques DT.', 'statut': 'a_valider', 'note_dt': '', 'cree_le': iso(tB), 'decide_le': None, 'decide_par': None})
                    j(impl_nom, 'Implantation', 'Plan indice B envoyé en validation à la direction technique.', jours=1)
        if rang >= 4:
            note = rnd.choice(NOTES_DT)
            tV = j('Directeur Technique', 'Direction technique', 'Plan indice %s validé par la direction technique%s' % (plans[-1]['indice'], (' — ' + note) if note else '.'), jours=rnd.randint(1, 4))
            plans[-1].update({'statut': 'valide', 'note_dt': note, 'decide_le': iso(tV), 'decide_par': 'dt1'})
            validee_le = iso(tV)
        devis = ''
        if rang >= 5:
            devis = 'DV-%d-%04d' % (t.year, 100 + numero)
            j(com_nom, 'Commercial', 'Chiffrage déclaré — devis %s.' % devis, jours=rnd.randint(2, 10))
        if archive:
            j(com_nom, 'Commercial', 'Demande archivée.', jours=rnd.randint(20, 60))
        if rnd.random() < 0.3:
            j(com_nom, 'Commercial', '💬 ' + rnd.choice(['Le client souhaite une présentation sur site.', 'Attention : bâtiment neuf, plans en cours.', 'Client pressé, retour souhaité au plus vite.', 'Budget à confirmer avant chiffrage.']), jours=0, heures=2)
        updated = journal[-1][0]
        db.execute("""INSERT INTO demandes (id, numero, client_id, titre, commercial, statut, produits, varietes, tonnage_annuel, tonnage_horaire,
                      temps_travail, description, retour_souhaite, cdc_types, implanteur, devis, archive, created_at, updated_at, envoyee_le, validee_le)
                      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                   (did, numero, c['id'], titre, c['com'], statut, fruit.capitalize().replace('/', ', '), VARIETES[fruit],
                    str(th * rnd.choice([800, 1000, 1200])), str(th), rnd.choice(['8 h/j, 5 j/7', '2 × 8 h', '10 h/j, 6 mois', '16 h/j en saison']),
                    'Projet fictif de démonstration — %s pour %s.' % (titre.lower(), c['nom']), fr(retour), json.dumps(types),
                    impl if rang >= 2 else '', devis, archive, iso(d), updated, envoyee_le, validee_le))
        for x in types:
            data = {'v': 1, 'f': {'7': c['nom'], '84': str(th)}} if x == 'precalibrage' else {'v': 2, 'gen': {'client': c['nom'], 'tonnageH': str(th)}, 'projet': {'mode': 'neuf'}}
            db.execute("INSERT INTO cdc (demande_id, type, data, complet, updated_at) VALUES (?,?,?,?,?)",
                       (did, x, json.dumps(data, ensure_ascii=False), 1 if cdc_complet else 0, journal[min(1, len(journal) - 1)][0]))
        for p in plans:
            db.execute("""INSERT INTO plans (id, demande_id, indice, fichier, commentaire, statut, note_dt, cree_par, cree_le, decide_le, decide_par)
                          VALUES (?,?,?,?,?,?,?,?,?,?,?)""", (p['id'], did, p['indice'], p['fichier'], p['commentaire'], p['statut'], p['note_dt'], impl, p['cree_le'], p['decide_le'], p['decide_par']))
        for (ts, acteur, role, texte) in journal:
            db.execute("INSERT INTO journal (demande_id, ts, acteur, role, texte) VALUES (?,?,?,?,?)", (did, ts, acteur, role, texte))
        # notifications récentes seulement (moins de 30 jours), non lues
        if age_j < 30:
            if statut == 'envoyee':
                db.execute("INSERT INTO notifications (ts, dest_role, dest_user, sujet, corps, demande_id) VALUES (?,?,?,?,?,?)",
                           (envoyee_le, 'impl', '', 'Nouvelle demande D-%04d — %s' % (numero, c['nom']), titre, did))
            if statut == 'a_valider':
                db.execute("INSERT INTO notifications (ts, dest_role, dest_user, sujet, corps, demande_id) VALUES (?,?,?,?,?,?)",
                           (updated, 'dt', '', 'Plan à valider — D-%04d %s (indice %s)' % (numero, c['nom'], plans[-1]['indice']), titre, did))
            if statut in ('validee',):
                db.execute("INSERT INTO notifications (ts, dest_role, dest_user, sujet, corps, demande_id) VALUES (?,?,?,?,?,?)",
                           (validee_le, '', c['com'], 'Plan validé — D-%04d %s' % (numero, c['nom']), titre, did))
            if statut == 'refusee':
                db.execute("INSERT INTO notifications (ts, dest_role, dest_user, sujet, corps, demande_id) VALUES (?,?,?,?,?,?)",
                           (updated, 'impl', '', 'Plan refusé — D-%04d %s (indice A)' % (numero, c['nom']), titre, did))
        nb_par_statut[statut + (' (archivée)' if archive else '')] = nb_par_statut.get(statut + (' (archivée)' if archive else ''), 0) + 1
    db.commit()
    if verbose:
        print('[demo] %d demandes, %d clients, %d comptes — repartition : %s' % (
            len(brouillons), len(clients), len(USERS), ', '.join('%s=%d' % kv for kv in sorted(nb_par_statut.items()))))


# ─── Export / import de toute la base (pour partager un état précis) ──────────
TABLES = ('users', 'clients', 'demandes', 'cdc', 'plans', 'journal', 'notifications')


def exporter(chemin):
    db = D.get_db()
    out = {t: D.q(db, 'SELECT * FROM ' + t) for t in TABLES}
    db.close()
    with open(chemin, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print('[demo] export -> %s (%s)' % (chemin, ', '.join('%s=%d' % (t, len(out[t])) for t in TABLES)))


def importer(chemin):
    with open(chemin, encoding='utf-8') as f:
        data = json.load(f)
    if os.path.exists(D.DB_PATH):
        os.remove(D.DB_PATH)
    for suf in ('-wal', '-shm'):
        if os.path.exists(D.DB_PATH + suf):
            os.remove(D.DB_PATH + suf)
    D.init_schema()
    db = D.get_db()
    for t in TABLES:
        rows = data.get(t) or []
        if not rows:
            continue
        cols = list(rows[0].keys())
        if t in ('journal', 'notifications'):
            cols = [c for c in cols if c != 'id']
        sql = 'INSERT INTO %s (%s) VALUES (%s)' % (t, ','.join(cols), ','.join('?' * len(cols)))
        db.executemany(sql, [[r.get(c) for c in cols] for r in rows])
    db.commit()
    db.close()
    print('[demo] import <- %s' % chemin)


def reset():
    for p in (D.DB_PATH, D.DB_PATH + '-wal', D.DB_PATH + '-shm'):
        if os.path.exists(p):
            os.remove(p)
    D.init_schema()
    db = D.get_db()
    generer(db)
    db.close()
    print('[demo] base regeneree : %s' % D.DB_PATH)


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'reset'
    if cmd == 'reset':
        reset()
    elif cmd == 'export':
        exporter(sys.argv[2] if len(sys.argv) > 2 else os.path.join(D.DATA_DIR, 'export.json'))
    elif cmd == 'import':
        importer(sys.argv[2])
    else:
        print(__doc__)
