# -*- coding: utf-8 -*-
"""
Gestionnaire — suivi des demandes commerciales, du CDC au plan validé.

Rôles : com (commercial) · impl (implantation) · dt (direction technique) · admin
Flux  : brouillon → envoyee → en_implantation → a_valider → validee (→ chiffree)
                                     ↑                │
                                     └──── refusee ◄──┘   (refus motivé de la DT)

Stack test : Flask + SQLite (db.py). Rafraîchissement des clients par polling (10 s).
Mails : MAIL_MODE=file → écrits dans data/mails/ (boîte factice) ; MAIL_MODE=smtp → envoi réel.
"""
from flask import Flask, jsonify, request, send_from_directory, session, redirect, abort
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps
from datetime import timedelta
import os
import re
import json
import smtplib
from email.message import EmailMessage

import db as D

BASE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(BASE, 'static')
MAIL_DIR = os.path.join(D.DATA_DIR, 'mails')
MAIL_MODE = os.environ.get('MAIL_MODE', 'file')          # file | smtp | off
APP_URL = os.environ.get('APP_URL', 'http://localhost:5000')

ROLES = ('com', 'impl', 'dt', 'admin')
ROLE_LABELS = {'com': 'Commercial', 'impl': 'Implantation', 'dt': 'Direction technique', 'admin': 'Administrateur'}
ROLE_HOME = {'com': '/commercial/', 'impl': '/implantation/', 'dt': '/direction/', 'admin': '/admin/'}

STATUTS = {
    'brouillon':       {'label': 'Brouillon',              'cls': 'grey',   'ordre': 0},
    'envoyee':         {'label': 'Envoyée aux implantations', 'cls': 'blue', 'ordre': 1},
    'en_implantation': {'label': 'En implantation',        'cls': 'blue',   'ordre': 2},
    'a_valider':       {'label': 'Plan à valider (DT)',    'cls': 'orange', 'ordre': 3},
    'refusee':         {'label': 'Refusée — à reprendre',  'cls': 'red',    'ordre': 2},
    'validee':         {'label': 'Plan validé',            'cls': 'green',  'ordre': 4},
    'chiffree':        {'label': 'Chiffrée',               'cls': 'green',  'ordre': 5},
}
CDC_TYPES = {
    'precalibrage': {'label': 'CDC Précalibrage', 'page': '/cdc/precalibrage.html'},
    'emballage':    {'label': 'CDC Emballage',    'page': '/cdc/emballage.html'},
}


# ─── Application ─────────────────────────────────────────────────────
def _secret_key():
    k = os.environ.get('SECRET_KEY')
    if k:
        return k
    os.makedirs(D.DATA_DIR, exist_ok=True)
    p = os.path.join(D.DATA_DIR, 'secret.key')
    if not os.path.exists(p):
        with open(p, 'w') as f:
            f.write(os.urandom(32).hex())
    with open(p) as f:
        return f.read().strip()


app = Flask(__name__, static_folder=None)
app.config['SECRET_KEY'] = _secret_key()
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=int(os.environ.get('SESSION_DAYS', '30')))
app.config['JSON_SORT_KEYS'] = False


# ─── Auth ────────────────────────────────────────────────────────────
def current_user(db):
    u = session.get('user')
    if not u:
        return None
    row = D.q1(db, "SELECT username, display_name, role, email, actif FROM users WHERE username=?", (u,))
    if not row or not row['actif']:
        return None
    return row


