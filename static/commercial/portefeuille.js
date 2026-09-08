/* ============================================================
   Gestionnaire MAF — espace commercial · PORTEFEUILLE (page d'accueil)
   ------------------------------------------------------------
   À gauche : l'arborescence du commercial  client → année → projet.
   Au milieu : les projets du niveau déroulé, en tuiles, chacune avec
   le processus (1 CDC · 2 Envoyée · 3 Implantation · 4 Validation DT
   · 5 Plan validé · 6 Chiffrage) coché au fil de l'avancement.
   À droite : la carte des clients, synchronisée avec la sélection.
   URL : #/portefeuille?c=<client>&a=<année>&d=<demande>
   Dépend de app.js (S, prochaine, enRetard, nav…) et carte.js (icônes, carte).
   ============================================================ */
'use strict';

const PF = { open: {}, q: '', carte: null };

/* ---------- données dérivées ---------- */
function toutesDemandes() { return S.demandes.concat(S.archives || []); }
function annee(d) { return (d.created_at || '').slice(0, 4) || '—'; }
function demandesClient(c) { return toutesDemandes().filter(d => d.client_id ? d.client_id === c.id : d.client_nom === c.nom); }
function arbreClient(c) {
  const ds = demandesClient(c).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const parAn = {};
  ds.forEach(d => { (parAn[annee(d)] = parAn[annee(d)] || []).push(d); });
  return { c, ds, annees: Object.keys(parAn).sort().reverse().map(a => ({ a, ds: parAn[a] })) };
}
const STATUT_CLS = s => (G.cfg.statuts[s] || { cls: 'grey' }).cls;
const dotStatut = d => `<i class="pf-dot ${STATUT_CLS(d.statut)}${d.archive ? ' arch' : ''}" title="${esc(G.cfg.statuts[d.statut]?.label || d.statut)}"></i>`;

