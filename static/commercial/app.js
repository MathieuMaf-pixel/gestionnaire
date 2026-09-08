/* ============================================================
   Gestionnaire MAF — interface COMMERCIAL (v2)
   ------------------------------------------------------------
   Modèle : client → demandes → CDC → plans → devis.
   Entrées : Portefeuille (arbre client → année → projet + tuiles + carte,
   portefeuille.js) · À faire · Carte des clients (carte.js) · Demandes
   (kanban par statut ou tableau). Fiche client, fiche demande
   réordonnée autour de la prochaine action. Routage par URL (#/…).
   API inchangée : tout se dérive côté navigateur.
   ============================================================ */
'use strict';

const S = {
  demandes: [], clients: [], archives: null,
  details: {},                 // id → fiche complète {d, at}   (cache, invalidé par updated_at)
  q: '', fStatut: '', vue: 'kanban', archOn: false,
  route: { name: 'portefeuille' },
};
const STALE_J = 15;            // « sans mouvement » au-delà de N jours

/* ============================================================
   Routage
   ============================================================ */
function parseHash() {
  const h = (location.hash || '#/portefeuille').replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const seg = path.split('/').filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  const name = seg[0] || 'portefeuille';
  return { name, id: seg[1] ? decodeURIComponent(seg[1]) : null, params };
}
function nav(hash) { if (location.hash === hash) render(); else location.hash = hash; }
window.addEventListener('hashchange', () => { S.route = parseHash(); render(); });

/* Appelé par les notifications (api.js) et les liens externes */
window.ouvrirDemande = id => nav('#/demande/' + encodeURIComponent(id));

/* ============================================================
   Données
   ============================================================ */
async function reload() {
  const [dem, cli, arc] = await Promise.all([GET('/api/demandes'), GET('/api/clients'), GET('/api/demandes?archive=1')]);
  S.demandes = dem; S.clients = cli; S.archives = arc;
  // brouillons : la complétude des CDC n'est pas dans la liste → fiche détaillée (peu nombreuses, en cache)
  await Promise.all(dem.filter(d => d.statut === 'brouillon' && d.cdc_complet == null).map(d => detail(d.id)));
  majCompteurs();
  // signature des données : le rafraîchissement périodique ne redessine que si quelque chose a bougé
  const sig = dem.concat(arc).map(d => d.id + d.updated_at + d.statut + d.archive).join('|') + '#' + cli.map(c => c.id + c.nom + c.lat + c.lng + (c.fruits || []).length).join('|');
  const changed = sig !== S.sig; S.sig = sig; return changed;
}
async function detail(id, force) {
  const l = S.demandes.find(d => d.id === id);
  const c = S.details[id];
  if (!force && c && (!l || c.d.updated_at === l.updated_at)) return c.d;
  const d = await GET('/api/demandes/' + encodeURIComponent(id));
  S.details[id] = { d, at: Date.now() };
  return d;
}
function majCompteurs() {
  const t = todo();
  setTabCount('aujourdhui', t.actions.length, t.actions.some(x => x.late) ? 'bad' : '');
}
G.onTick = async () => {
  const changed = await reload();
  if (!changed) return;
  if (document.activeElement && document.activeElement.classList.contains('search')) return;   // ne pas couper une saisie
  render();
};

/* ============================================================
   Logique métier dérivée
   ============================================================ */
const ORDRE = ['brouillon', 'envoyee', 'en_implantation', 'refusee', 'a_valider', 'validee', 'chiffree'];
const dateFR = s => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s || ''); return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null; };
const jours = iso => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : 0;
const cdcComplet = d => (d.cdc_types || []).every(t => d.cdc && d.cdc[t] && d.cdc[t].complet);

function enRetard(d) {
  const r = dateFR(d.retour_souhaite);
  return !!r && r < new Date() && !['validee', 'chiffree'].includes(d.statut);
}
function sansMouvement(d) { return d.statut !== 'chiffree' && !d.archive && jours(d.updated_at) >= STALE_J; }

/* Prochaine action : {type: 'act'|'wait'|'done', label, sub, href?, btn?} */
function prochaine(d) {
  const det = S.details[d.id] && S.details[d.id].d;
  switch (d.statut) {
    case 'brouillon': {
      if ((det && cdcComplet(det)) || (!det && d.cdc_complet === 1)) return { type: 'act', label: 'Envoyer aux implantations', sub: 'Tous les CDC sont complets', btn: 'envoyer' };
      const t = (d.cdc_types || []).find(x => !(det && det.cdc && det.cdc[x] && det.cdc[x].complet)) || (d.cdc_types || [])[0];
      const info = t && G.cfg.cdc_types[t];
      return { type: 'act', label: 'Compléter le ' + (info ? info.label : 'CDC'), sub: 'Le CDC doit être complet avant envoi',
        href: info ? `${info.page}?demande=${encodeURIComponent(d.id)}` : null };
    }
    case 'envoyee': return { type: 'wait', label: 'En attente de prise en charge', sub: 'Chez les implantations depuis ' + ageJours(d.envoyee_le || d.updated_at) };
    case 'en_implantation': return { type: 'wait', label: 'Plan en cours d\'implantation', sub: (d.implanteur_nom ? d.implanteur_nom + ' · ' : '') + 'mise à jour ' + ageJours(d.updated_at) };
    case 'a_valider': return { type: 'wait', label: 'Plan en validation DT', sub: (d.dernier_indice ? 'Indice ' + d.dernier_indice + ' · ' : '') + 'depuis ' + ageJours(d.updated_at) };
    case 'refusee': return { type: 'act', label: 'Plan refusé — motif à lire', sub: 'L\'implantation reprend le plan ; informer le client si besoin', btn: 'voir' };
    case 'validee': return { type: 'act', label: 'Déclarer le chiffrage', sub: 'Plan validé' + (d.validee_le ? ' le ' + fmtD(d.validee_le) : '') + ' — présenter au client et chiffrer', btn: 'devis' };
    case 'chiffree': return { type: 'done', label: 'Chiffrée', sub: d.devis ? 'Devis ' + d.devis : '' };
  }
  return { type: 'wait', label: d.statut_label || d.statut, sub: '' };
}

