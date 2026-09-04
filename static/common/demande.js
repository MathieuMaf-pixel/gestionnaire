/* ============================================================
   Gestionnaire MAF — rendu commun d'une demande (toutes interfaces)
   Chaque interface fournit sa barre d'actions via `actionsHtml(d)`.
   ============================================================ */
'use strict';

const ETAPES = [
  { id: 'brouillon', label: '1 · CDC commercial' },
  { id: 'envoyee', label: '2 · Envoyée' },
  { id: 'en_implantation', label: '3 · Implantation' },
  { id: 'a_valider', label: '4 · Validation DT' },
  { id: 'validee', label: '5 · Plan validé' },
  { id: 'chiffree', label: '6 · Chiffrage' },
];

function stepsHtml(d) {
  const ordre = { brouillon: 0, envoyee: 1, en_implantation: 2, refusee: 2, a_valider: 3, validee: 4, chiffree: 5 };
  const cur = ordre[d.statut] ?? 0;
  return `<div class="steps">${ETAPES.map((e, i) => {
    let cls = i < cur ? 'done' : i === cur ? 'now' : '';
    if (d.statut === 'refusee' && i === 2) cls = 'bad';
    return `<div class="step ${cls}">${e.label}</div>`;
  }).join('')}</div>`;
}

function infosHtml(d) {
  const cdcs = (d.cdc_types || []).map(t => G.cfg.cdc_types[t]?.label || t).join(', ');
  return `<dl class="dl">
    <dt>Client</dt><dd><b>${esc(d.client_nom)}</b>${d.client_pays ? ' · ' + esc(d.client_pays) : ''}${d.client_ville ? ' · ' + esc(d.client_ville) : ''}</dd>
    <dt>Commercial</dt><dd>${esc(d.commercial_nom || d.commercial)}${d.commercial_email ? ` <span class="muted small">(${esc(d.commercial_email)})</span>` : ''}</dd>
    <dt>Implantation</dt><dd>${d.implanteur_nom ? esc(d.implanteur_nom) : '<span class="muted">— non prise en charge</span>'}</dd>
    <dt>CDC</dt><dd>${esc(cdcs)}</dd>
    <dt>Produits</dt><dd>${esc(d.produits) || '—'}${d.varietes ? ` <span class="muted">(${esc(d.varietes)})</span>` : ''}</dd>
    <dt>Tonnage</dt><dd>${d.tonnage_horaire ? esc(d.tonnage_horaire) + ' T/h' : '—'}${d.tonnage_annuel ? ` · ${esc(d.tonnage_annuel)} T/an` : ''}</dd>
    <dt>Temps de travail</dt><dd>${esc(d.temps_travail) || '—'}</dd>
    <dt>Retour souhaité</dt><dd>${esc(d.retour_souhaite) || '—'}</dd>
    <dt>Description</dt><dd>${d.description ? nl2br(d.description) : '—'}</dd>
    <dt>Créée</dt><dd>${fmtDT(d.created_at)}${d.envoyee_le ? ` · envoyée ${fmtDT(d.envoyee_le)}` : ''}${d.validee_le ? ` · validée ${fmtDT(d.validee_le)}` : ''}</dd>
    ${d.devis ? `<dt>Devis</dt><dd><b>${esc(d.devis)}</b></dd>` : ''}
  </dl>`;
}

function cdcCardsHtml(d, editable) {
  return (d.cdc_types || []).map(t => {
    const c = d.cdc[t] || {}, info = G.cfg.cdc_types[t] || { label: t, page: '#' };
    const url = `${info.page}?demande=${encodeURIComponent(d.id)}${editable ? '' : '&lecture=1'}`;
    return `<div class="cdc-card ${c.complet ? 'ok' : ''}">
      <div><div class="t">${c.complet ? '✓ ' : ''}${esc(info.label)}</div>
      <div class="muted small">${c.complet ? 'Complet' : 'À compléter'}${c.updated_at ? ' · ' + fmtDT(c.updated_at) : ''}</div></div>
      <a class="btn ${editable ? (c.complet ? 'ghost' : '') : 'grey'} sm" href="${url}">${editable ? (c.complet ? 'Modifier' : 'Compléter') : 'Consulter'}</a>
    </div>`;
  }).join('') || '<div class="muted">Aucun CDC.</div>';
}

function plansHtml(d, opts = {}) {
  if (!d.plans.length) return '<div class="empty">Aucun plan pour le moment.</div>';
  return `<table class="grid"><thead><tr><th>Indice</th><th>Fichier</th><th>Statut</th><th>Commentaire implantation</th><th>Décision DT</th>${opts.actions ? '<th></th>' : ''}</tr></thead>
  <tbody>${d.plans.map(p => `<tr style="cursor:default">
    <td><span class="vname">${esc(p.indice)}</span></td>
    <td class="mono">${esc(p.fichier) || '—'}<div class="muted small" style="font-family:var(--font)">${fmtDT(p.cree_le)}</div></td>
    <td>${badgePlan(p.statut)}</td>
    <td>${p.commentaire ? nl2br(p.commentaire) : '<span class="muted">—</span>'}</td>
    <td>${p.decide_le ? `${nl2br(p.note_dt) || '<span class="muted">sans commentaire</span>'}<div class="muted small">${fmtDT(p.decide_le)}</div>` : '<span class="muted">—</span>'}</td>
    ${opts.actions ? `<td>${opts.actions(p)}</td>` : ''}
  </tr>`).join('')}</tbody></table>`;
}