/* ---------- rendu ---------- */
async function renderPortefeuille(app) {
  if (typeof chargerRef === 'function') await chargerRef();
  const p = S.route.params || {};
  const selC = p.c ? S.clients.find(c => c.id === p.c) : null;
  const selA = selC && p.a ? p.a : null;
  const selD = p.d || null;
  // on déplie automatiquement le chemin de la sélection, une seule fois (l'utilisateur reste libre de replier)
  const cle = [selC && selC.id, selA, selD].join('|');
  if (cle !== PF.derniereSel) {
    PF.derniereSel = cle;
    if (selC) { PF.open[selC.id] = true; if (selA) PF.open[selC.id + '|' + selA] = true; }
    if (selD && selC && !selA) { const dd = toutesDemandes().find(d => d.id === selD); if (dd) PF.open[selC.id + '|' + annee(dd)] = true; }
  }

  // périmètre affiché au milieu : rien → en cours ; client → tous ses projets ; année → ceux de l'année ; projet → lui seul
  let scope, titre, sous;
  if (selC) {
    const t = arbreClient(selC);
    if (selD) { scope = t.ds.filter(d => d.id === selD); const d0 = scope[0]; titre = d0 ? numero(d0) + ' · ' + d0.titre : 'Projet introuvable'; sous = selC.nom + (selA ? ' · ' + selA : ''); }
    else if (selA) { scope = t.ds.filter(d => annee(d) === selA); titre = selC.nom; sous = `Projets ${selA} · ${scope.length} projet${scope.length > 1 ? 's' : ''}`; }
    else { scope = t.ds; titre = selC.nom; sous = `Tous les projets · ${t.annees.map(x => x.a).join(', ') || 'aucun'}`; }
    scope = scope.slice().sort((a, b) => (a.archive - b.archive) || b.updated_at.localeCompare(a.updated_at));
  } else {
    scope = S.demandes.filter(d => !d.archive).sort((a, b) => { const pa = prochaine(a).type === 'act', pb = prochaine(b).type === 'act'; return (pb - pa) || (enRetard(b) - enRetard(a)) || b.updated_at.localeCompare(a.updated_at); });
    titre = 'Portefeuille'; sous = `${scope.length} projet${scope.length > 1 ? 's' : ''} en cours chez ${S.clients.length} client${S.clients.length > 1 ? 's' : ''} — dérouler un client à gauche`;
  }
  const nbArch = scope.filter(d => d.archive).length;

  app.innerHTML = `
    <div class="pf-layout">
      <aside class="pf-tree panel">
        <div class="pf-th"><h3>Mes clients <span class="badge grey">${S.clients.length}</span></h3><button class="btn ghost sm" id="pfNewC" title="Nouveau client">＋</button></div>
        <input class="search" id="pfQ" placeholder="Client, ville, projet…" value="${esc(PF.q)}">
        <ul class="pf-clients" id="pfArbre">${arbreHtml(selC, selA, selD)}</ul>
      </aside>
      <section class="pf-main">
        <div class="ptools">
          <div><div class="kicker">${selC ? 'Client' + (selC.activite ? ' · ' + esc(selC.activite) : '') : 'Commercial'}</div><h2 class="page" style="margin:0">${esc(titre)}</h2><div class="muted small kpis">${sous}</div></div>
          <div class="spacer"></div>
          ${selC ? `<a class="btn grey" href="#/client/${encodeURIComponent(selC.id)}">Fiche client</a>${btnNouvelle(selC.id)}` : btnNouvelle()}
        </div>
        ${selC && !selD ? bandeauClient(selC) : ''}
        ${scope.length ? `<div class="tuiles ${selD ? 'une' : ''}">${scope.map(d => tuile(d, !selC, d.id === selD)).join('')}</div>`
          : `<div class="empty">${selC ? 'Aucun projet' + (selA ? ' en ' + selA : '') + ' pour ce client.' : 'Aucun projet en cours.'}</div>`}
        ${nbArch && !selD ? `<div class="muted small mt">${nbArch} projet${nbArch > 1 ? 's' : ''} terminé${nbArch > 1 ? 's' : ''} (archivé${nbArch > 1 ? 's' : ''}) affiché${nbArch > 1 ? 's' : ''} en grisé.</div>` : ''}
      </section>
      <aside class="pf-map"><div class="panel pf-mapp"><h3>Carte ${selC ? '<span class="muted small">— ' + esc(selC.ville || selC.nom) + '</span>' : '<span class="muted small">— tous les clients</span>'}</h3>
        <div id="pfMap" class="carte-pf"></div>
        <div class="pf-leg"><span><i class="mk-halo act"></i>à faire</span><span><i class="mk-halo wait"></i>en attente</span><span><i class="mk-halo"></i>sans demande</span></div></div></aside>
    </div>`;

  // liaisons : la recherche ne redessine que l'arbre (saisie fluide), le reste passe par l'URL
  $('#pfQ').oninput = e => { PF.q = e.target.value; $('#pfArbre').innerHTML = arbreHtml(selC, selA, selD); lierArbre(selC, selA, selD); };
  $('#pfNewC').onclick = () => editerClient(null, c => nav('#/portefeuille?c=' + encodeURIComponent(c.id)));
  lierArbre(selC, selA, selD);
  app.querySelectorAll('.tuile').forEach(t => t.onclick = e => { if (e.target.closest('[data-stop]')) return; nav('#/demande/' + encodeURIComponent(t.dataset.id)); });
  const selT = app.querySelector('.tuile.sel'); if (selT) selT.scrollIntoView({ block: 'nearest' });

  // carte
  if (typeof carteCompacte === 'function') PF.carte = carteCompacte($('#pfMap'), S.clients, { sel: selC ? selC.id : null, onSelect: id => nav('#/portefeuille?c=' + encodeURIComponent(id)) });
}