function todo() {
  const live = S.demandes.filter(d => !d.archive);
  const actions = [], attente = [], signaux = [];
  live.forEach(d => {
    const p = prochaine(d);
    const late = enRetard(d), stale = sansMouvement(d);
    if (p.type === 'act') actions.push({ d, p, late, stale });
    else if (p.type === 'wait') attente.push({ d, p, late, stale });
    if (late || stale) signaux.push({ d, p, late, stale });
  });
  const tri = (a, b) => (b.late - a.late) || (b.stale - a.stale) || (new Date(a.d.updated_at) - new Date(b.d.updated_at));
  actions.sort(tri); attente.sort(tri); signaux.sort(tri);
  return { actions, attente, signaux };
}

/* ============================================================
   Rendu
   ============================================================ */
function render() {
  const r = S.route, app = $('#app');
  const tab = { portefeuille: 'portefeuille', aujourdhui: 'aujourdhui', clients: 'clients', client: 'clients', demandes: 'demandes', demande: 'demandes', nouvelle: 'nouvelle' }[r.name] || 'portefeuille';
  setActiveTab(tab);
  window.scrollTo(0, 0);
  if (r.name === 'aujourdhui') return renderAujourdhui(app);
  if (r.name === 'clients') return (typeof renderCarte === 'function' ? renderCarte(app) : renderClients(app));
  if (r.name === 'client') return renderClient(app, r.id);
  if (r.name === 'demandes') return renderDemandes(app);
  if (r.name === 'demande') return renderDemande(app, r.id);
  if (r.name === 'nouvelle') return renderNouvelle(app, r.params.client || null);
  return typeof renderPortefeuille === 'function' ? renderPortefeuille(app) : renderAujourdhui(app);
}

const btnNouvelle = (client) => `<a class="btn" href="#/nouvelle${client ? '?client=' + encodeURIComponent(client) : ''}">＋ Nouvelle demande</a>`;
const ageCourt = iso => { const j = jours(iso); return j <= 0 ? 'auj.' : j === 1 ? 'hier' : j + ' j'; };

/* ---------- AUJOURD'HUI ---------- */
function renderAujourdhui(app) {
  const t = todo();
  const li = (x, cls) => `<li class="${cls} ${x.late ? 'late' : x.stale ? 'stale' : ''}" data-id="${x.d.id}">
      <div><div class="who"><b>${esc(x.d.client_nom)}</b> · ${esc(x.d.titre)} <span class="mono muted">${numero(x.d)}</span></div>
        <div class="what">${esc(x.p.label)}${x.p.sub ? ' — ' + esc(x.p.sub) : ''}
        ${x.late ? ` · <span class="badge red">retour souhaité ${esc(x.d.retour_souhaite)} dépassé</span>` : ''}
        ${x.stale ? ` · <span class="badge orange">sans mouvement ${jours(x.d.updated_at)} j</span>` : ''}</div></div>
      <div class="act">${badgeStatut(x.d.statut)}${x.p.href ? `<a class="btn sm" href="${x.p.href}" data-stop>${esc(x.p.label)}</a>`
        : x.p.type === 'act' ? `<a class="btn ghost sm" href="#/demande/${encodeURIComponent(x.d.id)}">Ouvrir →</a>` : `<span class="age">${ageCourt(x.d.updated_at)}</span>`}</div>
    </li>`;
  const sec = (titre, rows, cls, vide) => `<div class="todo-sec"><h3>${titre} <span class="badge ${rows.length ? (cls === 'wait' ? 'blue' : cls === 'signal' ? 'orange' : 'green') : 'grey'}">${rows.length}</span></h3>
    ${rows.length ? `<ul class="todo">${rows.map(x => li(x, cls)).join('')}</ul>` : `<div class="todo"><div class="empty-line">${vide}</div></div>`}</div>`;

  const nbLive = S.demandes.filter(d => !d.archive).length;
  app.innerHTML = `
    <div class="ptools"><div><div class="kicker">Commercial</div><h2 class="page" style="margin:0">Aujourd'hui</h2></div><div class="spacer"></div>
      <span class="muted small kpis">${nbLive} demande${nbLive > 1 ? 's' : ''} en cours · ${S.clients.length} client${S.clients.length > 1 ? 's' : ''}</span>${btnNouvelle()}</div>
    ${sec('Mes actions', t.actions, 'mine', 'Rien à faire de votre côté — tout est chez les implantations ou la DT.')}
    ${sec('En attente des autres', t.attente, 'wait', 'Aucune demande en attente.')}
    ${sec('Signaux', t.signaux, 'signal', `Aucun retard, aucune demande sans mouvement depuis ${STALE_J} jours.`)}`;
  lierLignes(app);
}
function lierLignes(root) {
  root.querySelectorAll('[data-id]').forEach(el => el.onclick = e => {
    if (e.target.closest('[data-stop]')) return;
    nav('#/demande/' + encodeURIComponent(el.dataset.id));
  });
}

