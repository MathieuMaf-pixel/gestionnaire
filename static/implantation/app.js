/* ============================================================
   Gestionnaire MAF — interface IMPLANTATION
   Vues : À traiter (nouvelles + refusées) · En cours · En validation · Terminées · Boîte mail (test)
   ============================================================ */
'use strict';

const S = { vue: 'atraiter', demandes: [], openId: null, filtre: '' };

async function reload() {
  S.demandes = await GET('/api/demandes');
  setTabCount('atraiter', S.demandes.filter(d => d.statut === 'envoyee').length, 'warn');
  setTabCount('reprise', S.demandes.filter(d => d.statut === 'refusee').length, 'bad');
  setTabCount('encours', S.demandes.filter(d => d.statut === 'en_implantation').length, '');
  if (S.openId) {
    const cur = S.demandes.find(d => d.id === S.openId);
    if (cur && $('#app .dhead') && cur.updated_at !== S.openUpdated) await ouvrirDemande(S.openId, true);
  } else render();
}
G.onTick = reload;

function setVue(v) { S.vue = v; S.openId = null; setActiveTab(v); render(); }

const VUES = {
  atraiter: { titre: 'Demandes à traiter', lead: 'Nouvelles demandes envoyées par les commerciaux, CDC complet. Prendre en charge pour commencer le plan.', f: d => d.statut === 'envoyee' },
  reprise: { titre: 'Plans refusés — à reprendre', lead: 'La direction technique a refusé le dernier indice : lire le motif, produire un nouvel indice et renvoyer en validation.', f: d => d.statut === 'refusee' },
  encours: { titre: 'Plans en cours', lead: 'Demandes prises en charge, plan en préparation.', f: d => d.statut === 'en_implantation' },
  validation: { titre: 'En attente de validation DT', lead: 'Plans envoyés à la direction technique.', f: d => d.statut === 'a_valider' },
  terminees: { titre: 'Plans validés', lead: 'Demandes dont le plan est validé (présentation client / chiffrage côté commercial).', f: d => ['validee', 'chiffree'].includes(d.statut) },
};

function render() {
  const app = $('#app');
  if (S.vue === 'mails') return renderMails(app);
  const v = VUES[S.vue];
  const rows = filtrer(S.demandes.filter(v.f), S.filtre);
  app.innerHTML = `<div class="kicker">Implantation</div><h2 class="page">${v.titre}</h2><p class="lead">${v.lead}</p>
    <div class="row between mb"><input class="search" id="q" placeholder="Rechercher client, projet, commercial…" value="${esc(S.filtre)}"></div>
    ${tableDemandes(rows, [COL.num, COL.client, COL.titre, COL.com, COL.statut, COL.indice, COL.retour, COL.impl, COL.maj],
      ['N°', 'Client', 'Projet', 'Commercial', 'Statut', 'Indice', 'Retour souhaité', 'Implanteur', 'Mise à jour'], ouvrirDemande, 'Rien à afficher dans cette vue.')}`;
  $('#q').oninput = e => { S.filtre = e.target.value; render(); $('#q').focus(); $('#q').setSelectionRange(1e4, 1e4); };
}

async function renderMails(app) {
  const mails = await GET('/api/mails');
  app.innerHTML = `<div class="kicker">Test</div><h2 class="page">Boîte mail factice</h2>
    <p class="lead">En mode test (MAIL_MODE=file), les mails ne sont pas envoyés : ils sont écrits dans <code>data/mails/</code> et affichés ici. En production, le service info branche le SMTP.</p>
    ${mails.length ? mails.map(m => `<div class="panel" style="margin-top:10px"><div class="mono muted">${esc(m.fichier)}</div><pre style="white-space:pre-wrap;font-family:var(--font);margin:8px 0 0">${esc(m.contenu)}</pre></div>`).join('') : '<div class="empty">Aucun mail pour le moment.</div>'}`;
}