/* arbre filtré : quand la recherche touche un projet, on déplie le chemin (client, année) sans toucher à l'état mémorisé */
function arbreHtml(selC, selA, selD) {
  const q = PF.q.trim().toLowerCase();
  const arbres = S.clients.slice().sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).map(arbreClient);
  PF.force = {};
  const vus = q ? arbres.filter(t => {
    const surClient = (t.c.nom + ' ' + (t.c.ville || '') + ' ' + (t.c.dept || '') + ' ' + (t.c.contact || '')).toLowerCase().includes(q);
    const projets = t.ds.filter(d => (d.titre + ' ' + numero(d) + ' ' + (d.produits || '')).toLowerCase().includes(q));
    if (projets.length) { PF.force[t.c.id] = true; projets.forEach(d => PF.force[t.c.id + '|' + annee(d)] = true); t.filtre = new Set(projets.map(d => d.id)); }
    return surClient || projets.length;
  }) : arbres;
  return vus.map(t => noeudClient(t, selC, selA, selD)).join('') || `<li class="muted small" style="padding:8px">${q ? 'Aucun client ni projet ne correspond.' : 'Aucun client.'}</li>`;
}
const estOuvert = k => !!(PF.open[k] || (PF.force && PF.force[k]));
function lierArbre(selC, selA, selD) {
  const root = $('#pfArbre'); if (!root) return;
  const redess = () => { root.innerHTML = arbreHtml(selC, selA, selD); lierArbre(selC, selA, selD); };
  root.querySelectorAll('.pf-car').forEach(b => b.onclick = e => { e.stopPropagation(); const k = b.dataset.k; PF.open[k] = !estOuvert(k); if (PF.force) delete PF.force[k]; redess(); });
  root.querySelectorAll('.pf-c > .pf-row').forEach(r => r.onclick = () => { PF.open[r.dataset.c] = true; nav('#/portefeuille?c=' + encodeURIComponent(r.dataset.c)); });
  root.querySelectorAll('.pf-a > .pf-row').forEach(r => r.onclick = () => { PF.open[r.dataset.c + '|' + r.dataset.a] = true; nav(`#/portefeuille?c=${encodeURIComponent(r.dataset.c)}&a=${r.dataset.a}`); });
  root.querySelectorAll('.pf-d').forEach(r => r.onclick = () => nav(`#/portefeuille?c=${encodeURIComponent(r.dataset.c)}&a=${r.dataset.a}&d=${encodeURIComponent(r.dataset.d)}`));
}