def require(*roles):
    """Décorateur : utilisateur connecté, et rôle parmi `roles` (admin passe toujours)."""
    def deco(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            db = D.get_db()
            try:
                u = current_user(db)
                if not u:
                    return jsonify({'error': 'Non connecté'}), 401
                if roles and u['role'] not in roles and u['role'] != 'admin':
                    return jsonify({'error': 'Accès refusé pour le rôle ' + ROLE_LABELS.get(u['role'], u['role'])}), 403
                request.user = u
                request.db = db
                return fn(*a, **kw)
            finally:
                db.close()
        return wrapper
    return deco


@app.route('/api/login', methods=['POST'])
def api_login():
    body = request.get_json(silent=True) or {}
    username = (body.get('username') or '').strip().lower()
    password = body.get('password') or ''
    db = D.get_db()
    row = D.q1(db, "SELECT * FROM users WHERE username=? AND actif=1", (username,))
    db.close()
    if not row or not check_password_hash(row['password_hash'], password):
        return jsonify({'error': 'Identifiants invalides'}), 401
    session.permanent = True
    session['user'] = username
    return jsonify({'ok': True, 'role': row['role'], 'home': ROLE_HOME[row['role']]})


@app.route('/api/logout', methods=['POST'])
def api_logout():
    session.clear()
    return jsonify({'ok': True})


@app.route('/api/me')
@require()
def api_me():
    u = dict(request.user)
    u['home'] = ROLE_HOME[u['role']]
    u['role_label'] = ROLE_LABELS[u['role']]
    return jsonify(u)


@app.route('/api/change_password', methods=['POST'])
@require()
def api_change_password():
    body = request.get_json(silent=True) or {}
    old, new = body.get('old') or '', body.get('new') or ''
    if len(new) < 4:
        return jsonify({'error': 'Mot de passe trop court (4 caractères minimum).'}), 400
    row = D.q1(request.db, "SELECT password_hash FROM users WHERE username=?", (request.user['username'],))
    if not check_password_hash(row['password_hash'], old):
        return jsonify({'error': 'Ancien mot de passe incorrect.'}), 400
    request.db.execute("UPDATE users SET password_hash=? WHERE username=?",
                       (generate_password_hash(new), request.user['username']))
    request.db.commit()
    return jsonify({'ok': True})


@app.route('/api/config')
@require()
def api_config():
    return jsonify({'roles': ROLE_LABELS, 'statuts': STATUTS, 'cdc_types': CDC_TYPES,
                    'mail_mode': MAIL_MODE, 'poll_seconds': 10})


# ─── Utilisateurs (admin) ────────────────────────────────────────────
@app.route('/api/users')
@require('admin')
def users_list():
    return jsonify(D.q(request.db, "SELECT username, display_name, role, email, actif, created_at FROM users ORDER BY role, username"))


@app.route('/api/users/commerciaux')
@require('com', 'impl', 'dt')
def users_commerciaux():
    return jsonify(D.q(request.db, "SELECT username, display_name, email FROM users WHERE role='com' AND actif=1 ORDER BY display_name"))


@app.route('/api/users', methods=['POST'])
@require('admin')
def users_create():
    b = request.get_json(silent=True) or {}
    username = (b.get('username') or '').strip().lower()
    if not re.match(r'^[a-z0-9._-]{2,40}$', username):
        return jsonify({'error': 'Identifiant invalide (lettres, chiffres, . _ -).'}), 400
    if b.get('role') not in ROLES:
        return jsonify({'error': 'Rôle invalide.'}), 400
    pw = b.get('password') or ''
    if len(pw) < 4:
        return jsonify({'error': 'Mot de passe trop court.'}), 400
    if D.q1(request.db, "SELECT 1 FROM users WHERE username=?", (username,)):
        return jsonify({'error': 'Cet identifiant existe déjà.'}), 400
    request.db.execute("INSERT INTO users VALUES (?,?,?,?,?,1,?)",
                       (username, generate_password_hash(pw), (b.get('display_name') or username).strip(),
                        b['role'], (b.get('email') or '').strip(), D.now_iso()))
    request.db.commit()
    return jsonify({'ok': True}), 201


@app.route('/api/users/<username>', methods=['PUT'])
@require('admin')
def users_update(username):
    b = request.get_json(silent=True) or {}
    row = D.q1(request.db, "SELECT * FROM users WHERE username=?", (username,))
    if not row:
        return jsonify({'error': 'Utilisateur introuvable'}), 404
    role = b.get('role', row['role'])
    if role not in ROLES:
        return jsonify({'error': 'Rôle invalide.'}), 400
    if username == request.user['username'] and role != 'admin':
        return jsonify({'error': 'Vous ne pouvez pas retirer votre propre rôle admin.'}), 400
    request.db.execute("UPDATE users SET display_name=?, role=?, email=?, actif=? WHERE username=?",
                       ((b.get('display_name') or row['display_name']).strip(), role,
                        (b.get('email') if b.get('email') is not None else row['email']).strip(),
                        1 if b.get('actif', row['actif']) else 0, username))
    if b.get('password'):
        if len(b['password']) < 4:
            return jsonify({'error': 'Mot de passe trop court.'}), 400
        request.db.execute("UPDATE users SET password_hash=? WHERE username=?",
                           (generate_password_hash(b['password']), username))
    request.db.commit()
    return jsonify({'ok': True})


# ─── Notifications & mails ───────────────────────────────────────────
def notify(db, sujet, corps, demande_id=None, dest_role='', dest_user=''):
    """Crée une notification interne et envoie le mail (factice ou réel) aux destinataires."""
    db.execute("INSERT INTO notifications (ts, dest_role, dest_user, sujet, corps, demande_id) VALUES (?,?,?,?,?,?)",
               (D.now_iso(), dest_role, dest_user, sujet, corps, demande_id))
    if dest_user:
        dests = D.q(db, "SELECT email, display_name FROM users WHERE username=? AND actif=1", (dest_user,))
    else:
        dests = D.q(db, "SELECT email, display_name FROM users WHERE role=? AND actif=1", (dest_role,))
    emails = [d['email'] for d in dests if d['email']]
    send_mail(emails, sujet, corps + ('\n\nOuvrir : %s/?d=%s' % (APP_URL, demande_id) if demande_id else ''))


def send_mail(to, sujet, corps):
    if MAIL_MODE == 'off' or not to:
        return
    if MAIL_MODE == 'smtp':
        try:
            msg = EmailMessage()
            msg['From'] = os.environ.get('SMTP_FROM', 'gestionnaire@localhost')
            msg['To'] = ', '.join(to)
            msg['Subject'] = '[Gestionnaire] ' + sujet
            msg.set_content(corps)
            with smtplib.SMTP(os.environ.get('SMTP_HOST', 'localhost'), int(os.environ.get('SMTP_PORT', '25'))) as s:
                if os.environ.get('SMTP_TLS', '0') == '1':
                    s.starttls()
                if os.environ.get('SMTP_USER'):
                    s.login(os.environ['SMTP_USER'], os.environ.get('SMTP_PASSWORD', ''))
                s.send_message(msg)
        except Exception as e:
            print('[mail] Echec envoi SMTP :', e)
        return
    # Mode fichier : boîte mail factice
    os.makedirs(MAIL_DIR, exist_ok=True)
    name = D.now_iso().replace(':', '-') + '_' + re.sub(r'[^\w-]+', '_', sujet)[:60] + '_' + os.urandom(2).hex() + '.txt'
    with open(os.path.join(MAIL_DIR, name), 'w', encoding='utf-8') as f:
        f.write('À      : %s\nSujet  : [Gestionnaire] %s\nDate   : %s\n\n%s\n' % (', '.join(to), sujet, D.now_iso(), corps))


@app.route('/api/notifications')
@require()
def notifications_list():
    u = request.user
    rows = D.q(request.db, """SELECT n.*, d.numero, d.titre FROM notifications n
                              LEFT JOIN demandes d ON d.id = n.demande_id
                              WHERE n.dest_user=? OR (n.dest_role=? AND n.dest_user='')
                              ORDER BY n.id DESC LIMIT 50""", (u['username'], u['role']))
    for r in rows:
        r['lu'] = u['username'] in D.jl(r.pop('lu_par'))
    return jsonify(rows)


@app.route('/api/notifications/lu', methods=['POST'])
@require()
def notifications_lu():
    ids = (request.get_json(silent=True) or {}).get('ids') or []
    for nid in ids:
        row = D.q1(request.db, "SELECT lu_par FROM notifications WHERE id=?", (nid,))
        if row:
            lu = D.jl(row['lu_par'])
            if request.user['username'] not in lu:
                lu.append(request.user['username'])
                request.db.execute("UPDATE notifications SET lu_par=? WHERE id=?", (json.dumps(lu), nid))
    request.db.commit()
    return jsonify({'ok': True})


@app.route('/api/mails')
@require()
def mails_list():
    """Boîte mail factice (mode file) : liste des derniers mails écrits sur disque."""
    if not os.path.isdir(MAIL_DIR):
        return jsonify([])
    files = sorted(os.listdir(MAIL_DIR), reverse=True)[:40]
    out = []
    for f in files:
        with open(os.path.join(MAIL_DIR, f), encoding='utf-8') as fh:
            out.append({'fichier': f, 'contenu': fh.read()})
    return jsonify(out)


# ─── Clients ─────────────────────────────────────────────────────────
# Champs libres de la fiche client (v0.2). `fruits` est un JSON [{"produit":"pommes","volume_t":1200}].
CLIENT_TEXTE = ('pays', 'ville', 'contact', 'notes', 'adresse', 'cp', 'dept', 'tel', 'email', 'activite')
CLIENT_NUM = ('lat', 'lng')


def client_out(row):
    if row is None:
        return None
    row['fruits'] = D.jl(row.get('fruits'), [])
    return row


def _fruits_in(v):
    if v is None:
        return None
    if isinstance(v, str):
        v = D.jl(v, [])
    out = []
    for f in (v or []):
        if not isinstance(f, dict) or not f.get('produit'):
            continue
        try:
            vol = float(re.sub(r'[\s\u00a0\u202f]', '', str(f.get('volume_t', ''))).replace(',', '.')) if f.get('volume_t') not in (None, '') else None
        except ValueError:
            vol = None
        out.append({'produit': str(f['produit']).strip().lower(), 'volume_t': vol})
    return json.dumps(out)


def _num_in(v):
    if v in (None, ''):
        return None
    try:
        return float(re.sub(r'[\s\u00a0\u202f]', '', str(v)).replace(',', '.'))
    except ValueError:
        return None


@app.route('/api/clients')
@require()
def clients_list():
    u = request.user
    if u['role'] == 'com':
        rows = D.q(request.db, "SELECT * FROM clients WHERE commercial=? ORDER BY nom", (u['username'],))
    else:
        rows = D.q(request.db, "SELECT * FROM clients ORDER BY nom")
    counts = {r['client_id']: r['n'] for r in D.q(request.db, "SELECT client_id, COUNT(*) n FROM demandes WHERE archive=0 GROUP BY client_id")}
    for r in rows:
        r['nb_demandes'] = counts.get(r['id'], 0)
        client_out(r)
    return jsonify(rows)


@app.route('/api/clients', methods=['POST'])
@require('com')
def clients_create():
    b = request.get_json(silent=True) or {}
    nom = (b.get('nom') or '').strip()
    if not nom:
        return jsonify({'error': 'Le nom du client est obligatoire.'}), 400
    cid = D.new_id('cl')
    commercial = request.user['username'] if request.user['role'] == 'com' else (b.get('commercial') or request.user['username'])
    cols = ['id', 'nom', 'commercial', 'created_at'] + list(CLIENT_TEXTE) + list(CLIENT_NUM) + ['fruits']
    vals = [cid, nom, commercial, D.now_iso()] + [(b.get(f) or '').strip() for f in CLIENT_TEXTE] \
        + [_num_in(b.get(f)) for f in CLIENT_NUM] + [_fruits_in(b.get('fruits')) or '[]']
    request.db.execute("INSERT INTO clients (%s) VALUES (%s)" % (', '.join(cols), ', '.join('?' * len(cols))), vals)
    request.db.commit()
    return jsonify(client_out(D.q1(request.db, "SELECT * FROM clients WHERE id=?", (cid,)))), 201


@app.route('/api/clients/<cid>', methods=['PUT'])
@require('com')
def clients_update(cid):
    row = D.q1(request.db, "SELECT * FROM clients WHERE id=?", (cid,))
    if not row:
        return jsonify({'error': 'Client introuvable'}), 404
    if request.user['role'] == 'com' and row['commercial'] != request.user['username']:
        return jsonify({'error': 'Ce client est suivi par un autre commercial.'}), 403
    b = request.get_json(silent=True) or {}
    sets, vals = ['nom=?'], [(b.get('nom') or row['nom']).strip()]
    for f in CLIENT_TEXTE:
        if b.get(f) is not None:
            sets.append(f + '=?'); vals.append(str(b[f]).strip())
    for f in CLIENT_NUM:
        if f in b:
            sets.append(f + '=?'); vals.append(_num_in(b[f]))
    if 'fruits' in b:
        sets.append('fruits=?'); vals.append(_fruits_in(b['fruits']) or '[]')
    vals.append(cid)
    request.db.execute("UPDATE clients SET " + ', '.join(sets) + " WHERE id=?", vals)
    request.db.commit()
    return jsonify(client_out(D.q1(request.db, "SELECT * FROM clients WHERE id=?", (cid,))))


# ─── Demandes ────────────────────────────────────────────────────────
def journal_add(db, demande_id, texte, acteur=None, role=None):
    u = getattr(request, 'user', None)
    db.execute("INSERT INTO journal (demande_id, ts, acteur, role, texte) VALUES (?,?,?,?,?)",
               (demande_id, D.now_iso(), acteur or (u['display_name'] if u else 'Système'),
                role or (ROLE_LABELS.get(u['role'], u['role']) if u else 'Outil'), texte))


def demande_full(db, did):
    d = D.q1(db, """SELECT d.*, c.nom AS client_nom, c.pays AS client_pays, c.ville AS client_ville,
                           u.display_name AS commercial_nom, u.email AS commercial_email,
                           i.display_name AS implanteur_nom
                    FROM demandes d
                    JOIN clients c ON c.id = d.client_id
                    LEFT JOIN users u ON u.username = d.commercial
                    LEFT JOIN users i ON i.username = d.implanteur
                    WHERE d.id=?""", (did,))
    if not d:
        return None
    d['cdc_types'] = D.jl(d['cdc_types'])
    d['cdc'] = {r['type']: {'complet': bool(r['complet']), 'updated_at': r['updated_at']}
                for r in D.q(db, "SELECT type, complet, updated_at FROM cdc WHERE demande_id=?", (did,))}
    d['plans'] = D.q(db, "SELECT * FROM plans WHERE demande_id=? ORDER BY cree_le", (did,))
    d['journal'] = D.q(db, "SELECT ts, acteur, role, texte FROM journal WHERE demande_id=? ORDER BY id", (did,))
    d['statut_label'] = STATUTS.get(d['statut'], {}).get('label', d['statut'])
    return d


def demande_visible(u, d):
    if u['role'] in ('admin', 'dt'):
        return True
    if u['role'] == 'com':
        return d['commercial'] == u['username']
    if u['role'] == 'impl':
        return d['statut'] != 'brouillon'
    return False


def load_demande_or_403(did):
    d = demande_full(request.db, did)
    if not d:
        return None, (jsonify({'error': 'Demande introuvable'}), 404)
    if not demande_visible(request.user, d):
        return None, (jsonify({'error': 'Cette demande ne vous est pas accessible.'}), 403)
    return d, None


@app.route('/api/demandes')
@require()
def demandes_list():
    u = request.user
    archive = 1 if request.args.get('archive') == '1' else 0
    sql = """SELECT d.id, d.numero, d.titre, d.statut, d.commercial, d.produits, d.tonnage_horaire, d.retour_souhaite,
                    d.cdc_types, d.implanteur, d.devis, d.archive, d.created_at, d.updated_at, d.envoyee_le, d.validee_le,
                    d.client_id, (SELECT MIN(complet) FROM cdc x WHERE x.demande_id=d.id) AS cdc_complet,
                    c.nom AS client_nom, c.pays AS client_pays, u.display_name AS commercial_nom, i.display_name AS implanteur_nom,
                    (SELECT COUNT(*) FROM plans p WHERE p.demande_id=d.id) AS nb_plans,
                    (SELECT indice FROM plans p WHERE p.demande_id=d.id ORDER BY cree_le DESC LIMIT 1) AS dernier_indice
             FROM demandes d JOIN clients c ON c.id=d.client_id
             LEFT JOIN users u ON u.username=d.commercial LEFT JOIN users i ON i.username=d.implanteur
             WHERE d.archive=?"""
    params = [archive]
    if u['role'] == 'com':
        sql += " AND d.commercial=?"
        params.append(u['username'])
    elif u['role'] == 'impl':
        sql += " AND d.statut<>'brouillon'"
    sql += " ORDER BY d.updated_at DESC"
    rows = D.q(request.db, sql, params)
    for r in rows:
        r['cdc_types'] = D.jl(r['cdc_types'])
        r['statut_label'] = STATUTS.get(r['statut'], {}).get('label', r['statut'])
    return jsonify(rows)


@app.route('/api/demandes/<did>')
@require()
def demandes_get(did):
    d, err = load_demande_or_403(did)
    return err if err else jsonify(d)


DEMANDE_FIELDS = ('titre', 'produits', 'varietes', 'tonnage_annuel', 'tonnage_horaire', 'temps_travail',
                  'description', 'retour_souhaite')


@app.route('/api/demandes', methods=['POST'])
@require('com')
def demandes_create():
    b = request.get_json(silent=True) or {}
    client = D.q1(request.db, "SELECT * FROM clients WHERE id=?", (b.get('client_id'),))
    if not client:
        return jsonify({'error': 'Client introuvable — sélectionner ou créer un client.'}), 400
    if request.user['role'] == 'com' and client['commercial'] != request.user['username']:
        return jsonify({'error': 'Ce client est suivi par un autre commercial.'}), 403
    titre = (b.get('titre') or '').strip()
    if not titre:
        return jsonify({'error': "L'intitulé du projet est obligatoire."}), 400
    types = [t for t in (b.get('cdc_types') or []) if t in CDC_TYPES]
    if not types:
        return jsonify({'error': 'Choisir au moins un type de CDC (précalibrage et/ou emballage).'}), 400
    did = D.new_id('dem')
    numero = (D.q1(request.db, "SELECT COALESCE(MAX(numero),0)+1 AS n FROM demandes") or {}).get('n', 1)
    ts = D.now_iso()
    request.db.execute("""INSERT INTO demandes (id, numero, client_id, titre, commercial, statut, produits, varietes,
                          tonnage_annuel, tonnage_horaire, temps_travail, description, retour_souhaite, cdc_types,
                          created_at, updated_at) VALUES (?,?,?,?,?,'brouillon',?,?,?,?,?,?,?,?,?,?)""",
                       (did, numero, client['id'], titre, client['commercial'],
                        *[(b.get(f) or '').strip() for f in DEMANDE_FIELDS[1:]], json.dumps(types), ts, ts))
    for t in types:
        request.db.execute("INSERT INTO cdc (demande_id, type, data, complet, updated_at) VALUES (?,?,'{}',0,?)", (did, t, ts))
    journal_add(request.db, did, 'Demande créée (brouillon) — CDC à compléter : ' + ', '.join(CDC_TYPES[t]['label'] for t in types) + '.')
    request.db.commit()
    return jsonify(demande_full(request.db, did)), 201


@app.route('/api/demandes/<did>', methods=['PUT'])
@require('com')
def demandes_update(did):
    d, err = load_demande_or_403(did)
    if err:
        return err
    if d['statut'] != 'brouillon' and request.user['role'] != 'admin':
        return jsonify({'error': 'La demande a été envoyée : les informations ne sont plus modifiables.'}), 400
    b = request.get_json(silent=True) or {}
    sets, vals = [], []
    for f in DEMANDE_FIELDS:
        if f in b:
            sets.append(f + '=?')
            vals.append((b[f] or '').strip())
    if 'cdc_types' in b:
        types = [t for t in b['cdc_types'] if t in CDC_TYPES]
        if not types:
            return jsonify({'error': 'Au moins un type de CDC.'}), 400
        sets.append('cdc_types=?')
        vals.append(json.dumps(types))
        for t in types:
            if t not in d['cdc']:
                request.db.execute("INSERT INTO cdc (demande_id, type, data, complet, updated_at) VALUES (?,?,'{}',0,?)", (did, t, D.now_iso()))
        for t in list(d['cdc']):
            if t not in types:
                request.db.execute("DELETE FROM cdc WHERE demande_id=? AND type=?", (did, t))
    if sets:
        sets.append('updated_at=?')
        vals.append(D.now_iso())
        vals.append(did)
        request.db.execute("UPDATE demandes SET " + ', '.join(sets) + " WHERE id=?", vals)
    request.db.commit()
    return jsonify(demande_full(request.db, did))


def _set_statut(db, did, statut):
    db.execute("UPDATE demandes SET statut=?, updated_at=? WHERE id=?", (statut, D.now_iso(), did))


# — CDC (pages précalibrage / emballage) —
@app.route('/api/demandes/<did>/cdc/<ctype>')
@require()
def cdc_get(did, ctype):
    d, err = load_demande_or_403(did)
    if err:
        return err
    row = D.q1(request.db, "SELECT * FROM cdc WHERE demande_id=? AND type=?", (did, ctype))
    if not row:
        return jsonify({'error': 'Ce type de CDC ne fait pas partie de la demande.'}), 404
    return jsonify({'type': ctype, 'complet': bool(row['complet']), 'updated_at': row['updated_at'],
                    'data': D.jl(row['data'], {}),
                    'demande': {k: d[k] for k in ('id', 'numero', 'titre', 'statut', 'client_nom', 'client_pays',
                                                  'commercial_nom', 'commercial_email', 'produits', 'varietes',
                                                  'tonnage_annuel', 'tonnage_horaire', 'temps_travail', 'description',
                                                  'retour_souhaite')}})


@app.route('/api/demandes/<did>/cdc/<ctype>', methods=['PUT'])
@require('com')
def cdc_put(did, ctype):
    d, err = load_demande_or_403(did)
    if err:
        return err
    if d['statut'] != 'brouillon' and request.user['role'] != 'admin':
        return jsonify({'error': 'La demande a été envoyée : le CDC est figé.'}), 400
    if ctype not in d['cdc']:
        return jsonify({'error': 'Ce type de CDC ne fait pas partie de la demande.'}), 404
    b = request.get_json(silent=True) or {}
    complet = 1 if b.get('complet') else 0
    request.db.execute("UPDATE cdc SET data=?, complet=?, updated_at=? WHERE demande_id=? AND type=?",
                       (json.dumps(b.get('data') or {}, ensure_ascii=False), complet, D.now_iso(), did, ctype))
    if complet and not d['cdc'][ctype]['complet']:
        journal_add(request.db, did, CDC_TYPES[ctype]['label'] + ' complété.')
    request.db.execute("UPDATE demandes SET updated_at=? WHERE id=?", (D.now_iso(), did))
    request.db.commit()
    return jsonify({'ok': True, 'complet': bool(complet)})


# — Transitions —
@app.route('/api/demandes/<did>/envoyer', methods=['POST'])
@require('com')
def demande_envoyer(did):
    d, err = load_demande_or_403(did)
    if err:
        return err
    if d['statut'] != 'brouillon':
        return jsonify({'error': 'Cette demande a déjà été envoyée.'}), 400
    manquants = [CDC_TYPES[t]['label'] for t in d['cdc_types'] if not d['cdc'].get(t, {}).get('complet')]
    if manquants:
        return jsonify({'error': "Impossible d'envoyer : CDC incomplet(s) — " + ', '.join(manquants) + '.'}), 400
    ts = D.now_iso()
    request.db.execute("UPDATE demandes SET statut='envoyee', envoyee_le=?, updated_at=? WHERE id=?", (ts, ts, did))
    journal_add(request.db, did, 'CDC complet — demande envoyée aux implantations.')
    corps = ("Nouvelle demande D-%04d : %s\nClient : %s (%s)\nCommercial : %s\nCDC : %s\nRetour souhaité : %s\n\n%s" %
             (d['numero'], d['titre'], d['client_nom'], d['client_pays'] or '—', d['commercial_nom'],
              ', '.join(CDC_TYPES[t]['label'] for t in d['cdc_types']), d['retour_souhaite'] or '—', d['description']))
    notify(request.db, 'Nouvelle demande D-%04d — %s' % (d['numero'], d['client_nom']), corps, did, dest_role='impl')
    request.db.commit()
    return jsonify(demande_full(request.db, did))


@app.route('/api/demandes/<did>/prendre', methods=['POST'])
@require('impl')
def demande_prendre(did):
    d, err = load_demande_or_403(did)
    if err:
        return err
    if d['statut'] not in ('envoyee', 'en_implantation', 'refusee'):
        return jsonify({'error': "Cette demande n'est pas à prendre en charge."}), 400
    request.db.execute("UPDATE demandes SET implanteur=?, statut='en_implantation', updated_at=? WHERE id=?",
                       (request.user['username'], D.now_iso(), did))
    journal_add(request.db, did, 'Prise en charge par l\'implantation (%s).' % request.user['display_name'])
    notify(request.db, 'D-%04d prise en charge par l\'implantation' % d['numero'],
           'La demande D-%04d (%s) est en cours d\'implantation par %s.' % (d['numero'], d['titre'], request.user['display_name']),
           did, dest_user=d['commercial'])
    request.db.commit()
    return jsonify(demande_full(request.db, did))


def _next_indice(plans):
    if not plans:
        return 'A'
    last = plans[-1]['indice']
    return chr(ord(last[0]) + 1) if len(last) == 1 and 'A' <= last[0] < 'Z' else last + '+'


@app.route('/api/demandes/<did>/plans', methods=['POST'])
@require('impl')
def plan_ajouter(did):
    d, err = load_demande_or_403(did)
    if err:
        return err
    if d['statut'] not in ('envoyee', 'en_implantation', 'refusee'):
        return jsonify({'error': 'Impossible d\'ajouter un plan dans l\'état « %s ».' % d['statut_label']}), 400
    b = request.get_json(silent=True) or {}
    indice = (b.get('indice') or _next_indice(d['plans'])).strip().upper()
    if any(p['indice'] == indice for p in d['plans']):
        return jsonify({'error': 'L\'indice %s existe déjà.' % indice}), 400
    pid = D.new_id('pl')
    request.db.execute("""INSERT INTO plans (id, demande_id, indice, fichier, commentaire, statut, cree_par, cree_le)
                          VALUES (?,?,?,?,?,'brouillon',?,?)""",
                       (pid, did, indice, (b.get('fichier') or '').strip(), (b.get('commentaire') or '').strip(),
                        request.user['username'], D.now_iso()))
    request.db.execute("UPDATE demandes SET statut='en_implantation', implanteur=COALESCE(NULLIF(implanteur,''),?), updated_at=? WHERE id=?",
                       (request.user['username'], D.now_iso(), did))
    journal_add(request.db, did, 'Plan indice %s ajouté%s.' % (indice, (' — ' + b['fichier']) if b.get('fichier') else ''))
    request.db.commit()
    return jsonify(demande_full(request.db, did)), 201


@app.route('/api/demandes/<did>/plans/<pid>', methods=['PUT'])
@require('impl')
def plan_modifier(did, pid):
    d, err = load_demande_or_403(did)
    if err:
        return err
    p = next((x for x in d['plans'] if x['id'] == pid), None)
    if not p:
        return jsonify({'error': 'Plan introuvable'}), 404
    if p['statut'] not in ('brouillon', 'refuse'):
        return jsonify({'error': 'Ce plan est en validation ou validé : il n\'est plus modifiable.'}), 400
    b = request.get_json(silent=True) or {}
    request.db.execute("UPDATE plans SET fichier=?, commentaire=? WHERE id=?",
                       ((b.get('fichier') if b.get('fichier') is not None else p['fichier']).strip(),
                        (b.get('commentaire') if b.get('commentaire') is not None else p['commentaire']).strip(), pid))
    request.db.execute("UPDATE demandes SET updated_at=? WHERE id=?", (D.now_iso(), did))
    request.db.commit()
    return jsonify(demande_full(request.db, did))


@app.route('/api/demandes/<did>/envoyer-validation', methods=['POST'])
@require('impl')
def demande_envoyer_validation(did):
    d, err = load_demande_or_403(did)
    if err:
        return err
    if d['statut'] not in ('en_implantation', 'refusee'):
        return jsonify({'error': 'La demande n\'est pas en implantation.'}), 400
    b = request.get_json(silent=True) or {}
    p = next((x for x in d['plans'] if x['id'] == b.get('plan_id')), None) if b.get('plan_id') else \
        next((x for x in reversed(d['plans']) if x['statut'] == 'brouillon'), None)
    if not p:
        return jsonify({'error': 'Aucun plan en brouillon à envoyer : ajouter d\'abord un indice.'}), 400
    if p['statut'] != 'brouillon':
        return jsonify({'error': 'Ce plan a déjà été soumis.'}), 400
    if b.get('commentaire') is not None:
        request.db.execute("UPDATE plans SET commentaire=? WHERE id=?", (b['commentaire'].strip(), p['id']))
    request.db.execute("UPDATE plans SET statut='a_valider' WHERE id=?", (p['id'],))
    _set_statut(request.db, did, 'a_valider')
    journal_add(request.db, did, 'Plan indice %s envoyé en validation à la direction technique.' % p['indice'])
    notify(request.db, 'Plan à valider — D-%04d %s (indice %s)' % (d['numero'], d['client_nom'], p['indice']),
           'Le plan indice %s de la demande D-%04d (%s — %s) attend votre validation.\nImplantation : %s\nCommentaire : %s' %
           (p['indice'], d['numero'], d['client_nom'], d['titre'], request.user['display_name'],
            (b.get('commentaire') or p['commentaire'] or '—')), did, dest_role='dt')
    request.db.commit()
    return jsonify(demande_full(request.db, did))


@app.route('/api/demandes/<did>/valider', methods=['POST'])
@require('dt')
def demande_valider(did):
    d, err = load_demande_or_403(did)
    if err:
        return err
    p = next((x for x in d['plans'] if x['statut'] == 'a_valider'), None)
    if d['statut'] != 'a_valider' or not p:
        return jsonify({'error': 'Cette demande n\'est pas dans la file de validation.'}), 400
    note = ((request.get_json(silent=True) or {}).get('note') or '').strip()
    ts = D.now_iso()
    request.db.execute("UPDATE plans SET statut='valide', note_dt=?, decide_le=?, decide_par=? WHERE id=?",
                       (note, ts, request.user['username'], p['id']))
    request.db.execute("UPDATE demandes SET statut='validee', validee_le=?, updated_at=? WHERE id=?", (ts, ts, did))
    journal_add(request.db, did, 'Plan indice %s validé par la direction technique%s' % (p['indice'], (' — ' + note) if note else '.'))
    corps = 'Le plan indice %s de la demande D-%04d (%s — %s) est validé.%s' % (
        p['indice'], d['numero'], d['client_nom'], d['titre'], ('\nCommentaire DT : ' + note) if note else '')
    notify(request.db, 'Plan validé — D-%04d %s' % (d['numero'], d['client_nom']),
           corps + '\nVous pouvez présenter le plan au client et lancer le chiffrage.', did, dest_user=d['commercial'])
    notify(request.db, 'Plan validé — D-%04d %s' % (d['numero'], d['client_nom']), corps, did, dest_role='impl')
    request.db.commit()
    return jsonify(demande_full(request.db, did))


@app.route('/api/demandes/<did>/refuser', methods=['POST'])
@require('dt')
def demande_refuser(did):
    d, err = load_demande_or_403(did)
    if err:
        return err
    p = next((x for x in d['plans'] if x['statut'] == 'a_valider'), None)
    if d['statut'] != 'a_valider' or not p:
        return jsonify({'error': 'Cette demande n\'est pas dans la file de validation.'}), 400
    note = ((request.get_json(silent=True) or {}).get('note') or '').strip()
    if not note:
        return jsonify({'error': 'Un refus doit être motivé : indiquer ce que l\'implantation doit reprendre.'}), 400
    ts = D.now_iso()
    request.db.execute("UPDATE plans SET statut='refuse', note_dt=?, decide_le=?, decide_par=? WHERE id=?",
                       (note, ts, request.user['username'], p['id']))
    _set_statut(request.db, did, 'refusee')
    journal_add(request.db, did, 'Plan indice %s refusé par la direction technique : %s' % (p['indice'], note))
    notify(request.db, 'Plan refusé — D-%04d %s (indice %s)' % (d['numero'], d['client_nom'], p['indice']),
           'Le plan indice %s de la demande D-%04d (%s — %s) est renvoyé à l\'implantation.\nMotif : %s' %
           (p['indice'], d['numero'], d['client_nom'], d['titre'], note), did, dest_role='impl')
    request.db.commit()
    return jsonify(demande_full(request.db, did))


@app.route('/api/demandes/<did>/devis', methods=['POST'])
@require('com')
def demande_devis(did):
    d, err = load_demande_or_403(did)
    if err:
        return err
    if d['statut'] not in ('validee', 'chiffree'):
        return jsonify({'error': 'Le chiffrage nécessite un plan validé.'}), 400
    devis = ((request.get_json(silent=True) or {}).get('devis') or '').strip().upper()
    if not devis:
        return jsonify({'error': 'N° de devis requis.'}), 400
    request.db.execute("UPDATE demandes SET devis=?, statut='chiffree', updated_at=? WHERE id=?", (devis, D.now_iso(), did))
    journal_add(request.db, did, 'Chiffrage déclaré — devis ' + devis + '.')
    request.db.commit()
    return jsonify(demande_full(request.db, did))


@app.route('/api/demandes/<did>/archiver', methods=['POST'])
@require('com', 'impl')
def demande_archiver(did):
    d, err = load_demande_or_403(did)
    if err:
        return err
    flag = 0 if d['archive'] else 1
    request.db.execute("UPDATE demandes SET archive=?, updated_at=? WHERE id=?", (flag, D.now_iso(), did))
    journal_add(request.db, did, 'Demande archivée.' if flag else 'Demande désarchivée.')
    request.db.commit()
    return jsonify(demande_full(request.db, did))


@app.route('/api/demandes/<did>/commentaire', methods=['POST'])
@require()
def demande_commentaire(did):
    """Message libre dans le journal (tous rôles) — échanges entre commercial, implantation et DT."""
    d, err = load_demande_or_403(did)
    if err:
        return err
    txt = ((request.get_json(silent=True) or {}).get('texte') or '').strip()
    if not txt:
        return jsonify({'error': 'Message vide.'}), 400
    journal_add(request.db, did, '💬 ' + txt)
    request.db.execute("UPDATE demandes SET updated_at=? WHERE id=?", (D.now_iso(), did))
    request.db.commit()
    return jsonify(demande_full(request.db, did))


# ─── Statistiques (tableau de bord) ──────────────────────────────────
@app.route('/api/stats')
@require()
def api_stats():
    u = request.user
    where, params = "archive=0", []
    if u['role'] == 'com':
        where += " AND commercial=?"
        params.append(u['username'])
    elif u['role'] == 'impl':
        where += " AND statut<>'brouillon'"
    rows = D.q(request.db, "SELECT statut, COUNT(*) n FROM demandes WHERE " + where + " GROUP BY statut", params)
    return jsonify({r['statut']: r['n'] for r in rows})


# ─── Pages statiques ─────────────────────────────────────────────────
@app.route('/')
def root():
    db = D.get_db()
    u = current_user(db)
    db.close()
    if not u:
        return redirect('/login')
    target = ROLE_HOME[u['role']]
    if request.args.get('d'):
        target += '?d=' + request.args['d']
    return redirect(target)


@app.route('/login')
def login_page():
    return send_from_directory(STATIC, 'login.html')


@app.route('/<role>/')
def role_index(role):
    folder = {'commercial': 'commercial', 'implantation': 'implantation', 'direction': 'direction', 'admin': 'admin'}.get(role)
    if not folder:
        abort(404)
    db = D.get_db()
    u = current_user(db)
    db.close()
    if not u:
        return redirect('/login')
    return send_from_directory(os.path.join(STATIC, folder), 'index.html')


@app.route('/static/<path:path>')
def static_files(path):
    return send_from_directory(STATIC, path)


@app.route('/cdc/<path:path>')
def cdc_files(path):
    db = D.get_db()
    u = current_user(db)
    db.close()
    if not u:
        return redirect('/login')
    return send_from_directory(os.path.join(STATIC, 'cdc'), path)


# ─── Données de démarrage ────────────────────────────────────────────
def seed():
    """Base vide → jeu de démonstration déterministe (demo.py), identique sur tous les PC.
    DEMO=0 dans l'environnement → seulement le compte admin/admin."""
    db = D.get_db()
    if D.q1(db, "SELECT 1 FROM users LIMIT 1"):
        db.close()
        return
    if os.environ.get('DEMO', '1') != '0':
        import demo
        demo.generer(db)
        print('[init] Jeu de demonstration charge — comptes : admin, com1, com2, impl1, impl2, dt1 (mot de passe = identifiant)')
    else:
        db.execute("INSERT INTO users VALUES (?,?,?,?,?,1,?)",
                   ('admin', generate_password_hash('admin'), 'Administrateur', 'admin', '', D.now_iso()))
        db.commit()
        print('[init] Base vide initialisee avec le seul compte admin/admin')
    db.close()


D.init_schema()
seed()

if __name__ == '__main__':
    host = os.environ.get('HOST', '0.0.0.0')
    port = int(os.environ.get('PORT', '5000'))
    print('[start] Gestionnaire - http://localhost:%d  (Ctrl+C pour arrêter)' % port)
    app.run(host=host, port=port, debug=os.environ.get('DEBUG', '0') == '1', threaded=True)
