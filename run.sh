#!/usr/bin/env bash
# Gestionnaire MAF — serveur local de test (Linux / macOS)
cd "$(dirname "$0")"
python3 -m pip install -q -r requirements.txt
MAIL_MODE=${MAIL_MODE:-file} python3 server.py
