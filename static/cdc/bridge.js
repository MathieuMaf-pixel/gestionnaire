/* ============================================================
   Pont Gestionnaire ↔ page CDC autonome
   ------------------------------------------------------------
   Sans paramètre ?demande=…  : la page garde son comportement d'origine
   (sauvegarde localStorage, export/import JSON, PDF).
   Avec ?demande=<id>[&type=precalibrage][&lecture=1] :
     - l'état S est chargé / sauvegardé via l'API du Gestionnaire,
     - la page « Général » est préremplie depuis la demande,
     - « Envoyer le CDC » devient « Terminer le CDC » → marque le CDC
       complet et revient sur la fiche de la demande,
     - lecture=1 : consultation seule (implantation, DT).
   Ce fichier ne modifie pas la page CDC : il redéfinit quelques fonctions
   globales (charger, sauvegarder, envoyerCDC) après son chargement.
   ============================================================ */
(function () {
  'use strict';
  const P = new URLSearchParams(location.search);
  const DEMANDE = P.get('demande');
  if (!DEMANDE) return;                                        // mode autonome inchangé
  const TYPE = P.get('type') || (location.pathname.match(/\/cdc\/([a-z]+)\.html/) || [])[1] || 'precalibrage';
  const LECTURE = P.get('lecture') === '1';
  const API = `/api/demandes/${encodeURIComponent(DEMANDE)}/cdc/${TYPE}`;
  let meta = null;            // {demande, complet, …}
  let timer = null;
  let dirty = false;

  /* -------- Complétude silencieuse (sans marquer les erreurs) -------- */
  function cdcComplet() {
    try {
      return CHAMPS.every(c => !c.req || !champVisible(c) || estRempli(c)) &&
        (!S.f['129'] || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(S.f['129']));
    } catch (e) { return false; }
  }

  /* -------- Sauvegarde vers l'API -------- */
  async function pousser(manuel) {
    if (LECTURE) return;
    S.sauveLe = new Date().toISOString();
    const complet = cdcComplet();
    const r = await fetch(API, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: S, complet }) });
    if (r.status === 401) { location.href = '/login?d=' + encodeURIComponent(DEMANDE); return; }
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast(j.error || 'Sauvegarde impossible', true); return; }
    dirty = false;
    const h = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const st = document.getElementById('statutSauve');
    if (st) st.innerHTML = `● Sauvegardé dans la demande <b>${h}</b>${complet ? ' · <span style="color:var(--vert-f)">complet</span>' : ''}`;
    if (manuel) toast('Enregistré dans la demande ✓');
  }

  /* -------- Redéfinitions des fonctions de la page -------- */
  window.charger = function () { /* le chargement se fait après DOMContentLoaded (asynchrone) */ };
  window.sauvegarder = function (manuel) {
    if (LECTURE) return;
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(() => pousser(manuel), manuel ? 0 : 600);
  };
  const envoyerOriginal = window.envoyerCDC;
  window.envoyerCDC = function () {
    const fautes = validerTout();
    if (fautes.length) { envoyerOriginal(); return; }   // affiche le bandeau d'erreurs d'origine
    (async () => {
      await pousser(false);
      toast('CDC complet ✓ — retour à la demande…');
      setTimeout(() => location.href = '/?d=' + encodeURIComponent(DEMANDE), 500);
    })();
  };
  window.addEventListener('beforeunload', e => { if (dirty && !LECTURE) { e.preventDefault(); e.returnValue = ''; } });

  /* -------- Préremplissage de la page Général depuis la demande -------- */
  function preremplir(d, premier) {
    const f = S.f;
    const set = (k, v) => { if (v && (!f[k] || (premier && k === '98'))) f[k] = v; };
    const nom = (d.commercial_nom || '').trim().split(/\s+/);
    set('121p', nom[0] || ''); set('121n', nom.slice(1).join(' '));
    set('129', d.commercial_email || '');
    set('7', d.client_nom || '');
    if (d.client_pays && PAYS.includes(d.client_pays)) f['132'] = d.client_pays;
    set('98', d.retour_souhaite || '');
    if (d.produits && Array.isArray(f['6']) && !f['6'].length) {
      const p = d.produits.toLowerCase();
      if (p.includes('pomme')) f['6'].push('Pomme');
      if (p.includes('poire')) f['6'].push('Poire');
      const autre = d.produits.split(/[,;/]+/).map(s => s.trim()).filter(s => s && !/pomme|poire/i.test(s));
      if (autre.length) { f['6'].push('Autre'); f['6o'] = autre.join(', '); }
    }
    set('83', d.varietes || '');
    set('104', d.tonnage_annuel || '');
    set('84', d.tonnage_horaire || '');
    set('120', d.temps_travail || '');
    set('37', d.description || '');
  }

  /* -------- Bandeau « demande » + adaptation de la barre d'outils -------- */
  function bandeau(d) {
    const b = document.createElement('div');
    b.id = 'bandeauDemande';
    b.style.cssText = 'max-width:920px;margin:14px auto 0;padding:0 20px';
    b.innerHTML = `<div style="background:#0e100e;color:#fff;border-radius:10px;border-left:4px solid var(--vert);padding:10px 16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:13.5px">
      <div><b style="color:var(--vert)">D-${String(d.numero).padStart(4, '0')}</b> · <b>${esc(d.client_nom)}</b> — ${esc(d.titre)}
        <div style="color:#9fb18f;font-size:12px">${LECTURE ? 'Consultation seule' : 'Sauvegarde automatique dans la demande'} · ${esc(d.commercial_nom || '')}</div></div>
      <a href="/?d=${encodeURIComponent(DEMANDE)}" style="margin-left:auto;background:var(--vert);color:#fff;text-decoration:none;padding:7px 12px;border-radius:7px;font-weight:600;font-size:13px">← Retour à la demande</a></div>`;
    const hdr = document.getElementById('hdr');
    hdr.parentNode.insertBefore(b, hdr.nextSibling);
    const raz = document.getElementById('btnRaz'); if (raz) raz.style.display = 'none';
    if (LECTURE) ['btnSauveHaut', 'btnImport'].forEach(id => { const e = document.getElementById(id); if (e) e.style.display = 'none'; });
    const env = document.querySelector('.b-nav.env'); if (env) env.textContent = LECTURE ? 'Retour à la demande' : 'Terminer le CDC ✓';
    if (env && LECTURE) env.onclick = e => { e.stopImmediatePropagation(); location.href = '/?d=' + encodeURIComponent(DEMANDE); };
  }
  function lectureSeule() {
    document.querySelectorAll('#appli input, #appli select, #appli textarea, #appli button.b-sortie, #appli button.note-b, #btnAjPalox').forEach(el => { el.disabled = true; });
  }
  const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* -------- Chargement initial (après demarrer() de la page) -------- */
  document.addEventListener('DOMContentLoaded', async () => {
    let r;
    try { r = await fetch(API); } catch (e) { toast('Serveur injoignable', true); return; }
    if (r.status === 401) { location.href = '/login?d=' + encodeURIComponent(DEMANDE); return; }
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast(j.error || 'CDC introuvable', true); return; }
    meta = await r.json();
    const vide = etatVierge();
    const d = meta.data && meta.data.v === 1 ? meta.data : null;
    S = d ? Object.assign(vide, d) : vide;
    if (d) S.f = Object.assign(etatVierge().f, d.f || {});
    preremplir(meta.demande, !d);
    restaurerDom(); appliquerConditions(); majProgression(); allerPage(0);
    bandeau(meta.demande);
    const figee = meta.demande.statut !== 'brouillon';
    if (LECTURE || figee) lectureSeule();
    if (figee && !LECTURE) toast('Demande envoyée : le CDC est figé (consultation).', false);
    document.title = `CDC — D-${String(meta.demande.numero).padStart(4, '0')} ${meta.demande.client_nom}`;
  });
})();
