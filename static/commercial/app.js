/* ============================================================
   Gestionnaire MAF — interface COMMERCIAL
   Vues : Tableau de bord (demandes) · Mes clients · Nouvelle demande · Archives
   ============================================================ */
'use strict';

const S = { vue: 'demandes', demandes: [], clients: [], openId: null, filtre: '', fStatut: '', archives: [] };

/* ---------- Chargement ---------- */
async function reload() {
  const [dem, cli] = await Promise.all([GET('/api/demandes'), GET('/api/clients')]);
  S.demandes = dem; S.clients = cli;
  const aValider = dem.filter(d => d.statut === 'validee').length;
  const brouillons = dem.filter(d => d.statut === 'brouillon').length;
  setTabCount('demandes', aValider, '');
  setTabCount('brouillons', brouillons, 'warn');
  if (S.openId) {
    const cur = dem.find(d => d.id === S.openId);
    if (cur && $('#app .dhead') && cur.updated_at !== S.openUpdated) await ouvrirDemande(S.openId, true);
  } else render();
}
G.onTick = reload;

/* ---------- Navigation ---------- */
function setVue(v) { S.vue = v; S.openId = null; setActiveTab(v); render(); }
function render() {
  const app = $('#app');
  if (S.vue === 'demandes') return renderDemandes(app);
  if (S.vue === 'brouillons') return renderDemandes(app, 'brouillon');
  if (S.vue === 'clients') return renderClients(app);
  if (S.vue === 'nouvelle') return renderNouvelle(app);
  if (S.vue === 'archives') return renderArchives(app);
}

/* ---------- Tableau de bord ---------- */
function renderDemandes(app, only) {
  let rows = S.demandes.filter(d => only ? d.statut === only : d.statut !== 'brouillon');
  const counts = {};
  rows.forEach(d => counts[d.statut] = (counts[d.statut] || 0) + 1);
  const kpi = (id, lbl, cls) => `<div class="kpi ${cls} ${S.fStatut === id ? 'on' : ''}" data-k="${id}"><div class="lbl">${lbl}</div><div class="val">${counts[id] || 0}</div></div>`;
  const shown = filtrer(rows.filter(d => !S.fStatut || d.statut === S.fStatut), S.filtre);
  app.innerHTML = `
    <div class="kicker">Commercial</div><h2 class="page">${only ? 'Brouillons à compléter' : 'Mes demandes en cours'}</h2>
    <p class="lead">${only ? 'Demandes créées mais pas encore envoyées aux implantations : compléter le(s) CDC puis envoyer.' :
      'Suivi de vos demandes depuis l\'envoi du CDC jusqu\'au plan validé. Cliquer une ligne pour ouvrir la fiche.'}</p>
    ${only ? '' : `<div class="kpis">${kpi('envoyee', 'Envoyées', 'b')}${kpi('en_implantation', 'En implantation', 'b')}${kpi('a_valider', 'En validation DT', 'o')}${kpi('refusee', 'Refusées / reprise', 'r')}${kpi('validee', 'Plan validé — à chiffrer', '')}${kpi('chiffree', 'Chiffrées', 'k')}</div>`}
    <div class="row between mb"><input class="search" id="q" placeholder="Rechercher client, projet, n°…" value="${esc(S.filtre)}">
      <div class="row">${S.fStatut ? `<button class="btn grey sm" id="clearF">✕ Filtre ${esc(G.cfg.statuts[S.fStatut]?.label)}</button>` : ''}
      <button class="btn" id="btnNew">＋ Nouvelle demande</button></div></div>
    ${tableDemandes(shown, [COL.num, COL.client, COL.titre, COL.statut, COL.indice, COL.retour, COL.devis, COL.maj],
      ['N°', 'Client', 'Projet', 'Statut', 'Indice', 'Retour souhaité', 'Devis', 'Mise à jour'], ouvrirDemande,
      only ? 'Aucun brouillon.' : 'Aucune demande en cours — créer une nouvelle demande.')}`;
  $('#q').oninput = e => { S.filtre = e.target.value; render(); $('#q').focus(); $('#q').setSelectionRange(1e4, 1e4); };
  $('#btnNew').onclick = () => setVue('nouvelle');
  $$('.kpi[data-k]').forEach(k => k.onclick = () => { S.fStatut = S.fStatut === k.dataset.k ? '' : k.dataset.k; render(); });
  const cf = $('#clearF'); if (cf) cf.onclick = () => { S.fStatut = ''; render(); };
}