/* ---------- CLIENTS ---------- */
function demandesDuClient(c) {
  // client_id si l'API le fournit (v0.2), sinon repli sur le nom
  return S.demandes.filter(d => d.client_id ? d.client_id === c.id : d.client_nom === c.nom);
}
function renderClients(app) {
  const q = S.q.toLowerCase();
  const rows = S.clients.filter(c => !q || (c.nom + ' ' + c.pays + ' ' + c.ville + ' ' + c.contact).toLowerCase().includes(q));
  app.innerHTML = `
    <div class="ptools"><div><div class="kicker">Commercial</div><h2 class="page" style="margin:0">Clients</h2></div>
      <input class="search" id="q" placeholder="Rechercher un client, un pays, un contact…" value="${esc(S.q)}">
      <button class="btn grey" id="btnNewC">＋ Nouveau client</button></div>
    ${rows.length ? `<table class="grid"><thead><tr><th>Client</th><th>Lieu</th><th>Contact</th><th>En cours</th><th>À faire</th><th>Dernière activité</th><th></th></tr></thead><tbody>
      ${rows.map(c => {
        const ds = demandesDuClient(c).filter(d => !d.archive);
        const nbAct = ds.filter(d => prochaine(d).type === 'act').length;
        const last = ds.map(d => d.updated_at).sort().pop();
        return `<tr data-cid="${c.id}"><td><b>${esc(c.nom)}</b>${c.notes ? `<div class="muted small">${esc(c.notes).slice(0, 80)}${c.notes.length > 80 ? '…' : ''}</div>` : ''}</td>
          <td>${[c.pays, c.ville].filter(Boolean).map(esc).join(' · ') || '—'}</td><td>${esc(c.contact) || '<span class="muted">—</span>'}</td>
          <td class="c">${ds.length || '<span class="muted">0</span>'}</td>
          <td class="c">${nbAct ? `<span class="badge green">${nbAct}</span>` : '<span class="muted">—</span>'}</td>
          <td class="muted small">${last ? fmtD(last) + '<br>' + ageJours(last) : '—'}</td>
          <td class="c"><a class="btn sm" href="#/nouvelle?client=${encodeURIComponent(c.id)}" data-stop>＋ Demande</a></td></tr>`;
      }).join('')}</tbody></table>` : '<div class="empty">Aucun client — créer votre premier client.</div>'}`;
  lierRecherche();
  $('#btnNewC').onclick = () => editerClient(null, c => nav('#/client/' + encodeURIComponent(c.id)));
  app.querySelectorAll('tr[data-cid]').forEach(tr => tr.onclick = e => { if (e.target.closest('[data-stop]')) return; nav('#/client/' + encodeURIComponent(tr.dataset.cid)); });
}
function lierRecherche() {
  const q = $('#q'); if (!q) return;
  q.oninput = () => { S.q = q.value; Promise.resolve(render()).then(() => { const e = $('#q'); if (e && document.activeElement !== e) { e.focus(); e.setSelectionRange(1e4, 1e4); } }); };
}