function journalHtml(d) {
  const rc = { 'Direction technique': 'r-dt', 'Implantation': 'r-impl', 'Commercial': 'r-com' };
  return `<ul class="journal">${[...d.journal].reverse().map(j => `<li>
    <span class="when">${fmtDT(j.ts)}</span>
    <span><span class="who ${rc[j.role] || ''}">${esc(j.acteur)}</span> <span class="muted small">· ${esc(j.role)}</span><br>${nl2br(j.texte)}</span>
  </li>`).join('')}</ul>
  <div class="row mt"><input class="search" id="jMsg" style="flex:1" placeholder="Ajouter un message dans le journal…">
  <button class="btn grey" id="jSend">Envoyer</button></div>`;
}

/* Fiche complète : `actionsHtml(d)` = barre d'actions du rôle ; `plansActions(p)` = boutons par plan (optionnel) */
function renderDemandeDetail(d, o) {
  const root = $('#app');
  root.innerHTML = `
    <div class="row between mb"><button class="btn grey" id="btnBack">← Retour à la liste</button>
      <div class="row">${badgeStatut(d.statut)} ${d.archive ? '<span class="badge black">Archivée</span>' : ''}</div></div>
    <div class="dhead"><div><div class="num">${numero(d)}</div><h2>${esc(d.titre)}</h2>
      <div class="sub">${esc(d.client_nom)} · ${esc(d.commercial_nom || d.commercial)}</div></div>
      <div class="head-actions" id="actions">${o.actionsHtml ? o.actionsHtml(d) : ''}</div></div>
    ${stepsHtml(d)}
    ${o.alerteHtml ? o.alerteHtml(d) : ''}
    <div class="layout">
      <div>
        <div class="panel"><h3>Plans d'implantation</h3>${plansHtml(d, { actions: o.plansActions })}${o.plansFooter ? o.plansFooter(d) : ''}</div>
        <div class="panel"><h3>Cahiers des charges</h3>${cdcCardsHtml(d, !!o.cdcEditable)}</div>
        <div class="panel"><h3>Informations de la demande</h3>${infosHtml(d)}${o.infosFooter ? o.infosFooter(d) : ''}</div>
      </div>
      <div><div class="panel"><h3>Journal</h3>${journalHtml(d)}</div></div>
    </div>`;
  $('#btnBack').onclick = () => o.onBack();
  const send = async () => {
    const t = $('#jMsg').value.trim(); if (!t) return;
    const nd = await POST(`/api/demandes/${d.id}/commentaire`, { texte: t });
    o.onRefresh(nd);
  };
  $('#jSend').onclick = send;
  $('#jMsg').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
}

/* Ligne de tableau commune pour les listes */
function ligneDemande(d, cols) {
  return `<tr data-id="${d.id}">${cols.map(c => c(d)).join('')}</tr>`;
}
const COL = {
  num: d => `<td class="mono">${numero(d)}</td>`,
  client: d => `<td><b>${esc(d.client_nom)}</b>${d.client_pays ? `<div class="muted small">${esc(d.client_pays)}</div>` : ''}</td>`,
  titre: d => `<td>${esc(d.titre)}<div class="muted small">${(d.cdc_types || []).map(t => G.cfg.cdc_types[t]?.label || t).join(' · ')}</div></td>`,
  com: d => `<td>${esc(d.commercial_nom || d.commercial)}</td>`,
  impl: d => `<td>${d.implanteur_nom ? esc(d.implanteur_nom) : '<span class="muted">—</span>'}</td>`,
  statut: d => `<td>${badgeStatut(d.statut)}</td>`,
  retour: d => `<td>${esc(d.retour_souhaite) || '<span class="muted">—</span>'}</td>`,
  indice: d => `<td class="c">${d.dernier_indice ? `<span class="vname">${esc(d.dernier_indice)}</span>` : '<span class="muted">—</span>'}</td>`,
  maj: d => `<td class="muted small">${fmtDT(d.updated_at)}<br>${ageJours(d.updated_at)}</td>`,
  devis: d => `<td>${esc(d.devis) || '<span class="muted">—</span>'}</td>`,
};
function tableDemandes(rows, cols, heads, onOpen, emptyMsg) {
  if (!rows.length) return `<div class="empty">${emptyMsg || 'Aucune demande.'}</div>`;
  setTimeout(() => $$('table.grid tbody tr[data-id]').forEach(tr => tr.onclick = () => onOpen(tr.dataset.id)), 0);
  return `<table class="grid"><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(d => ligneDemande(d, cols)).join('')}</tbody></table>`;
}
function filtrer(rows, q) {
  q = (q || '').toLowerCase().trim(); if (!q) return rows;
  return rows.filter(d => [numero(d), d.client_nom, d.titre, d.commercial_nom, d.produits, d.statut_label, d.devis].join(' ').toLowerCase().includes(q));
}