async function renderArchives(app) {
  S.archives = await GET('/api/demandes?archive=1');
  app.innerHTML = `<div class="kicker">Commercial</div><h2 class="page">Archives</h2><p class="lead">Demandes archivées (consultables, désarchivables).</p>
    ${tableDemandes(S.archives, [COL.num, COL.client, COL.titre, COL.statut, COL.devis, COL.maj], ['N°', 'Client', 'Projet', 'Statut', 'Devis', 'Mise à jour'], ouvrirDemande, 'Aucune archive.')}`;
}

/* ---------- Clients ---------- */
function renderClients(app) {
  const rows = S.clients.filter(c => !S.filtre || (c.nom + c.pays + c.ville).toLowerCase().includes(S.filtre.toLowerCase()));
  app.innerHTML = `<div class="kicker">Commercial</div><h2 class="page">Mes clients</h2>
    <p class="lead">Les clients dont vous avez la charge. Une demande est toujours rattachée à un client.</p>
    <div class="row between mb"><input class="search" id="q" placeholder="Rechercher un client…" value="${esc(S.filtre)}"><button class="btn" id="btnNewC">＋ Nouveau client</button></div>
    ${rows.length ? `<table class="grid"><thead><tr><th>Client</th><th>Pays</th><th>Ville</th><th>Contact</th><th>Demandes</th><th></th></tr></thead><tbody>
      ${rows.map(c => `<tr data-id="${c.id}"><td><b>${esc(c.nom)}</b></td><td>${esc(c.pays) || '—'}</td><td>${esc(c.ville) || '—'}</td><td>${esc(c.contact) || '—'}</td>
        <td class="c">${c.nb_demandes}</td><td class="c"><button class="btn grey sm" data-edit="${c.id}">Modifier</button> <button class="btn sm" data-new="${c.id}">＋ Demande</button></td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">Aucun client — créer votre premier client.</div>'}`;
  $('#q').oninput = e => { S.filtre = e.target.value; render(); $('#q').focus(); $('#q').setSelectionRange(1e4, 1e4); };
  $('#btnNewC').onclick = () => editerClient(null);
  $$('[data-edit]').forEach(b => b.onclick = e => { e.stopPropagation(); editerClient(S.clients.find(c => c.id === b.dataset.edit)); });
  $$('[data-new]').forEach(b => b.onclick = e => { e.stopPropagation(); S.preClient = b.dataset.new; setVue('nouvelle'); });
  $$('tbody tr[data-id]').forEach(tr => tr.onclick = () => { S.filtre = ''; S.vue = 'demandes'; setActiveTab('demandes'); S.filtre = S.clients.find(c => c.id === tr.dataset.id)?.nom || ''; render(); });
}

function editerClient(c, onDone) {
  modal({
    title: c ? 'Modifier le client' : 'Nouveau client',
    body: `<div class="field"><label>Nom du client <span class="req">*</span></label><input id="cNom" value="${esc(c?.nom || '')}"></div>
      <div class="grid2"><div class="field"><label>Pays</label><input id="cPays" value="${esc(c?.pays || 'France')}"></div>
      <div class="field"><label>Ville</label><input id="cVille" value="${esc(c?.ville || '')}"></div></div>
      <div class="field"><label>Contact (nom, fonction)</label><input id="cContact" value="${esc(c?.contact || '')}"></div>
      <div class="field"><label>Notes</label><textarea id="cNotes">${esc(c?.notes || '')}</textarea></div>`,
    okLabel: c ? 'Enregistrer' : 'Créer le client',
    onOk: async () => {
      const body = { nom: $('#cNom').value, pays: $('#cPays').value, ville: $('#cVille').value, contact: $('#cContact').value, notes: $('#cNotes').value };
      const r = c ? await PUT('/api/clients/' + c.id, body, 'Client modifié ✓') : await POST('/api/clients', body, 'Client créé ✓');
      S.clients = await GET('/api/clients');
      if (onDone) onDone(r); else render();
    }
  });
}

/* ---------- Nouvelle demande ---------- */
function renderNouvelle(app) {
  const opts = S.clients.map(c => `<option value="${c.id}" ${S.preClient === c.id ? 'selected' : ''}>${esc(c.nom)}${c.pays ? ' — ' + esc(c.pays) : ''}</option>`).join('');
  app.innerHTML = `<div class="kicker">Commercial</div><h2 class="page">Nouvelle demande</h2>
    <p class="lead">Renseigner le projet, puis choisir le(s) cahier(s) des charges à établir. Les pages CDC s'ouvriront ensuite, préremplies avec ces informations.</p>
    <div class="layout"><div class="panel">
      <h3>1 · Client & projet</h3>
      <div class="field"><label>Client <span class="req">*</span></label>
        <div class="row"><select id="nClient" style="flex:1">${opts || '<option value="">— aucun client —</option>'}</select><button class="btn grey" id="nNewC">＋ Nouveau client</button></div></div>
      <div class="field"><label>Intitulé du projet <span class="req">*</span></label><input id="nTitre" placeholder="Ex : Nouvelle ligne précalibrage pomme 20 T/h"></div>
      <div class="grid2">
        <div class="field"><label>Produits travaillés</label><input id="nProduits" placeholder="Pomme, Poire…"></div>
        <div class="field"><label>Variétés</label><input id="nVarietes" placeholder="Gala, Golden…"></div>
        <div class="field"><label>Tonnage horaire (T/h)</label><input id="nTh" type="number" step="0.1" placeholder="Ex : 10"></div>
        <div class="field"><label>Tonnage annuel (T)</label><input id="nTa" placeholder="Ex : 15 000"></div>
        <div class="field"><label>Temps de travail</label><input id="nTt" placeholder="Ex : 8 h/j, 5 j/7, 6 mois"></div>
        <div class="field"><label>Retour souhaité pour le</label><input id="nRetour" type="date"></div>
      </div>
      <div class="field"><label>Description du projet</label><textarea id="nDesc" placeholder="Contexte, contraintes du bâtiment, attentes du client…"></textarea></div>
      <h3 class="mt">2 · Cahier(s) des charges</h3>
      <div class="checks">
        <label class="check"><input type="checkbox" value="precalibrage" checked> CDC Précalibrage</label>
        <label class="check"><input type="checkbox" value="emballage"> CDC Emballage</label>
      </div>
      <div class="row mt" style="justify-content:flex-end"><button class="btn grey" id="nCancel">Annuler</button><button class="btn" id="nCreate">Créer la demande et passer aux CDC →</button></div>
    </div>
    <div><div class="alertbar info"><span>ℹ</span><div><b>Comment ça marche</b><br>La demande est créée en <i>brouillon</i>. Vous complétez ensuite chaque CDC (sauvegarde automatique). Quand tous les CDC sont complets, le bouton <b>Envoyer aux implantations</b> apparaît sur la fiche : un mail part automatiquement et la demande passe à l'implantation.</div></div></div></div>`;
  S.preClient = null;
  $('#nNewC').onclick = () => editerClient(null, c => { renderNouvelle(app); $('#nClient').value = c.id; });
  $('#nCancel').onclick = () => setVue('demandes');
  $('#nCreate').onclick = async () => {
    const types = $$('.checks input:checked').map(i => i.value);
    const retour = $('#nRetour').value ? $('#nRetour').value.split('-').reverse().join('/') : '';
    const d = await POST('/api/demandes', {
      client_id: $('#nClient').value, titre: $('#nTitre').value, produits: $('#nProduits').value, varietes: $('#nVarietes').value,
      tonnage_horaire: $('#nTh').value, tonnage_annuel: $('#nTa').value, temps_travail: $('#nTt').value,
      retour_souhaite: retour, description: $('#nDesc').value, cdc_types: types
    }, 'Demande créée ✓ — compléter le CDC');
    S.demandes = await GET('/api/demandes');
    // Ouvrir directement le premier CDC
    location.href = `${G.cfg.cdc_types[types[0]].page}?demande=${encodeURIComponent(d.id)}`;
  };
}

/* ---------- Fiche demande ---------- */
async function ouvrirDemande(id, silent) {
  const d = await GET('/api/demandes/' + id);
  S.openId = id; S.openUpdated = d.updated_at;
  const complet = d.cdc_types.every(t => d.cdc[t]?.complet);
  renderDemandeDetail(d, {
    onBack: () => { S.openId = null; render(); },
    onRefresh: nd => { S.openUpdated = nd.updated_at; ouvrirDemande(id, true); },
    cdcEditable: d.statut === 'brouillon',
    actionsHtml: d => {
      const b = [];
      if (d.statut === 'brouillon') {
        b.push(`<button class="btn grey" id="aEdit">✎ Modifier les infos</button>`);
        b.push(`<button class="btn" id="aEnvoyer" ${complet ? '' : 'disabled title="Compléter tous les CDC avant envoi"'}>✉ Envoyer aux implantations</button>`);
      }
      if (d.statut === 'validee' || d.statut === 'chiffree') b.push(`<button class="btn" id="aDevis">€ ${d.devis ? 'Modifier le devis' : 'Déclarer le chiffrage'}</button>`);
      if (d.statut !== 'brouillon') b.push(`<button class="btn grey" id="aArch">${d.archive ? 'Désarchiver' : 'Archiver'}</button>`);
      return b.join('');
    },
    alerteHtml: d => {
      if (d.statut === 'brouillon' && !complet) return `<div class="alertbar turbo mb"><span>⚠</span><div><b>CDC à compléter.</b> Ouvrir chaque cahier des charges ci-dessous et le terminer ; l'envoi aux implantations se débloque quand tout est complet.</div></div>`;
      if (d.statut === 'brouillon' && complet) return `<div class="alertbar ok mb"><span>✓</span><div><b>CDC complet.</b> Vous pouvez envoyer la demande aux implantations.</div></div>`;
      if (d.statut === 'validee') return `<div class="alertbar ok mb"><span>✓</span><div><b>Plan validé par la direction technique.</b> Vous pouvez présenter le plan au client et lancer le chiffrage.</div></div>`;
      if (d.statut === 'refusee') return `<div class="alertbar mb"><span>↩</span><div><b>Plan refusé par la DT</b> — l'implantation reprend le plan. Détail dans le journal et le tableau des plans.</div></div>`;
      return '';
    }
  });
  const ae = $('#aEnvoyer'); if (ae) ae.onclick = () => confirmer('Envoyer aux implantations',
    `La demande <b>${numero(d)}</b> et son CDC vont être transmis aux implantations (mail automatique). Les informations et le CDC ne seront plus modifiables.`,
    async () => { const nd = await POST(`/api/demandes/${d.id}/envoyer`, {}, 'Demande envoyée aux implantations ✓'); ouvrirDemande(id, true); reload(); }, 'Envoyer');
  const ed = $('#aEdit'); if (ed) ed.onclick = () => editerDemande(d);
  const dv = $('#aDevis'); if (dv) dv.onclick = () => modal({
    title: 'Chiffrage', body: `<div class="field"><label>N° de devis</label><input id="dvNum" value="${esc(d.devis)}" placeholder="Ex : DV-2026-0123"></div>`,
    okLabel: 'Enregistrer', onOk: async () => { await POST(`/api/demandes/${d.id}/devis`, { devis: $('#dvNum').value }, 'Chiffrage déclaré ✓'); ouvrirDemande(id, true); reload(); }
  });
  const ar = $('#aArch'); if (ar) ar.onclick = async () => { await POST(`/api/demandes/${d.id}/archiver`, {}, d.archive ? 'Désarchivée' : 'Archivée'); S.openId = null; reload(); };
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
      ouvrirDemande(d.id, true); reload();
    }
  });
}

/* ---------- Démarrage ---------- */
(async () => {
  if (!await bootCommon(['com'])) return;
  renderHeader({
    title: 'Gestionnaire · Espace commercial', subtitle: 'Mes clients, mes demandes, du CDC au plan validé',
    tabs: [{ id: 'demandes', label: 'Tableau de bord', on: true }, { id: 'brouillons', label: 'Brouillons' }, { id: 'clients', label: 'Mes clients' },
           { id: 'nouvelle', label: '＋ Nouvelle demande' }, { id: 'archives', label: 'Archives' }],
    onTab: setVue
  });
  await reload();
  const d = new URLSearchParams(location.search).get('d');
  if (d) { history.replaceState(null, '', location.pathname); ouvrirDemande(d); }
})();