async function renderClient(app, id) {
  const c = S.clients.find(x => x.id === id);
  if (!c) { app.innerHTML = `<div class="empty">Client introuvable.</div>`; return; }
  const ds = demandesDuClient(c).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const live = ds.filter(d => !d.archive), arch = ds.filter(d => d.archive);
  const nbAct = live.filter(d => prochaine(d).type === 'act').length;
  const last = ds.map(d => d.updated_at).sort().pop();

  app.innerHTML = `
    <div class="row between mb"><a class="btn grey" href="#/clients">← Clients</a></div>
    <div class="chead"><div><div class="kicker">Client${c.activite ? ' · ' + esc(c.activite) : ''}</div><h2>${esc(c.nom)}</h2>
        <div class="sub">${[c.adresse, [c.cp, c.ville].filter(Boolean).join(' '), c.dept ? '(' + c.dept + ')' : '', c.pays && c.pays !== 'France' ? c.pays : ''].filter(Boolean).map(esc).join(' · ') || 'Lieu non renseigné'}</div>
        <div class="sub">${[c.contact, c.tel, c.email].filter(Boolean).map(esc).join(' · ') || '<span class="muted">Aucun contact renseigné</span>'}</div></div>
      <div class="head-actions"><button class="btn grey" id="cEdit">✎ Modifier</button>${btnNouvelle(c.id)}</div></div>
    <div class="cstats">
      <div class="cstat"><div class="l">Demandes en cours</div><div class="v">${live.length}</div></div>
      <div class="cstat"><div class="l">À faire</div><div class="v">${nbAct}</div></div>
      <div class="cstat"><div class="l">Chiffrées</div><div class="v">${ds.filter(d => d.statut === 'chiffree').length}</div></div>
      <div class="cstat"><div class="l">Dernière activité</div><div class="v" style="font-size:16px">${last ? fmtD(last) : '—'}</div></div>
    </div>
    <div class="layout">
      <div>
        <div class="panel"><h3>Demandes</h3>
          ${live.length ? `<table class="grid"><thead><tr><th>N°</th><th>Projet</th><th>Statut</th><th>Prochaine action</th><th>Indice</th><th>Mise à jour</th></tr></thead><tbody>
            ${live.map(d => { const p = prochaine(d); return `<tr data-id="${d.id}"><td class="mono">${numero(d)}</td>
              <td>${esc(d.titre)}<div class="muted small">${(d.cdc_types || []).map(t => G.cfg.cdc_types[t]?.label || t).join(' · ')}</div></td>
              <td>${badgeStatut(d.statut)}</td>
              <td><span class="${p.type === 'act' ? '' : 'muted'}">${esc(p.label)}</span>${enRetard(d) ? ' <span class="badge red">retard</span>' : ''}</td>
              <td class="c">${d.dernier_indice ? `<span class="vname">${esc(d.dernier_indice)}</span>` : '<span class="muted">—</span>'}</td>
              <td class="muted small">${fmtD(d.updated_at)}<br>${ageJours(d.updated_at)}</td></tr>`; }).join('')}</tbody></table>`
            : `<div class="empty">Aucune demande en cours pour ce client. ${btnNouvelle(c.id)}</div>`}
          ${arch.length ? `<details class="mt"><summary class="muted small" style="cursor:pointer">${arch.length} demande${arch.length > 1 ? 's' : ''} archivée${arch.length > 1 ? 's' : ''}</summary>
            <table class="grid mt"><tbody>${arch.map(d => `<tr data-id="${d.id}"><td class="mono">${numero(d)}</td><td>${esc(d.titre)}</td><td>${badgeStatut(d.statut)}</td><td>${esc(d.devis) || '—'}</td><td class="muted small">${fmtD(d.updated_at)}</td></tr>`).join('')}</tbody></table></details>` : ''}
        </div>
        <div class="panel"><h3>Activité récente</h3><div id="cTimeline" class="muted small">Chargement…</div></div>
      </div>
      <div>
        <div class="panel"><h3>Production</h3>${(c.fruits || []).length ? `<table class="grid"><thead><tr><th>Produit</th><th>Volume annuel</th></tr></thead><tbody>${c.fruits.slice().sort((a, b) => (b.volume_t || 0) - (a.volume_t || 0)).map(f =>
          `<tr style="cursor:default"><td><span class="fr-ico">${typeof iconeProduit === 'function' ? iconeProduit(f.produit, 22) : ''}</span>${esc(typeof nomProduit === 'function' ? nomProduit(f.produit) : f.produit)}</td><td class="num">${f.volume_t ? fmtNb(f.volume_t) + ' t' : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table>
          ${c.fruits.some(f => f.volume_t) ? `<div class="muted small mt">Total ${fmtNb(c.fruits.reduce((a, f) => a + (f.volume_t || 0), 0))} t/an</div>` : ''}`
          : '<div class="muted">Aucun produit renseigné — « Modifier » pour ajouter ce que le client cultive et ses volumes.</div>'}</div>
        <div class="panel"><h3>Localisation</h3>${(typeof c.lat === 'number' && typeof c.lng === 'number') ? '<div id="miniMap" class="mini-carte"></div>' : `<div class="muted">Pas de coordonnées. <button class="btn ghost sm" id="cGeo">⌖ Géocoder l'adresse (réseau)</button></div>`}</div>
        <div class="panel"><h3>Notes</h3>${c.notes ? `<div class="notes">${esc(c.notes)}</div>` : '<div class="muted">Aucune note. « Modifier » pour en ajouter : contexte, interlocuteurs, historique de la relation.</div>'}</div>
      </div>
    </div>`;
  $('#cEdit').onclick = () => editerClient(c, () => render());
  if (typeof miniCarte === 'function') miniCarte($('#miniMap'), c);
  const cg = $('#cGeo'); if (cg) cg.onclick = async () => {
    cg.disabled = true; cg.textContent = 'Recherche…';
    try { const p = await geocoder(c); if (!p) { toast('Adresse introuvable — préciser l\'adresse ou la ville.', true); cg.disabled = false; cg.textContent = '⌖ Géocoder l\'adresse (réseau)'; return; }
      await PUT('/api/clients/' + c.id, { lat: p.lat, lng: p.lng }, 'Client géolocalisé ✓'); S.clients = await GET('/api/clients'); render(); }
    catch (e) { toast('Géocodage impossible (réseau ?)', true); cg.disabled = false; cg.textContent = '⌖ Géocoder l\'adresse (réseau)'; }
  };
  lierLignes(app);

  // journal agrégé des 8 demandes les plus récentes
  const recent = ds.slice(0, 8);
  const dets = await Promise.all(recent.map(d => detail(d.id).catch(() => null)));
  const ev = [];
  dets.forEach(d => { if (d) d.journal.forEach(j => ev.push({ ts: j.ts, d, j })); });
  ev.sort((a, b) => b.ts.localeCompare(a.ts));
  const tl = $('#cTimeline'); if (!tl) return;
  tl.className = '';
  tl.innerHTML = ev.length ? `<ul class="timeline">${ev.slice(0, 25).map(e => `<li><span class="when">${fmtDT(e.ts)}</span>
      <span><a class="dnum" href="#/demande/${encodeURIComponent(e.d.id)}">${numero(e.d)}</a><b>${esc(e.j.acteur)}</b> <span class="muted small">· ${esc(e.j.role)}</span><br>${nl2br(e.j.texte)}</span></li>`).join('')}</ul>`
    : '<div class="muted">Aucune activité.</div>';
}

function editerClient(c, onDone) {
  const prods = typeof listeProduits === 'function' ? listeProduits() : [];
  const optsProd = sel => `<option value="">— produit —</option>` + prods.map(p => `<option value="${esc(p.k)}" ${sel === p.k ? 'selected' : ''}>${esc(p.nom)}</option>`).join('');
  const ligneFruit = (f) => `<div class="fr-row"><select class="fr-p">${optsProd(f ? f.produit : '')}</select><input class="fr-v" type="number" step="1" min="0" placeholder="t/an" value="${f && f.volume_t != null ? f.volume_t : ''}"><span class="muted small">t/an</span><button type="button" class="btn ghost sm fr-del" title="Retirer">✕</button></div>`;
  const fruits = (c && c.fruits) || [];
  modal({
    title: c ? 'Modifier le client' : 'Nouveau client',
    body: `<div class="field"><label>Nom du client <span class="req">*</span></label><input id="cNom" value="${esc(c?.nom || '')}"></div>
      <div class="grid2">
        <div class="field"><label>Activité</label><input id="cAct" list="actList" value="${esc(c?.activite || '')}" placeholder="Station, coopérative, producteur…"><datalist id="actList"><option>Station fruitière</option><option>Coopérative</option><option>Producteur-expéditeur</option><option>Expéditeur / grossiste</option><option>Industriel</option><option>Distributeur</option></datalist></div>
        <div class="field"><label>Pays</label><input id="cPays" value="${esc(c?.pays || 'France')}"></div>
      </div>
      <div class="field sugg-wrap"><label>Adresse <span class="muted small">— saisir, les propositions arrivent en direct (réseau)</span></label><input id="cAdr" autocomplete="off" value="${esc(c?.adresse || '')}" placeholder="N° et voie, ou une ville"><div class="sugg hidden" id="cAdrSugg"></div></div>
      <div class="grid3">
        <div class="field"><label>Code postal</label><input id="cCp" value="${esc(c?.cp || '')}"></div>
        <div class="field"><label>Ville</label><input id="cVille" value="${esc(c?.ville || '')}"></div>
        <div class="field"><label>Département</label><input id="cDept" value="${esc(c?.dept || '')}" placeholder="auto depuis le CP"></div>
      </div>
      <div class="grid3">
        <div class="field"><label>Contact (nom, fonction)</label><input id="cContact" value="${esc(c?.contact || '')}"></div>
        <div class="field"><label>Téléphone</label><input id="cTel" value="${esc(c?.tel || '')}"></div>
        <div class="field"><label>Email</label><input id="cMail" type="email" value="${esc(c?.email || '')}"></div>
      </div>
      <div class="field"><label>Production <span class="muted small">— ce que le client cultive ou conditionne, volumes annuels</span></label>
        <div id="frList">${fruits.map(ligneFruit).join('')}</div>
        <button type="button" class="btn ghost sm mt" id="frAdd">＋ Ajouter un produit</button></div>
      <div class="grid3">
        <div class="field"><label>Latitude</label><input id="cLat" value="${c && c.lat != null ? c.lat : ''}" placeholder="44.02"></div>
        <div class="field"><label>Longitude</label><input id="cLng" value="${c && c.lng != null ? c.lng : ''}" placeholder="1.35"></div>
        <div class="field"><label>&nbsp;</label><button type="button" class="btn grey" id="cGeoBtn">⌖ Géocoder (réseau)</button></div>
      </div>
      <div class="field"><label>Notes</label><textarea id="cNotes" rows="4">${esc(c?.notes || '')}</textarea></div>`,
    okLabel: c ? 'Enregistrer' : 'Créer le client',
    onOk: async () => {
      const fr = $$('#frList .fr-row').map(r => ({ produit: r.querySelector('.fr-p').value, volume_t: r.querySelector('.fr-v').value })).filter(f => f.produit);
      const body = { nom: $('#cNom').value, activite: $('#cAct').value, pays: $('#cPays').value, adresse: $('#cAdr').value, cp: $('#cCp').value, ville: $('#cVille').value,
        dept: $('#cDept').value, contact: $('#cContact').value, tel: $('#cTel').value, email: $('#cMail').value, notes: $('#cNotes').value,
        lat: $('#cLat').value, lng: $('#cLng').value, fruits: fr };
      if (!body.nom.trim()) { toast('Le nom du client est obligatoire.', true); return false; }
      const r = c ? await PUT('/api/clients/' + c.id, body, 'Client modifié ✓') : await POST('/api/clients', body, 'Client créé ✓');
      S.clients = await GET('/api/clients');
      if (onDone) onDone(r); else render();
    }
  });
  const lierFr = () => $$('#frList .fr-del').forEach(b => b.onclick = () => { b.closest('.fr-row').remove(); });
  lierFr();
  $('#frAdd').onclick = () => { $('#frList').insertAdjacentHTML('beforeend', ligneFruit(null)); lierFr(); };
  if (typeof autocompleteAdresse === 'function') autocompleteAdresse($('#cAdr'), $('#cAdrSugg'), {
    pays: () => $('#cPays').value,
    onPick: r => { $('#cAdr').value = r.adresse || ''; $('#cCp').value = r.cp || ''; $('#cVille').value = r.ville || ''; $('#cDept').value = r.dept || '';
      if (r.pays && !$('#cPays').value.trim()) $('#cPays').value = r.pays; $('#cLat').value = r.lat.toFixed(5); $('#cLng').value = r.lng.toFixed(5); toast('Adresse et coordonnées renseignées ✓'); }
  });
  $('#cCp').oninput = () => { const cp = $('#cCp').value.trim(); if (/^\d{5}$/.test(cp) && !$('#cDept').value) $('#cDept').value = cp.startsWith('20') ? (cp < '20200' ? '2A' : '2B') : cp.slice(0, 2); };
  $('#cGeoBtn').onclick = async () => {
    const b = $('#cGeoBtn'); b.disabled = true; b.textContent = 'Recherche…';
    try { const p = await geocoder({ adresse: $('#cAdr').value, cp: $('#cCp').value, ville: $('#cVille').value, pays: $('#cPays').value });
      if (p) { $('#cLat').value = p.lat.toFixed(5); $('#cLng').value = p.lng.toFixed(5); toast('Coordonnées trouvées ✓'); } else toast('Adresse introuvable.', true); }
    catch (e) { toast('Géocodage impossible (réseau ?)', true); }
    b.disabled = false; b.textContent = '⌖ Géocoder (réseau)';
  };
}

/* ---------- DEMANDES : kanban / tableau ---------- */
async function renderDemandes(app) {
  if (S.archOn && !S.archives) S.archives = await GET('/api/demandes?archive=1');
  const base = S.archOn ? (S.archives || []) : S.demandes.filter(d => !d.archive);
  const rows = filtrer(base, S.q);
  const counts = {}; base.forEach(d => counts[d.statut] = (counts[d.statut] || 0) + 1);

  app.innerHTML = `
    <div class="ptools"><div><div class="kicker">Commercial</div><h2 class="page" style="margin:0">Demandes</h2></div>
      <input class="search" id="q" placeholder="Rechercher client, projet, n°, produit…" value="${esc(S.q)}">
      <div class="seg" role="group" aria-label="Vue"><button class="${S.vue === 'kanban' ? 'on' : ''}" data-vue="kanban">Kanban</button><button class="${S.vue === 'tableau' ? 'on' : ''}" data-vue="tableau">Tableau</button></div>
      <button class="chip ${S.archOn ? 'on' : ''}" id="archOn">Archives</button>
      ${btnNouvelle()}</div>
    ${S.vue === 'tableau' ? `<div class="chips mb">${ORDRE.filter(s => counts[s]).map(s => `<button class="chip ${S.fStatut === s ? 'on' : ''}" data-st="${s}">${esc(G.cfg.statuts[s]?.label || s)}<span class="n">${counts[s]}</span></button>`).join('')}
      ${S.fStatut ? `<button class="chip" data-st="">✕ tout</button>` : ''}</div>` : ''}
    <div id="body"></div>`;

  const body = $('#body');
  if (S.vue === 'kanban') {
    body.innerHTML = `<div class="kanban">${ORDRE.map(s => {
      const st = G.cfg.statuts[s] || { label: s, cls: 'grey' };
      const col = rows.filter(d => d.statut === s).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      return `<div class="kcol c-${st.cls}"><div class="kh"><span>${esc(st.label)}</span><span class="n">${col.length}</span></div>
        ${col.length ? col.map(carte).join('') : '<div class="kempty">—</div>'}</div>`;
    }).join('')}</div>`;
  } else {
    const shown = rows.filter(d => !S.fStatut || d.statut === S.fStatut).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    body.innerHTML = shown.length ? `<table class="grid"><thead><tr><th>N°</th><th>Client</th><th>Projet</th><th>Statut</th><th>Prochaine action</th><th>Indice</th><th>Retour souhaité</th><th>Devis</th><th>Mise à jour</th></tr></thead>
      <tbody>${shown.map(d => { const p = prochaine(d); return `<tr data-id="${d.id}"><td class="mono">${numero(d)}</td>
        <td><b>${esc(d.client_nom)}</b>${d.client_pays ? `<div class="muted small">${esc(d.client_pays)}</div>` : ''}</td>
        <td>${esc(d.titre)}<div class="muted small">${(d.cdc_types || []).map(t => G.cfg.cdc_types[t]?.label || t).join(' · ')}</div></td>
        <td>${badgeStatut(d.statut)}</td>
        <td><span class="${p.type === 'act' ? '' : 'muted'}">${esc(p.label)}</span></td>
        <td class="c">${d.dernier_indice ? `<span class="vname">${esc(d.dernier_indice)}</span>` : '<span class="muted">—</span>'}</td>
        <td>${d.retour_souhaite ? `${esc(d.retour_souhaite)}${enRetard(d) ? ' <span class="badge red">dépassé</span>' : ''}` : '<span class="muted">—</span>'}</td>
        <td>${esc(d.devis) || '<span class="muted">—</span>'}</td>
        <td class="muted small">${fmtDT(d.updated_at)}<br>${ageJours(d.updated_at)}</td></tr>`; }).join('')}</tbody></table>`
      : `<div class="empty">${S.archOn ? 'Aucune archive.' : 'Aucune demande — créer une nouvelle demande.'}</div>`;
  }
  lierRecherche(); lierLignes(body);
  $$('.seg button[data-vue]').forEach(b => b.onclick = () => { S.vue = b.dataset.vue; render(); });
  $$('.chip[data-st]').forEach(b => b.onclick = () => { S.fStatut = b.dataset.st; render(); });
  $('#archOn').onclick = () => { S.archOn = !S.archOn; S.archives = null; render(); };
}
function carte(d) {
  const p = prochaine(d), late = enRetard(d), stale = sansMouvement(d);
  return `<div class="kcard ${late ? 'late' : stale ? 'stale' : p.type === 'act' ? 'act' : ''}" data-id="${d.id}">
    <div class="kn"><span>${numero(d)}</span><span class="age">${ageCourt(d.updated_at)}</span></div>
    <div class="kc">${esc(d.client_nom)}</div>
    <div class="kt">${esc(d.titre)}</div>
    <div class="km">${d.dernier_indice ? `<span class="vname">${esc(d.dernier_indice)}</span>` : ''}
      ${late ? '<span class="badge red">retard</span>' : ''}${stale ? `<span class="badge orange">${jours(d.updated_at)} j</span>` : ''}
      ${p.type === 'act' ? `<span class="badge green">${esc(p.label)}</span>` : ''}</div>
  </div>`;
}

/* ---------- FICHE DEMANDE ---------- */
async function renderDemande(app, id) {
  let d;
  try { d = await detail(id, true); } catch (e) { app.innerHTML = '<div class="empty">Demande introuvable.</div>'; return; }
  const p = prochaine(d), complet = cdcComplet(d), edit = d.statut === 'brouillon';
  const client = S.clients.find(c => c.nom === d.client_nom);
  const dernierPlan = d.plans.length ? d.plans[d.plans.length - 1] : null;
  const refus = d.statut === 'refusee' ? [...d.plans].reverse().find(x => x.statut === 'refuse') : null;

  const go = [];
  if (p.href) go.push(`<a class="btn big" href="${p.href}">${esc(p.label)} →</a>`);
  if (p.btn === 'envoyer') go.push(`<button class="btn big" id="aEnvoyer">✉ Envoyer aux implantations</button>`);
  else if (edit) go.push(`<button class="btn big ghost" id="aEnvoyer" disabled title="Compléter tous les CDC avant envoi">✉ Envoyer aux implantations</button>`);
  if (p.btn === 'devis') go.push(`<button class="btn big" id="aDevis">€ ${d.devis ? 'Modifier le devis' : 'Déclarer le chiffrage'}</button>`);
  if (p.btn === 'voir' && refus) go.push(`<a class="btn big" href="#plans">Voir le motif du refus ↓</a>`);

  const contexte = () => {
    if (edit) return `<div class="panel" id="cdc"><h3>Cahiers des charges</h3>${cdcCardsHtml(d, true)}
      ${complet ? '' : '<div class="hint mt">Le sélecteur fruit & variétés se trouve en page Général du CDC ; l\'envoi se débloque quand chaque CDC est complet.</div>'}</div>`;
    let h = `<div class="panel" id="plans"><h3>Plans d'implantation</h3>${plansHtml(d)}</div>`;
    h += `<div class="panel"><h3>Cahiers des charges</h3>${cdcCardsHtml(d, false)}</div>`;
    return h;
  };

  app.innerHTML = `
    <div class="row between mb"><button class="btn grey" id="btnBack">← Retour</button>
      <div class="row">${badgeStatut(d.statut)} ${d.archive ? '<span class="badge black">Archivée</span>' : ''}</div></div>
    <div class="dhead"><div><div class="num">${numero(d)}</div><h2>${esc(d.titre)}</h2>
      <div class="sub">${client ? `<a href="#/client/${encodeURIComponent(client.id)}"><b>${esc(d.client_nom)}</b></a>` : `<b>${esc(d.client_nom)}</b>`}${d.client_pays ? ' · ' + esc(d.client_pays) : ''}
        · ${esc(d.commercial_nom || d.commercial)}${d.implanteur_nom ? ' · implantation ' + esc(d.implanteur_nom) : ''}</div></div>
      <div class="head-actions">
        ${edit ? `<button class="btn grey sm" id="aEdit">✎ Modifier les infos</button>` : ''}
        ${!edit ? `<button class="btn grey sm" id="aArch">${d.archive ? 'Désarchiver' : 'Archiver'}</button>` : ''}
      </div></div>
    ${stepsHtml(d)}
    <div class="nextact ${p.type === 'act' ? (d.statut === 'refusee' ? 'bad' : '') : p.type}">
      <div><div class="k">${p.type === 'act' ? 'Prochaine action — à vous' : p.type === 'wait' ? 'En attente' : 'Terminé'}</div>
        <div class="t">${esc(p.label)}</div>${p.sub ? `<div class="s">${esc(p.sub)}</div>` : ''}
        ${refus ? `<div class="s"><b>Motif DT :</b> ${nl2br(refus.note_dt) || '<i>sans commentaire</i>'}</div>` : ''}
        ${enRetard(d) ? `<div class="s"><span class="badge red">Retour souhaité ${esc(d.retour_souhaite)} dépassé</span></div>` : ''}</div>
      <div class="go">${go.join('')}</div>
    </div>
    <div class="rappel mb">${d.produits ? `<span>Produits <b>${esc(d.produits)}</b></span>` : ''}${d.varietes ? `<span>· Variétés <b>${esc(d.varietes)}</b></span>` : ''}
      ${d.tonnage_horaire ? `<span>· <b>${esc(d.tonnage_horaire)} T/h</b></span>` : ''}${d.tonnage_annuel ? `<span>· ${esc(d.tonnage_annuel)} T/an</span>` : ''}
      ${d.retour_souhaite ? `<span>· retour souhaité <b>${esc(d.retour_souhaite)}</b></span>` : ''}${dernierPlan ? `<span>· dernier indice <span class="vname">${esc(dernierPlan.indice)}</span></span>` : ''}</div>
    <div class="layout">
      <div>${contexte()}
        <div class="panel"><details class="infos"><summary>Informations de la demande <span class="hint">détail ▾</span></summary>${infosHtml(d)}</details></div>
      </div>
      <div><div class="panel"><h3>Journal</h3>${journalHtml(d)}</div></div>
    </div>`;

  $('#btnBack').onclick = () => { if (history.length > 1 && document.referrer !== '') history.back(); else nav('#/demandes'); };
  const send = async () => { const t = $('#jMsg').value.trim(); if (!t) return; await POST(`/api/demandes/${d.id}/commentaire`, { texte: t }); await detail(id, true); render(); };
  $('#jSend').onclick = send; $('#jMsg').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  const ae = $('#aEnvoyer'); if (ae) ae.onclick = () => confirmer('Envoyer aux implantations',
    `La demande <b>${numero(d)}</b> et son CDC vont être transmis aux implantations (mail automatique). Les informations et le CDC ne seront plus modifiables.`,
    async () => { await POST(`/api/demandes/${d.id}/envoyer`, {}, 'Demande envoyée aux implantations ✓'); await reload(); render(); }, 'Envoyer');
  const ed = $('#aEdit'); if (ed) ed.onclick = () => editerDemande(d);
  const dv = $('#aDevis'); if (dv) dv.onclick = () => modal({
    title: 'Chiffrage', body: `<div class="field"><label>N° de devis</label><input id="dvNum" value="${esc(d.devis)}" placeholder="Ex : DV-2026-0123"></div>`,
    okLabel: 'Enregistrer', onOk: async () => { await POST(`/api/demandes/${d.id}/devis`, { devis: $('#dvNum').value }, 'Chiffrage déclaré ✓'); await reload(); render(); }
  });
  const ar = $('#aArch'); if (ar) ar.onclick = async () => { await POST(`/api/demandes/${d.id}/archiver`, {}, d.archive ? 'Désarchivée' : 'Archivée'); S.archives = null; await reload(); nav('#/demandes'); };
}