function noeudClient(t, selC, selA, selD) {
  const c = t.c, ouvert = estOuvert(c.id), e = etatClient(c), live = t.ds.filter(d => !d.archive).length;
  const nbAct = t.ds.filter(d => !d.archive && prochaine(d).type === 'act').length;
  return `<li class="pf-c ${selC && selC.id === c.id && !selA && !selD ? 'sel' : ''}${selC && selC.id === c.id ? ' in' : ''}">
    <div class="pf-row" data-c="${c.id}">
      <button class="pf-car ${ouvert ? 'open' : ''}" data-k="${c.id}" aria-label="Dérouler">▸</button>
      <span class="pf-ico">${typeof iconeProduit === 'function' ? iconeProduit(produitPrincipal(c), 24) : ''}</span>
      <span class="pf-lbl"><b>${esc(c.nom)}</b><span class="pf-sub">${esc(c.ville || '')}${c.dept ? ' (' + esc(c.dept) + ')' : ''}${!geoloc(c) ? ' · <i title="non géolocalisé">⌖</i>' : ''}</span></span>
      <span class="pf-badges">${nbAct ? `<span class="badge green" title="${nbAct} action${nbAct > 1 ? 's' : ''} à faire">${nbAct}</span>` : ''}${e.retard ? '<i class="pf-late" title="au moins un retour souhaité dépassé"></i>' : ''}<span class="pf-n" title="projets en cours / total">${live}<span class="muted">/${t.ds.length}</span></span></span>
    </div>
    ${ouvert ? `<ul class="pf-annees">${t.annees.length ? t.annees.map(y => noeudAnnee(c, y, selA, selD, t.filtre)).join('') : `<li class="pf-vide">Aucun projet — <a href="#/nouvelle?client=${encodeURIComponent(c.id)}">en créer un</a></li>`}</ul>` : ''}
  </li>`;
}
function noeudAnnee(c, y, selA, selD, filtre) {
  const k = c.id + '|' + y.a, ouvert = estOuvert(k), live = y.ds.filter(d => !d.archive).length;
  return `<li class="pf-a ${selA === y.a && !selD ? 'sel' : ''}">
    <div class="pf-row" data-c="${c.id}" data-a="${y.a}">
      <button class="pf-car ${ouvert ? 'open' : ''}" data-k="${k}" aria-label="Dérouler">▸</button>
      <span class="pf-lbl"><b>${y.a}</b></span>
      <span class="pf-dots">${y.ds.map(dotStatut).join('')}</span>
      <span class="pf-n">${live}<span class="muted">/${y.ds.length}</span></span>
    </div>
    ${ouvert ? `<ul class="pf-projets">${y.ds.map(d => `<li class="pf-d ${d.id === selD ? 'sel' : ''}${d.archive ? ' arch' : ''}${filtre && filtre.has(d.id) ? ' hit' : ''}" data-c="${c.id}" data-a="${y.a}" data-d="${d.id}">
        ${dotStatut(d)}<span class="mono">${numero(d)}</span><span class="pf-t">${esc(d.titre)}</span></li>`).join('')}</ul>` : ''}
  </li>`;
}

function bandeauClient(c) {
  const ds = demandesClient(c), live = ds.filter(d => !d.archive);
  const nbAct = live.filter(d => prochaine(d).type === 'act').length, last = ds.map(d => d.updated_at).sort().pop();
  return `<div class="pf-band">
    <div class="pf-ident">${typeof iconeProduit === 'function' ? iconeProduit(produitPrincipal(c), 42) : ''}
      <div><div class="small">${[c.adresse, [c.cp, c.ville].filter(Boolean).join(' '), c.dept ? '(' + c.dept + ')' : ''].filter(Boolean).map(esc).join(' · ') || '<span class="muted">Lieu non renseigné</span>'}</div>
      <div class="small muted">${[c.contact, c.tel, c.email].filter(Boolean).map(esc).join(' · ') || 'Aucun contact'}</div>
      ${(c.fruits || []).length ? `<div class="small pf-prod">${c.fruits.slice().sort((a, b) => (b.volume_t || 0) - (a.volume_t || 0)).map(f => `<span>${iconeProduit(f.produit, 16)} ${esc(nomProduit(f.produit))}${f.volume_t ? ' <b>' + fmtNb(f.volume_t) + ' t</b>' : ''}</span>`).join('')}</div>` : ''}</div></div>
    <div class="cstats">
      <div class="cstat"><div class="l">En cours</div><div class="v">${live.length}</div></div>
      <div class="cstat"><div class="l">À faire</div><div class="v ${nbAct ? 'g' : ''}">${nbAct}</div></div>
      <div class="cstat"><div class="l">Chiffrés</div><div class="v">${ds.filter(d => d.statut === 'chiffree').length}</div></div>
      <div class="cstat"><div class="l">Dernière activité</div><div class="v" style="font-size:15px">${last ? fmtD(last) : '—'}</div></div>
    </div></div>`;
}

