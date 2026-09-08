# Test bout en bout de l API (serveur lancé sur localhost:5000, base vide) : python tests/test_api.py
# Dépendance : pip install requests
import requests, json, sys
B = 'http://localhost:5000'
def sess(u):
    s = requests.Session(); r = s.post(B+'/api/login', json={'username':u,'password':u}); assert r.ok, r.text; return s
def check(cond, msg):
    print(('✅ ' if cond else '❌ ') + msg)
    if not cond: sys.exit(1)

com, impl, dt, adm = sess('com1'), sess('impl1'), sess('dt1'), sess('admin')
check(com.get(B+'/api/me').json()['role']=='com', 'login commercial')
# refus d'accès croisé
check(com.get(B+'/api/users').status_code==403, 'com ne voit pas /api/users')
clients = com.get(B+'/api/clients').json(); check(len(clients)>=1 and all(c['commercial']=='com1' for c in clients), 'com1 ne voit que ses clients')
c3 = adm.get(B+'/api/clients').json(); check(len(c3)>len(clients), 'admin voit tous les clients')
nb_avant = len(com.get(B+'/api/demandes').json())
# création demande
r = com.post(B+'/api/demandes', json={'client_id':clients[0]['id'],'titre':'Ligne précalibrage test','produits':'Pomme, Poire','tonnage_horaire':'12','tonnage_annuel':'15000','retour_souhaite':'30/09/2026','cdc_types':['precalibrage','emballage'],'description':'Projet fictif'})
check(r.status_code==201, 'création demande'); d = r.json(); did = d['id']; check(d['statut']=='brouillon' and d['numero']>=1, 'brouillon numéroté')
check(impl.get(B+f'/api/demandes/{did}').status_code==403, 'impl ne voit pas un brouillon')
# envoi impossible (CDC incomplets)
r = com.post(B+f'/api/demandes/{did}/envoyer'); check(r.status_code==400 and 'incomplet' in r.json()['error'], 'envoi bloqué CDC incomplet')
# CDC
r = com.get(B+f'/api/demandes/{did}/cdc/precalibrage'); check(r.ok and r.json()['demande']['client_nom'].startswith('CLIENT A'), 'GET cdc précal préremplissage')
r = com.put(B+f'/api/demandes/{did}/cdc/precalibrage', json={'data':{'v':1,'f':{'7':'CLIENT A'}},'complet':True}); check(r.ok, 'PUT cdc précal complet')
r = com.put(B+f'/api/demandes/{did}/cdc/emballage', json={'data':{'v':1,'f':{'produits':'Pomme'}},'complet':True}); check(r.ok, 'PUT cdc emballage complet')
r = com.post(B+f'/api/demandes/{did}/envoyer'); check(r.ok and r.json()['statut']=='envoyee', 'envoi aux implantations')
check(com.put(B+f'/api/demandes/{did}/cdc/precalibrage', json={'data':{},'complet':True}).status_code==400, 'CDC figé après envoi')
n = impl.get(B+'/api/notifications').json(); check(any(('D-%04d' % d['numero']) in x['sujet'] for x in n), 'notification impl reçue')
mails = impl.get(B+'/api/mails').json(); check(len(mails)>=1 and 'impl1@exemple.local' in mails[0]['contenu'], 'mail factice écrit')
# implantation
check(any(x['id']==did for x in impl.get(B+'/api/demandes').json()), 'impl voit la demande')
r = impl.post(B+f'/api/demandes/{did}/prendre'); check(r.ok and r.json()['statut']=='en_implantation' and r.json()['implanteur']=='impl1', 'prise en charge')
check(dt.post(B+f'/api/demandes/{did}/plans', json={}).status_code==403, 'dt ne peut pas ajouter de plan')
r = impl.post(B+f'/api/demandes/{did}/plans', json={'fichier':'CLIENTA_indA.dwg','commentaire':'Première implantation'}); check(r.status_code==201 and r.json()['plans'][0]['indice']=='A', 'plan indice A')
check(dt.post(B+f'/api/demandes/{did}/valider').status_code==400, 'validation impossible avant envoi')
r = impl.post(B+f'/api/demandes/{did}/envoyer-validation', json={}); check(r.ok and r.json()['statut']=='a_valider', 'envoi en validation')
check(impl.put(B+f"/api/demandes/{did}/plans/{r.json()['plans'][0]['id']}", json={'fichier':'x'}).status_code==400, 'plan figé en validation')
# DT refuse
n = dt.get(B+'/api/notifications').json(); check(any('à valider' in x['sujet'] and ('D-%04d' % d['numero']) in x['sujet'] for x in n), 'notification DT')
check(dt.post(B+f'/api/demandes/{did}/refuser', json={'note':''}).status_code==400, 'refus sans motif bloqué')
r = dt.post(B+f'/api/demandes/{did}/refuser', json={'note':'Manque la zone de stockage palox'}); check(r.ok and r.json()['statut']=='refusee' and r.json()['plans'][0]['statut']=='refuse', 'refus motivé → refusée')
# impl reprend
r = impl.post(B+f'/api/demandes/{did}/plans', json={'fichier':'CLIENTA_indB.dwg'}); check(r.status_code==201 and r.json()['plans'][1]['indice']=='B' and r.json()['statut']=='en_implantation', 'indice B → en implantation')
r = impl.post(B+f'/api/demandes/{did}/envoyer-validation', json={'commentaire':'Zone palox ajoutée'}); check(r.ok and r.json()['statut']=='a_valider', 'renvoi validation B')
r = dt.post(B+f'/api/demandes/{did}/valider', json={'note':'OK pour chiffrage'}); check(r.ok and r.json()['statut']=='validee' and r.json()['plans'][1]['statut']=='valide', 'validation → validee')
n = com.get(B+'/api/notifications').json(); check(any('validé' in x['sujet'] for x in n), 'commercial notifié plan validé')
r = com.post(B+f'/api/demandes/{did}/devis', json={'devis':'DV-2026-001'}); check(r.ok and r.json()['statut']=='chiffree', 'chiffrage déclaré')
r = com.post(B+f'/api/demandes/{did}/commentaire', json={'texte':'Présentation client prévue'}); check(r.ok and r.json()['journal'][-1]['texte'].startswith('💬'), 'message journal')
stats = com.get(B+'/api/stats').json(); check(stats.get('chiffree',0)>=1, 'stats')
r = com.post(B+f'/api/demandes/{did}/archiver'); check(r.ok and r.json()['archive']==1, 'archivage')
check(len(com.get(B+'/api/demandes').json())==nb_avant and any(x['id']==did for x in com.get(B+'/api/demandes?archive=1').json()), 'listes archive')
# com2 ne voit rien de com1
com2 = sess('com2'); check(com2.get(B+f'/api/demandes/{did}').status_code==403, 'cloisonnement commerciaux')
# admin users
r = adm.post(B+'/api/users', json={'username':'test.user','password':'test','role':'impl','display_name':'Test','email':'t@x.local'}); check(r.status_code==201, 'création compte')
r = adm.put(B+'/api/users/test.user', json={'role':'dt','actif':False}); check(r.ok, 'modif compte')
check(requests.post(B+'/api/login', json={'username':'test.user','password':'test'}).status_code==401, 'compte désactivé refusé')
# pages
for p in ['/login','/static/common/maf.css','/static/common/api.js','/static/common/demande.js']: check(requests.get(B+p).ok, 'page '+p)
check(requests.get(B+'/commercial/', allow_redirects=False).status_code==302, 'redirection non connecté')
check(com.get(B+'/commercial/').ok and impl.get(B+'/implantation/').ok and dt.get(B+'/direction/').ok and adm.get(B+'/admin/').ok, 'pages rôles')
check(com.get(B+'/cdc/precalibrage.html').ok and com.get(B+'/cdc/bridge.js').ok and com.get(B+'/cdc/emballage.html').ok, 'pages CDC')
print('\nJournal final :'); [print(' -', j['role'], '|', j['texte']) for j in com.get(B+f'/api/demandes/{did}').json()['journal']]
print('\n🎉 Flux complet OK')