function editerDemande(d) {
  const iso = d.retour_souhaite ? d.retour_souhaite.split('/').reverse().join('-') : '';
  modal({
    title: 'Modifier la demande ' + numero(d),
    body: `<div class="field"><label>Intitulé</label><input id="eTitre" value="${esc(d.titre)}"></div>
      <div class="grid2"><div class="field"><label>Produits</label><input id="eProduits" value="${esc(d.produits)}"></div>
      <div class="field"><label>Variétés</label><input id="eVarietes" value="${esc(d.varietes)}"></div>
      <div class="field"><label>Tonnage horaire (T/h)</label><input id="eTh" value="${esc(d.tonnage_horaire)}"></div>
      <div class="field"><label>Tonnage annuel</label><input id="eTa" value="${esc(d.tonnage_annuel)}"></div>
      <div class="field"><label>Temps de travail</label><input id="eTt" value="${esc(d.temps_travail)}"></div>
      <div class="field"><label>Retour souhaité</label><input id="eRetour" type="date" value="${iso}"></div></div>
      <div class="field"><label>Description</label><textarea id="eDesc">${esc(d.description)}</textarea></div>
      <div class="field"><label>Cahiers des charges</label><div class="checks">
        ${Object.entries(G.cfg.cdc_types).map(([k, v]) => `<label class="check"><input type="checkbox" value="${k}" ${d.cdc_types.includes(k) ? 'checked' : ''}> ${esc(v.label)}</label>`).join('')}</div>
        <div class="hint">Décocher un CDC supprime sa saisie.</div></div>`,
    okLabel: 'Enregistrer',
    onOk: async () => {
      await PUT('/api/demandes/' + d.id, {
        titre: $('#eTitre').value, produits: $('#eProduits').value, varietes: $('#eVarietes').value, tonnage_horaire: $('#eTh').value,
        tonnage_annuel: $('#eTa').value, temps_travail: $('#eTt').value, description: $('#eDesc').value,
        retour_souhaite: $('#eRetour').value ? $('#eRetour').value.split('-').reverse().join('/') : '',
        cdc_types: $$('#modal .checks input:checked').map(i => i.value)
      }, 'Demande modifiée ✓');
      await reload(); render();
    }
  });
}