/* ---------- tuile projet : processus en 6 étapes ---------- */
const ETAPES_COURTES = ['CDC', 'Envoyée', 'Implant.', 'Valid. DT', 'Validé', 'Chiffré'];
function tuile(d, avecClient, sel) {
  const ordre = { brouillon: 0, envoyee: 1, en_implantation: 2, refusee: 2, a_valider: 3, validee: 4, chiffree: 5 };
  const cur = ordre[d.statut] ?? 0, p = prochaine(d), late = enRetard(d), stale = sansMouvement(d);
  const det = S.details[d.id] && S.details[d.id].d;
  const nbCdc = (d.cdc_types || []).length, nbOk = det ? (d.cdc_types || []).filter(t => det.cdc && det.cdc[t] && det.cdc[t].complet).length : (d.cdc_complet === 1 ? nbCdc : null);
  const fini = d.statut === 'chiffree';
  const steps = ETAPES_COURTES.map((lbl, i) => {
    let cls = i < cur || (fini && i === cur) ? 'done' : i === cur ? 'now' : '';
    let sub = '';
    if (d.statut === 'refusee' && i === 3) { cls = 'bad'; sub = 'refusé'; }
    if (d.statut === 'refusee' && i === 2) { cls = 'now'; sub = 'reprise'; }
    if (i === 0 && d.statut === 'brouillon' && nbCdc) sub = nbOk == null ? '' : `${nbOk}/${nbCdc} complet${nbOk > 1 ? 's' : ''}`;
    if (i === 1 && d.envoyee_le && i <= cur) sub = fmtD(d.envoyee_le);
    if (i === 2 && d.dernier_indice && i <= cur && d.statut !== 'refusee') sub = 'indice ' + d.dernier_indice;
    if (i === 4 && d.validee_le && i <= cur) sub = fmtD(d.validee_le);
    if (i === 5 && d.devis && fini) sub = d.devis;
    return `<div class="ts ${cls}" title="${esc(lbl)}"><span class="k">${cls === 'done' ? '✓' : cls === 'bad' ? '✕' : i + 1}</span><span class="l">${lbl}</span>${sub ? `<span class="s">${esc(sub)}</span>` : ''}</div>`;
  }).join('');
  return `<div class="tuile ${d.archive ? 'arch' : late ? 'late' : p.type === 'act' ? 'act' : ''} ${sel ? 'sel' : ''}" data-id="${d.id}">
    <div class="tu-h"><span class="mono">${numero(d)}</span>
      <span class="tu-cdc">${(d.cdc_types || []).map(t => `<span class="tu-chip">${esc((G.cfg.cdc_types[t]?.label || t).replace(/^CDC\s*/i, ''))}</span>`).join('')}</span>
      <span class="spacer"></span>${badgeStatut(d.statut)}</div>
    ${avecClient ? `<div class="tu-c">${esc(d.client_nom)}</div>` : ''}
    <div class="tu-t">${esc(d.titre)}</div>
    <div class="tu-m muted small">${[d.produits, d.tonnage_horaire ? d.tonnage_horaire + ' T/h' : ''].filter(Boolean).map(esc).join(' · ')}${d.created_at ? ' · créé le ' + fmtD(d.created_at) : ''}</div>
    <div class="tsteps">${steps}</div>
    <div class="tu-f">
      <span class="${p.type === 'act' ? 'tu-next act' : p.type === 'done' ? 'tu-next done' : 'tu-next'}">${p.type === 'act' ? '▶ ' : ''}${esc(p.label)}${p.sub && p.type !== 'act' ? ` <span class="muted">· ${esc(p.sub)}</span>` : ''}</span>
      <span class="spacer"></span>
      ${late ? `<span class="badge red">retour ${esc(d.retour_souhaite)} dépassé</span>` : d.retour_souhaite && !fini ? `<span class="muted small">retour souhaité ${esc(d.retour_souhaite)}</span>` : ''}
      ${stale && !fini ? `<span class="badge orange">${jours(d.updated_at)} j sans mouvement</span>` : ''}
      ${p.href && p.type === 'act' ? `<a class="btn sm" href="${p.href}" data-stop>${esc(p.label)}</a>` : `<a class="btn ghost sm" href="#/demande/${encodeURIComponent(d.id)}" data-stop>Ouvrir →</a>`}
    </div>
  </div>`;
}