/* ---------- Fiche ---------- */
async function ouvrirDemande(id) {
  const d = await GET('/api/demandes/' + id);
  S.openId = id; S.openUpdated = d.updated_at;
  const brouillon = [...d.plans].reverse().find(p => p.statut === 'brouillon');
  const refuse = [...d.plans].reverse().find(p => p.statut === 'refuse');
  const peutTravailler = ['envoyee', 'en_implantation', 'refusee'].includes(d.statut);
  renderDemandeDetail(d, {
    onBack: () => { S.openId = null; render(); },
    onRefresh: nd => { S.openUpdated = nd.updated_at; ouvrirDemande(id); },
    cdcEditable: false,
    actionsHtml: d => {
      const b = [];
      if (d.statut === 'envoyee' || (peutTravailler && !d.implanteur)) b.push(`<button class="btn" id="aPrendre">✋ Prendre en charge</button>`);
      if (peutTravailler) b.push(`<button class="btn ${d.statut === 'envoyee' ? 'grey' : ''}" id="aPlan">＋ Nouvel indice</button>`);
      if (peutTravailler && brouillon) b.push(`<button class="btn dark" id="aValid">➤ Envoyer en validation (indice ${esc(brouillon.indice)})</button>`);
      if (['validee', 'chiffree'].includes(d.statut)) b.push(`<button class="btn grey" id="aArch">${d.archive ? 'Désarchiver' : 'Archiver'}</button>`);
      return b.join('');
    },
    alerteHtml: d => {
      if (d.statut === 'refusee' && refuse) return `<div class="alertbar mb"><span>↩</span><div><b>Indice ${esc(refuse.indice)} refusé par la direction technique :</b> ${nl2br(refuse.note_dt)}<br><span class="muted small">Créer un nouvel indice puis le renvoyer en validation.</span></div></div>`;
      if (d.statut === 'a_valider') return `<div class="alertbar turbo mb"><span>⏳</span><div><b>En attente de la direction technique.</b> Le plan sera validé ou renvoyé avec un motif.</div></div>`;
      if (d.statut === 'validee') return `<div class="alertbar ok mb"><span>✓</span><div><b>Plan validé.</b> Le commercial a été prévenu.</div></div>`;
      return '';
    },
    plansActions: p => (p.statut === 'brouillon' && peutTravailler) ? `<button class="btn grey sm" data-editp="${p.id}">✎</button>` : '',
  });
  const pr = $('#aPrendre'); if (pr) pr.onclick = async () => { await POST(`/api/demandes/${d.id}/prendre`, {}, 'Demande prise en charge ✓'); ouvrirDemande(id); reload(); };
  const ap = $('#aPlan'); if (ap) ap.onclick = () => editerPlan(d, null);
  $$('[data-editp]').forEach(b => b.onclick = () => editerPlan(d, d.plans.find(p => p.id === b.dataset.editp)));
  const av = $('#aValid'); if (av) av.onclick = () => modal({
    title: `Envoyer l'indice ${brouillon.indice} en validation`,
    body: `<p>La direction technique recevra une notification et un mail. Le plan ne sera plus modifiable tant que la décision n'est pas rendue.</p>
      <div class="field"><label>Commentaire pour la direction technique</label><textarea id="vComm">${esc(brouillon.commentaire)}</textarea></div>`,
    okLabel: 'Envoyer en validation', okClass: 'dark',
    onOk: async () => { await POST(`/api/demandes/${d.id}/envoyer-validation`, { plan_id: brouillon.id, commentaire: $('#vComm').value }, 'Plan envoyé en validation ✓'); ouvrirDemande(id); reload(); }
  });
  const ar = $('#aArch'); if (ar) ar.onclick = async () => { await POST(`/api/demandes/${d.id}/archiver`); S.openId = null; reload(); };
}

function editerPlan(d, p) {
  modal({
    title: p ? `Modifier l'indice ${p.indice}` : 'Nouvel indice de plan',
    body: `${p ? '' : `<div class="field"><label>Indice</label><input id="pInd" placeholder="Automatique (A, B, C…) si vide" maxlength="3"></div>`}
      <div class="field"><label>Fichier du plan (nom du DWG / PDF)</label><input id="pFic" value="${esc(p?.fichier || '')}" placeholder="Ex : CLIENT-A_precal_indA.dwg"><div class="hint">Le fichier reste sur le réseau ; on note ici son nom pour le retrouver. Un dépôt de fichier viendra plus tard.</div></div>
      <div class="field"><label>Commentaire pour la direction technique</label><textarea id="pComm">${esc(p?.commentaire || '')}</textarea></div>`,
    okLabel: p ? 'Enregistrer' : 'Créer l\'indice',
    onOk: async () => {
      if (p) await PUT(`/api/demandes/${d.id}/plans/${p.id}`, { fichier: $('#pFic').value, commentaire: $('#pComm').value }, 'Plan modifié ✓');
      else await POST(`/api/demandes/${d.id}/plans`, { indice: $('#pInd').value, fichier: $('#pFic').value, commentaire: $('#pComm').value }, 'Indice créé ✓');
      ouvrirDemande(d.id); reload();
    }
  });
}

/* ---------- Démarrage ---------- */
(async () => {
  if (!await bootCommon(['impl'])) return;
  renderHeader({
    title: 'Gestionnaire · Implantation', subtitle: 'Demandes reçues, plans et validation technique',
    tabs: [{ id: 'atraiter', label: 'À traiter', on: true }, { id: 'reprise', label: 'À reprendre' }, { id: 'encours', label: 'En cours' },
           { id: 'validation', label: 'En validation' }, { id: 'terminees', label: 'Validées' }, { id: 'mails', label: '✉ Boîte mail (test)' }],
    onTab: setVue
  });
  await reload();
  const d = new URLSearchParams(location.search).get('d');
  if (d) { history.replaceState(null, '', location.pathname); ouvrirDemande(d); }
})();