/* ---------- NOUVELLE DEMANDE ---------- */
function renderNouvelle(app, preClient) {
  const opts = S.clients.map(c => `<option value="${c.id}" ${preClient === c.id ? 'selected' : ''}>${esc(c.nom)}${c.pays ? ' — ' + esc(c.pays) : ''}</option>`).join('');
  app.innerHTML = `<div class="kicker">Commercial</div><h2 class="page">Nouvelle demande</h2>
    <p class="lead">Le client, le projet, puis le(s) cahier(s) des charges à établir. Le CDC s'ouvre ensuite, prérempli ; le fruit et les variétés s'y choisissent visuellement.</p>
    <div class="layout"><div class="panel">
      <h3>1 · Client & projet</h3>
      <div class="field"><label>Client <span class="req">*</span></label>
        <div class="row"><select id="nClient" style="flex:1">${opts || '<option value="">— aucun client —</option>'}</select><button class="btn grey" id="nNewC">＋ Nouveau client</button></div></div>
      <div class="field"><label>Intitulé du projet <span class="req">*</span></label><input id="nTitre" placeholder="Ex : Nouvelle ligne précalibrage pomme 20 T/h"></div>
      <div class="grid2">
        <div class="field"><label>Tonnage horaire (T/h)</label><input id="nTh" type="number" step="0.1" placeholder="Ex : 10"></div>
        <div class="field"><label>Tonnage annuel (T)</label><input id="nTa" placeholder="Ex : 15 000"></div>
        <div class="field"><label>Temps de travail</label><input id="nTt" placeholder="Ex : 8 h/j, 5 j/7, 6 mois"></div>
        <div class="field"><label>Retour souhaité pour le</label><input id="nRetour" type="date"></div>
        <div class="field"><label>Produits <span class="muted small">(précisé dans le CDC)</span></label><input id="nProduits" placeholder="Pomme, Poire…"></div>
        <div class="field"><label>Variétés <span class="muted small">(précisé dans le CDC)</span></label><input id="nVarietes" placeholder="Gala, Golden…"></div>
      </div>
      <div class="field"><label>Description du projet</label><textarea id="nDesc" placeholder="Contexte, contraintes du bâtiment, attentes du client…"></textarea></div>
      <h3 class="mt">2 · Cahier(s) des charges</h3>
      <div class="checks">${Object.entries(G.cfg.cdc_types).sort(([a], [b]) => (a === 'precalibrage' ? -1 : b === 'precalibrage' ? 1 : 0)).map(([k, v], i) => `<label class="check"><input type="checkbox" value="${k}" ${k === 'precalibrage' || (!G.cfg.cdc_types.precalibrage && i === 0) ? 'checked' : ''}> ${esc(v.label)}</label>`).join('')}</div>
      <div class="row mt" style="justify-content:flex-end"><a class="btn grey" href="#/demandes">Annuler</a><button class="btn" id="nCreate">Créer la demande et ouvrir le CDC →</button></div>
    </div>
    <div><div class="alertbar info"><span>ℹ</span><div><b>Comment ça marche</b><br>La demande est créée en <i>brouillon</i>. Vous complétez chaque CDC (sauvegarde automatique). Quand tout est complet, <b>Envoyer aux implantations</b> apparaît en prochaine action sur la fiche : un mail part et la demande passe à l'implantation.</div></div></div></div>`;
  $('#nNewC').onclick = () => editerClient(null, c => { renderNouvelle(app, c.id); });
  $('#nCreate').onclick = async () => {
    const types = $$('.checks input:checked').map(i => i.value);
    if (!$('#nClient').value) { toast('Choisir un client.', true); return; }
    if (!$('#nTitre').value.trim()) { toast('Donner un intitulé au projet.', true); $('#nTitre').focus(); return; }
    if (!types.length) { toast('Choisir au moins un cahier des charges.', true); return; }
    const retour = $('#nRetour').value ? $('#nRetour').value.split('-').reverse().join('/') : '';
    const d = await POST('/api/demandes', {
      client_id: $('#nClient').value, titre: $('#nTitre').value, produits: $('#nProduits').value, varietes: $('#nVarietes').value,
      tonnage_horaire: $('#nTh').value, tonnage_annuel: $('#nTa').value, temps_travail: $('#nTt').value,
      retour_souhaite: retour, description: $('#nDesc').value, cdc_types: types
    }, 'Demande créée ✓ — compléter le CDC');
    const premier = types.includes('precalibrage') ? 'precalibrage' : types[0];   // le précalibrage s'ouvre en premier
    location.href = `${G.cfg.cdc_types[premier].page}?demande=${encodeURIComponent(d.id)}`;
  };
}

/* ============================================================
   Démarrage
   ============================================================ */
(async () => {
  if (!await bootCommon(['com'])) return;
  renderHeader({
    title: 'Gestionnaire · Espace commercial', subtitle: 'Clients, demandes, cahiers des charges, plans validés, chiffrage',
    tabs: [{ id: 'portefeuille', label: 'Portefeuille', on: true }, { id: 'aujourdhui', label: 'À faire' }, { id: 'clients', label: 'Carte' }, { id: 'demandes', label: 'Demandes' }, { id: 'nouvelle', label: '＋ Nouvelle demande' }],
    onTab: id => { S.q = ''; S.fStatut = ''; nav('#/' + id); }
  });
  // compatibilité : /commercial/?d=<id> (retour depuis une page CDC, liens des mails)
  const legacy = new URLSearchParams(location.search).get('d');
  if (legacy) { history.replaceState(null, '', location.pathname + '#/demande/' + encodeURIComponent(legacy)); }
  S.route = parseHash();
  await reload();
  render();
})();
