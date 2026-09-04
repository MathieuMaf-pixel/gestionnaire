# -*- coding: utf-8 -*-
"""
Couche base de données du Gestionnaire — SQLite (fichier unique, zéro installation).

Pour passer en production (MariaDB / PostgreSQL), seule cette couche change :
- get_db()      : ouverture de connexion
- SCHEMA        : DDL (types SQLite → types du SGBD cible)
- q() / q1()    : exécution de requêtes (placeholders « ? »)
"""
import os
import sqlite3
import json
import time
from datetime import datetime

DATA_DIR = os.environ.get('DATA_DIR', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data'))
DB_PATH = os.path.join(DATA_DIR, 'gestionnaire.db')

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    username      TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL DEFAULT '',
    role          TEXT NOT NULL DEFAULT 'com',      -- com | impl | dt | admin
    email         TEXT NOT NULL DEFAULT '',
    actif         INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
    id          TEXT PRIMARY KEY,
    nom         TEXT NOT NULL,
    pays        TEXT NOT NULL DEFAULT '',
    ville       TEXT NOT NULL DEFAULT '',
    commercial  TEXT NOT NULL,                      -- username du commercial
    contact     TEXT NOT NULL DEFAULT '',
    notes       TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS demandes (
    id              TEXT PRIMARY KEY,
    numero          INTEGER NOT NULL,                -- numéro lisible (D-0001)
    client_id       TEXT NOT NULL,
    titre           TEXT NOT NULL,
    commercial      TEXT NOT NULL,                   -- username
    statut          TEXT NOT NULL DEFAULT 'brouillon',
    produits        TEXT NOT NULL DEFAULT '',
    varietes        TEXT NOT NULL DEFAULT '',
    tonnage_annuel  TEXT NOT NULL DEFAULT '',
    tonnage_horaire TEXT NOT NULL DEFAULT '',
    temps_travail   TEXT NOT NULL DEFAULT '',
    description     TEXT NOT NULL DEFAULT '',
    retour_souhaite TEXT NOT NULL DEFAULT '',        -- date JJ/MM/AAAA
    cdc_types       TEXT NOT NULL DEFAULT '[]',      -- JSON ["precalibrage","emballage"]
    implanteur      TEXT NOT NULL DEFAULT '',        -- username impl qui a pris en charge
    devis           TEXT NOT NULL DEFAULT '',
    archive         INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    envoyee_le      TEXT,
    validee_le      TEXT
);

CREATE TABLE IF NOT EXISTS cdc (
    demande_id  TEXT NOT NULL,
    type        TEXT NOT NULL,                       -- precalibrage | emballage
    data        TEXT NOT NULL DEFAULT '{}',          -- état JSON complet de la page CDC
    complet     INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (demande_id, type)
);

CREATE TABLE IF NOT EXISTS plans (
    id            TEXT PRIMARY KEY,
    demande_id    TEXT NOT NULL,
    indice        TEXT NOT NULL,                     -- A, B, C…
    fichier       TEXT NOT NULL DEFAULT '',          -- nom du DWG / PDF
    commentaire   TEXT NOT NULL DEFAULT '',          -- commentaire implantation pour la DT
    statut        TEXT NOT NULL DEFAULT 'brouillon', -- brouillon | a_valider | valide | refuse
    note_dt       TEXT NOT NULL DEFAULT '',
    cree_par      TEXT NOT NULL DEFAULT '',
    cree_le       TEXT NOT NULL,
    decide_le     TEXT,
    decide_par    TEXT
);

CREATE TABLE IF NOT EXISTS journal (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    demande_id  TEXT NOT NULL,
    ts          TEXT NOT NULL,
    acteur      TEXT NOT NULL,
    role        TEXT NOT NULL,
    texte       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          TEXT NOT NULL,
    dest_role   TEXT NOT NULL DEFAULT '',            -- rôle destinataire (ou vide)
    dest_user   TEXT NOT NULL DEFAULT '',            -- utilisateur destinataire (ou vide)
    sujet       TEXT NOT NULL,
    corps       TEXT NOT NULL DEFAULT '',
    demande_id  TEXT,
    lu_par      TEXT NOT NULL DEFAULT '[]'           -- JSON liste des usernames ayant lu
);

CREATE INDEX IF NOT EXISTS idx_demandes_com ON demandes(commercial);
CREATE INDEX IF NOT EXISTS idx_demandes_statut ON demandes(statut);
CREATE INDEX IF NOT EXISTS idx_journal_dem ON journal(demande_id);
CREATE INDEX IF NOT EXISTS idx_plans_dem ON plans(demande_id);
"""


def now_iso():
    return datetime.now().strftime('%Y-%m-%dT%H:%M:%S')


def today_fr():
    return datetime.now().strftime('%d/%m/%Y')


def new_id(prefix):
    return prefix + '_' + str(int(time.time() * 1000)) + '%03d' % (int.from_bytes(os.urandom(2), 'big') % 1000)


def get_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


def init_schema():
    db = get_db()
    db.executescript(SCHEMA)
    db.commit()
    db.close()


def q(db, sql, params=()):
    """SELECT multiple → liste de dicts."""
    return [dict(r) for r in db.execute(sql, params).fetchall()]


def q1(db, sql, params=()):
    """SELECT unique → dict ou None."""
    r = db.execute(sql, params).fetchone()
    return dict(r) if r else None


def jl(s, default=None):
    try:
        return json.loads(s) if s else (default if default is not None else [])
    except Exception:
        return default if default is not None else []
