/* ============================================================
   Gestionnaire MAF — interface DIRECTION TECHNIQUE
   Vues : À valider · Historique (validés / refusés) · Toutes les demandes
   ============================================================ */
'use strict';

const S = { vue: 'avalider', demandes: [], openId: null, filtre: '' };

async function reload() {
  S.demandes = await GET('/api/demandes');
  setTabCount('avalider', S.demandes.filter(d => d.statut === 'a_valider').length, 'warn');
  if (S.openId) {
    const cur = S.demandes.find(d => d.id === S.openId);
    if (cur && $('#app .dhead') && cur.updated_at !== S.openUpdated) await ouvrirDemande(S.openId);
  } else render();
}
G.onTick = reload;
function setVue(v) { S.vue = v; S.openId = null; setActiveTab(v); render(); }

const VUES = {
  avalider: { titre: 'Plans à valider', lead: 'Plans envoyés par l\'implantation. Ouvrir la fiche pour valider ou refuser (refus motivé, renvoyé à l\'implantation).', f: d => d.statut === 'a_valider' },
  historique: { titre: 'Décisions rendues', lead: 'Plans validés et demandes chiffrées.', f: d => ['validee', 'chiffree'].includes(d.statut) },
  toutes: { titre: 'Toutes les demandes', lead: 'Vue d\'ensemble, tous statuts (hors archives).', f: () => true },
};

function render() {
  const app = $('#app');
  const v = VUES[S.vue];
  const rows = filtrer(S.demandes.filter(v.f), S.filtre);
  const counts = {}; S.demandes.forEach(d => counts[d.statut] = (counts[d.statut] || 0) + 1);
  const kpi = (id, lbl, cls) => `<div class="kpi ${cls}" style="cursor:default"><div class="lbl">${lbl}</div><div class="val">${counts[id] || 0}</div></div>`;
  app.innerHTML = `<div class="kicker">Direction technique</div><h2 class="page">${v.titre}</h2><p class="lead">${v.lead}</p>
    ${S.vue === 'toutes' ? `<div class="kpis">${kpi('brouillon', 'Brouillons', 'g')}${kpi('envoyee', 'Envoyées', 'b')}${kpi('en_implantation', 'En implantation', 'b')}${kpi('a_valider', 'À valider', 'o')}${kpi('refusee', 'Refusées', 'r')}${kpi('validee', 'Validées', '')}${kpi('chiffree', 'Chiffrées', 'k')}</div>` : ''}
    <div class="row between mb"><input class="search" id="q" placeholder="Rechercher…" value="${esc(S.filtre)}"></div>
    ${tableDemandes(rows, [COL.num, COL.client, COL.titre, COL.com, COL.impl, COL.statut, COL.indice, COL.maj],
      ['N°', 'Client', 'Projet', 'Commercial', 'Implanteur', 'Statut', 'Indice', 'Mise à jour'], ouvrirDemande,
      S.vue === 'avalider' ? 'Aucun plan en attente de validation.' : 'Rien à afficher.')}`;
  $('#q').oninput = e => { S.filtre = e.target.value; render(); $('#q').focus(); $('#q').setSelectionRange(1e4, 1e4); };
}

async function ouvrirDemande(id) {
  const d = await GET('/api/demandes/' + id);
  S.openId = id; S.openUpdated = d.updated_at;
  const enAttente = d.plans.find(p => p.statut === 'a_valider');
  renderDemandeDetail(d, {
    onBack: () => { S.openId = null; render(); },
    onRefresh: nd => { S.openUpdated = nd.updated_at; ouvrirDemande(id); },
    cdcEditable: false,
    actionsHtml: d => d.statut === 'a_valider' && enAttente ?
      `<button class="btn danger" id="aRefus">✕ Refuser (motivé)</button><button class="btn" id="aValider">✓ Valider l'indice ${esc(enAttente.indice)}</button>` : '',
    alerteHtml: d => d.statut === 'a_valider' && enAttente ?
      `<div class="alertbar turbo mb"><span>⏳</span><div><b>Indice ${esc(enAttente.indice)} à valider</b>${enAttente.fichier ? ` — <span class="mono">${esc(enAttente.fichier)}</span>` : ''}.<br>${enAttente.commentaire ? 'Commentaire implantation : ' + nl2br(enAttente.commentaire) : '<span class="muted">Sans commentaire de l\'implantation.</span>'}</div></div>` : '',
  });
  const av = $('#aValider'); if (av) av.onclick = () => modal({
    title: `Valider l'indice ${enAttente.indice}`,
    body: `<p>Le commercial et l'implantation seront notifiés : le plan pourra être présenté au client et chiffré.</p>
      <div class="field"><label>Commentaire (facultatif)</label><textarea id="vNote" placeholder="Remarques, points d'attention pour le chiffrage…"></textarea></div>`,
    okLabel: 'Valider le plan',
    onOk: async () => { await POST(`/api/demandes/${d.id}/valider`, { note: $('#vNote').value }, 'Plan validé ✓'); ouvrirDemande(id); reload(); }
  });
  const ar = $('#aRefus'); if (ar) ar.onclick = () => modal({
    title: `Refuser l'indice ${enAttente.indice}`,
    body: `<p>Le plan est renvoyé à l'implantation, qui produira un nouvel indice. <b>Le motif est obligatoire.</b></p>
      <div class="field"><label>Motif du refus <span class="req">*</span></label><textarea id="rNote" placeholder="Ce qui doit être repris…"></textarea></div>`,
    okLabel: 'Refuser et renvoyer', okClass: 'danger',
    onOk: async () => { await POST(`/api/demandes/${d.id}/refuser`, { note: $('#rNote').value }, 'Plan refusé — renvoyé à l\'implantation'); ouvrirDemande(id); reload(); }
  });
}

(async () => {
  if (!await bootCommon(['dt'])) return;
  renderHeader({
    title: 'Gestionnaire · Direction technique', subtitle: 'Validation des plans d\'implantation',
    tabs: [{ id: 'avalider', label: 'À valider', on: true }, { id: 'historique', label: 'Validés' }, { id: 'toutes', label: 'Toutes les demandes' }],
    onTab: setVue
  });
  await reload();
  const d = new URLSearchParams(location.search).get('d');
  if (d) { history.replaceState(null, '', location.pathname); ouvrirDemande(d); }
})();
