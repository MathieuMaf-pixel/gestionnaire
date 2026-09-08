/* ============================================================
   Gestionnaire MAF — espace commercial · CARTE DES CLIENTS
   ------------------------------------------------------------
   Le territoire du commercial : clients géolocalisés, marqueur = produit
   principal, halo = état des demandes (à faire / en attente / rien).
   Fond vectoriel embarqué (départements FR + pays voisins), fond OSM en option.
   Import CSV / Excel → POST /api/clients ligne par ligne. Géocodage Nominatim
   en option (réseau). Vocabulaire produits = varietes.json (clés communes au CDC).
   Dépend de app.js (S, prochaine, nav, editerClient…) et de vendor/leaflet.js.
   ============================================================ */
'use strict';

const CARTE = {
  map: null, base: null, tuiles: null, marqueurs: null, couche: {},
  fFruit: '', fDept: '', fEtat: '', fond: 'vecteur',
  REF: null, refPromise: null,
  PRODUITS_LIBRES: { raisin: 'Raisin', fraise: 'Fraise', noix: 'Noix', chataigne: 'Châtaigne', olive: 'Olive', autre: 'Autre' },
};

/* ---------- référentiel produits (noms + silhouettes) ---------- */
async function chargerRef() {
  if (CARTE.REF) return CARTE.REF;
  if (!CARTE.refPromise) CARTE.refPromise = fetch('/static/common/varietes.json').then(r => r.ok ? r.json() : null).catch(() => null)
    .then(j => { CARTE.REF = j || { produits: {}, fruits: {}, v: [] }; return CARTE.REF; });
  return CARTE.refPromise;
}
function nomProduit(k) {
  const R = CARTE.REF;
  if (R && R.produits && R.produits[k]) return R.produits[k].nom;
  if (R && R.fruits && R.fruits[k]) return R.fruits[k];
  if (CARTE.PRODUITS_LIBRES[k]) return CARTE.PRODUITS_LIBRES[k];
  return k ? k.charAt(0).toUpperCase() + k.slice(1) : '—';
}
function listeProduits() {
  const R = CARTE.REF, out = [];
  if (R && R.produits) Object.keys(R.produits).forEach(k => out.push({ k, nom: R.produits[k].nom, cat: R.produits[k].cat }));
  Object.keys(CARTE.PRODUITS_LIBRES).forEach(k => out.push({ k, nom: CARTE.PRODUITS_LIBRES[k], cat: 'libre' }));
  return out.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}
let _uidSil = 0;
/* silhouette du produit (variété médiane du référentiel) en SVG compact ; repli : pastille lettre */
function iconeProduit(k, taille) {
  const R = CARTE.REF;
  const vs = R && R.v ? R.v.filter(v => v.fruit === k && v.sil) : [];
  if (!vs.length) {
    const l = nomProduit(k).charAt(0).toUpperCase();
    return `<svg viewBox="0 0 40 40" style="width:${taille}px;height:${taille}px"><circle cx="20" cy="20" r="17" fill="#eef1f5" stroke="#c9d0da"/><text x="20" y="26" text-anchor="middle" font-family="Barlow Condensed,Segoe UI,sans-serif" font-weight="700" font-size="18" fill="#5b6675">${esc(l)}</text></svg>`;
  }
  const tri = vs.slice().sort((a, b) => (a.D.typ || 0) - (b.D.typ || 0)), v = tri[Math.floor(tri.length / 2)];
  const s = v.sil, bb = s.bb, cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2, e = Math.max(bb[2] - bb[0], bb[3] - bb[1]) * 1.25;
  const suf = s.pref + '-m' + (++_uidSil);
  return `<svg viewBox="${(cx - e / 2).toFixed(1)} ${(cy - e / 2).toFixed(1)} ${e.toFixed(1)} ${e.toFixed(1)}" style="width:${taille}px;height:${taille}px"><defs>${s.defs.split(s.pref).join(suf)}</defs>${s.paint.split(s.pref).join(suf)}</svg>`;
}

/* ---------- dérivés client ---------- */
function produitPrincipal(c) {
  const f = (c.fruits || []).slice().sort((a, b) => (b.volume_t || 0) - (a.volume_t || 0));
  return f.length ? f[0].produit : '';
}
function tonnage(c) { return (c.fruits || []).reduce((a, f) => a + (f.volume_t || 0), 0); }
function etatClient(c) {
  const ds = S.demandes.filter(d => (d.client_id ? d.client_id === c.id : d.client_nom === c.nom) && !d.archive);
  let etat = 'aucune';
  ds.forEach(d => { const p = prochaine(d); if (p.type === 'act') etat = 'act'; else if (p.type === 'wait' && etat !== 'act') etat = 'wait'; });
  return { etat, nb: ds.length, retard: ds.some(enRetard) };
}
const geoloc = c => typeof c.lat === 'number' && typeof c.lng === 'number' && isFinite(c.lat) && isFinite(c.lng);

/* ---------- vue Clients = carte ---------- */
async function renderCarte(app) {
  await chargerRef();
  const q = S.q.toLowerCase();
  const tous = S.clients;
  const filtres = tous.filter(c => {
    if (q && !(c.nom + ' ' + c.ville + ' ' + c.pays + ' ' + c.contact + ' ' + (c.cp || '') + ' ' + (c.activite || '')).toLowerCase().includes(q)) return false;
    if (CARTE.fFruit && !(c.fruits || []).some(f => f.produit === CARTE.fFruit)) return false;
    if (CARTE.fDept && c.dept !== CARTE.fDept) return false;
    if (CARTE.fEtat) { const e = etatClient(c); if (CARTE.fEtat === 'demande' && !e.nb) return false; if (CARTE.fEtat === 'act' && e.etat !== 'act') return false; if (CARTE.fEtat === 'sansgeo' && geoloc(c)) return false; }
    return true;
  });
  const parFruit = {}; tous.forEach(c => (c.fruits || []).forEach(f => parFruit[f.produit] = (parFruit[f.produit] || 0) + 1));
  const depts = [...new Set(tous.map(c => c.dept).filter(Boolean))].sort();
  const sansGeo = tous.filter(c => !geoloc(c)).length;
  const tTotal = filtres.reduce((a, c) => a + tonnage(c), 0);
  const nbDem = filtres.reduce((a, c) => a + etatClient(c).nb, 0);

  app.innerHTML = `
    <div class="ptools"><div><div class="kicker">Commercial</div><h2 class="page" style="margin:0">Clients</h2></div>
      <input class="search" id="q" placeholder="Client, ville, contact, activité…" value="${esc(S.q)}">
      <select class="chip" id="cDept" title="Département"><option value="">Tous départements</option>${depts.map(d => `<option value="${esc(d)}" ${CARTE.fDept === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>
      <div class="seg" role="group"><button class="${CARTE.fEtat === '' ? 'on' : ''}" data-etat="">Tous</button><button class="${CARTE.fEtat === 'demande' ? 'on' : ''}" data-etat="demande">Avec demande</button><button class="${CARTE.fEtat === 'act' ? 'on' : ''}" data-etat="act">À faire</button></div>
      <button class="btn grey" id="btnImport">⇪ Importer</button><button class="btn grey" id="btnNewC">＋ Nouveau client</button></div>
    <div class="chips mb" id="fruitChips">${Object.keys(parFruit).sort((a, b) => parFruit[b] - parFruit[a]).map(k =>
      `<button class="chip ${CARTE.fFruit === k ? 'on' : ''}" data-fruit="${esc(k)}"><span class="chip-ico">${iconeProduit(k, 16)}</span>${esc(nomProduit(k))}<span class="n">${parFruit[k]}</span></button>`).join('')}
      ${CARTE.fFruit ? '<button class="chip" data-fruit="">✕ tous les produits</button>' : ''}
      ${sansGeo ? `<button class="chip ${CARTE.fEtat === 'sansgeo' ? 'on' : ''}" data-etat="sansgeo" style="margin-left:auto">⌖ ${sansGeo} à géolocaliser</button>` : ''}</div>
    <div class="cstats">
      <div class="cstat"><div class="l">Clients affichés</div><div class="v">${filtres.length}<span class="muted small"> / ${tous.length}</span></div></div>
      <div class="cstat"><div class="l">Tonnage annuel</div><div class="v">${tTotal ? fmtNb(tTotal) + '<span class="muted small"> t</span>' : '—'}</div></div>
      <div class="cstat"><div class="l">Demandes en cours</div><div class="v">${nbDem}</div></div>
      <div class="cstat"><div class="l">Départements</div><div class="v">${new Set(filtres.map(c => c.dept).filter(Boolean)).size || '—'}</div></div>
    </div>
    <div class="carte-layout">
      <div class="carte-liste" id="cliste">${listeClientsHtml(filtres)}</div>
      <div class="carte-wrap"><div id="map" class="carte"></div>
        <div class="carte-ctl"><button class="btn grey sm" id="mRecentrer">Recentrer</button><button class="btn grey sm ${CARTE.fond === 'osm' ? 'on' : ''}" id="mFond">${CARTE.fond === 'osm' ? 'Fond vectoriel' : 'Fond OSM (réseau)'}</button></div>
        <div class="carte-legende"><span><i class="halo act"></i> à faire</span><span><i class="halo wait"></i> en attente</span><span><i class="halo"></i> sans demande</span></div>
      </div>
    </div>`;

  lierRecherche();
  $('#cDept').onchange = e => { CARTE.fDept = e.target.value; render(); };
  $$('.seg button[data-etat]').forEach(b => b.onclick = () => { CARTE.fEtat = b.dataset.etat; render(); });
  $$('[data-fruit]').forEach(b => b.onclick = () => { CARTE.fFruit = b.dataset.fruit; render(); });
  const sg = $('.chip[data-etat=sansgeo]'); if (sg) sg.onclick = () => { CARTE.fEtat = CARTE.fEtat === 'sansgeo' ? '' : 'sansgeo'; render(); };
  $('#btnNewC').onclick = () => editerClient(null, c => nav('#/client/' + encodeURIComponent(c.id)));
  $('#btnImport').onclick = importerClients;
  $$('#cliste [data-cid]').forEach(el => el.onclick = e => { if (e.target.closest('[data-stop]')) return; nav('#/client/' + encodeURIComponent(el.dataset.cid)); });
  $$('#cliste [data-focus]').forEach(el => el.onclick = e => { e.stopPropagation(); const c = tous.find(x => x.id === el.dataset.focus); if (c && CARTE.map && geoloc(c)) { CARTE.map.setView([c.lat, c.lng], Math.max(CARTE.map.getZoom(), 9)); const m = CARTE.couche[c.id]; if (m) m.openPopup(); } });

  monterCarte(filtres);
  $('#mRecentrer').onclick = () => cadrer(filtres);
  $('#mFond').onclick = () => { CARTE.fond = CARTE.fond === 'osm' ? 'vecteur' : 'osm'; appliquerFond(); $('#mFond').textContent = CARTE.fond === 'osm' ? 'Fond vectoriel' : 'Fond OSM (réseau)'; };
}
const fmtNb = n => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n);

function listeClientsHtml(rows) {
  if (!rows.length) return '<div class="empty">Aucun client dans cette sélection.</div>';
  return rows.slice().sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).map(c => {
    const e = etatClient(c), pp = produitPrincipal(c), t = tonnage(c);
    return `<div class="cl-row" data-cid="${c.id}">
      <div class="cl-ico halo ${e.etat}">${iconeProduit(pp, 26)}</div>
      <div class="cl-txt"><div class="cl-nom">${esc(c.nom)}${e.retard ? ' <span class="badge red">retard</span>' : ''}</div>
        <div class="cl-sub">${[c.ville, c.dept ? '(' + esc(c.dept) + ')' : '', c.pays && c.pays !== 'France' ? esc(c.pays) : ''].filter(Boolean).join(' ')}${pp ? ' · ' + esc(nomProduit(pp)) : ''}${t ? ' · ' + fmtNb(t) + ' t' : ''}</div></div>
      <div class="cl-act">${e.nb ? `<span class="badge ${e.etat === 'act' ? 'green' : 'blue'}">${e.nb}</span>` : ''}${geoloc(c) ? `<button class="btn ghost sm" data-focus="${c.id}" title="Voir sur la carte">⌖</button>` : '<span class="muted small" title="Pas de coordonnées">—</span>'}</div>
    </div>`;
  }).join('');
}

/* ---------- Leaflet ---------- */
function monterCarte(rows) {
  const el = $('#map'); if (!el || typeof L === 'undefined') return;
  CARTE.map = L.map(el, { zoomControl: true, attributionControl: false, minZoom: 4, maxZoom: 15 });
  CARTE.marqueurs = L.layerGroup().addTo(CARTE.map);
  appliquerFond();
  CARTE.couche = {};
  rows.filter(geoloc).forEach(c => {
    const e = etatClient(c), pp = produitPrincipal(c);
    const ic = L.divIcon({ className: 'mk', html: `<div class="mk-halo ${e.etat}${e.retard ? ' late' : ''}">${iconeProduit(pp, 30)}</div>`, iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -18] });
    const m = L.marker([c.lat, c.lng], { icon: ic, title: c.nom }).addTo(CARTE.marqueurs);
    m.bindPopup(`<div class="mk-pop"><b>${esc(c.nom)}</b><div class="muted small">${esc(c.ville || '')}${c.activite ? ' · ' + esc(c.activite) : ''}</div>
      ${(c.fruits || []).length ? `<div class="small">${c.fruits.map(f => esc(nomProduit(f.produit)) + (f.volume_t ? ' ' + fmtNb(f.volume_t) + ' t' : '')).join(' · ')}</div>` : ''}
      ${e.nb ? `<div class="small">${e.nb} demande${e.nb > 1 ? 's' : ''} en cours</div>` : ''}
      <a class="btn sm" href="#/client/${encodeURIComponent(c.id)}" style="margin-top:6px">Ouvrir la fiche</a></div>`);
    CARTE.couche[c.id] = m;
  });
  cadrer(rows);
}
function appliquerFond() {
  const map = CARTE.map; if (!map) return;
  if (CARTE.base) { map.removeLayer(CARTE.base); CARTE.base = null; }
  if (CARTE.tuiles) { map.removeLayer(CARTE.tuiles); CARTE.tuiles = null; }
  $('#map').classList.toggle('osm', CARTE.fond === 'osm');
  if (CARTE.fond === 'osm') {
    CARTE.tuiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);
    return;
  }
  CARTE.base = fondVecteur(map, { etiquettes: true, pays: true });
}
/* Fond vectoriel embarqué : pays voisins (dessous) + départements (dessus). Retourne le layerGroup. */
let _geoCache = null;
function chargerGeo() {
  if (!_geoCache) _geoCache = Promise.all([fetch('/static/commercial/vendor/pays-voisins.json').then(r => r.json()), fetch('/static/commercial/vendor/departements.json').then(r => r.json())]).catch(() => [null, null]);
  return _geoCache;
}
function fondVecteur(map, o) {
  o = o || {};
  const grp = L.layerGroup().addTo(map);
  const style = { pays: { color: '#c3ccd7', weight: 1, fill: true, fillColor: '#eef1f5', fillOpacity: 1 },
                  dept: { color: '#b9c2cd', weight: 1, fill: true, fillColor: '#fff', fillOpacity: 1 } };
  chargerGeo().then(([pays, depts]) => {
    if (!depts || !map.hasLayer(grp)) return;
    if (o.pays !== false && pays) L.geoJSON(pays, { style: style.pays, interactive: false }).addTo(grp);
    const gd = L.geoJSON(depts, { style: style.dept, interactive: false }).addTo(grp);
    if (o.etiquettes) {
      const maj = () => gd.eachLayer(l => { const code = l.feature && l.feature.properties.code; if (!code) return;
        if (map.getZoom() >= 7) { if (!l.getTooltip()) l.bindTooltip(code, { permanent: true, direction: 'center', className: 'dept-lbl' }); } else if (l.getTooltip()) l.unbindTooltip(); });
      maj(); map.on('zoomend', maj);
    }
  });
  return grp;
}
function cadrer(rows) {
  const map = CARTE.map; if (!map) return;
  const pts = rows.filter(geoloc).map(c => [c.lat, c.lng]);
  if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.25));
  else if (pts.length === 1) map.setView(pts[0], 8);
  else map.setView([46.6, 2.4], 6);
}

/* ---------- mini-carte de la fiche client ---------- */
function miniCarte(el, c) {
  if (!el || typeof L === 'undefined' || !geoloc(c)) return;
  const m = L.map(el, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false });
  fondVecteur(m, { etiquettes: false, pays: true });
  const ic = L.divIcon({ className: 'mk', html: `<div class="mk-halo ${etatClient(c).etat}">${iconeProduit(produitPrincipal(c), 30)}</div>`, iconSize: [40, 40], iconAnchor: [20, 20] });
  L.marker([c.lat, c.lng], { icon: ic }).addTo(m);
  m.setView([c.lat, c.lng], 8);
}

/* ---------- carte compacte du portefeuille (page d'accueil) ---------- */
/* el : conteneur ; rows : clients ; o.sel : id client sélectionné ; o.onSelect(id) ; o.onFiche(id) */
function carteCompacte(el, rows, o) {
  if (!el || typeof L === 'undefined') return null;
  o = o || {};
  const map = L.map(el, { zoomControl: true, attributionControl: false, minZoom: 4, maxZoom: 15, zoomSnap: 0.5 });
  fondVecteur(map, { etiquettes: true, pays: true });
  const grp = L.layerGroup().addTo(map), couche = {};
  rows.filter(geoloc).forEach(c => {
    const e = etatClient(c), sel = c.id === o.sel;
    const ic = L.divIcon({ className: 'mk', html: `<div class="mk-halo ${e.etat}${e.retard ? ' late' : ''}${sel ? ' sel' : ''}">${iconeProduit(produitPrincipal(c), sel ? 30 : 24)}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] });
    const m = L.marker([c.lat, c.lng], { icon: ic, title: c.nom, zIndexOffset: sel ? 1000 : 0 }).addTo(grp);
    m.bindTooltip(`<b>${esc(c.nom)}</b><br><span class="muted">${esc(c.ville || '')}${e.nb ? ' · ' + e.nb + ' en cours' : ''}</span>`, { direction: 'top', offset: [0, -18], className: 'mk-tip' });
    m.on('click', () => { if (o.onSelect) o.onSelect(c.id); });
    couche[c.id] = m;
  });
  const pts = rows.filter(geoloc);
  const selC = pts.find(c => c.id === o.sel);
  if (selC) map.setView([selC.lat, selC.lng], Math.max(map.getZoom() || 0, 8));
  else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts.map(c => [c.lat, c.lng])).pad(0.06));
  else if (pts.length === 1) map.setView([pts[0].lat, pts[0].lng], 8);
  else map.setView([44.3, 0.8], 7);
  return { map, couche, centrer(id) { const c = pts.find(x => x.id === id); if (c) map.flyTo([c.lat, c.lng], Math.max(map.getZoom(), 8), { duration: .5 }); } };
}

/* ---------- recherche d'adresse en direct ----------
   France : géocodeur de la Géoplateforme (Base Adresse Nationale, sans clé), repli api-adresse.data.gouv.fr.
   Autres pays : Nominatim (OSM). Aucune clé, aucun compte ; nécessite l'accès réseau depuis le poste. */
const PAYS_CODE = { france: 'fr', espagne: 'es', italie: 'it', portugal: 'pt', belgique: 'be', allemagne: 'de', suisse: 'ch', 'pays-bas': 'nl', pologne: 'pl', maroc: 'ma', tunisie: 'tn', algerie: 'dz', algérie: 'dz', chili: 'cl', argentine: 'ar', 'afrique du sud': 'za', turquie: 'tr', grece: 'gr', grèce: 'gr', 'royaume-uni': 'gb', egypte: 'eg', égypte: 'eg', 'nouvelle-zelande': 'nz', 'nouvelle-zélande': 'nz' };
const estFrance = pays => { const p = (pays || '').trim().toLowerCase(); return !p || p === 'france' || p === 'fr'; };
async function suggererAdresses(q, pays) {
  q = q.trim(); if (q.length < 3) return [];
  if (estFrance(pays)) {
    const urls = ['https://data.geopf.fr/geocodage/search?limit=6&autocomplete=1&q=', 'https://api-adresse.data.gouv.fr/search/?limit=6&autocomplete=1&q='];
    for (const u of urls) {
      try {
        const r = await fetch(u + encodeURIComponent(q)); if (!r.ok) continue;
        const j = await r.json();
        return (j.features || []).map(f => { const p = f.properties, ctx = (p.context || '').split(',')[0].trim();
          return { label: p.label, adresse: p.type === 'municipality' ? '' : p.name, cp: p.postcode || '', ville: p.city || '', dept: ctx, pays: 'France', lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] }; });
      } catch (e) { /* source suivante */ }
    }
    return [];
  }
  const cc = PAYS_CODE[(pays || '').trim().toLowerCase()];
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&accept-language=fr' + (cc ? '&countrycodes=' + cc : '') + '&q=' + encodeURIComponent(q);
  const r = await fetch(url); if (!r.ok) return [];
  const j = await r.json();
  return j.map(x => { const a = x.address || {};
    const voie = [a.house_number, a.road].filter(Boolean).join(' ');
    return { label: x.display_name, adresse: voie, cp: a.postcode || '', ville: a.city || a.town || a.village || a.municipality || '', dept: '', pays: a.country || pays, lat: parseFloat(x.lat), lng: parseFloat(x.lon) }; });
}
/* branche une liste de propositions sous un champ : input = champ, box = conteneur .sugg, o = {pays(), onPick(r)} */
function autocompleteAdresse(input, box, o) {
  if (!input || !box) return;
  let timer = null, seq = 0, items = [], idx = -1;
  const fermer = () => { box.classList.add('hidden'); box.innerHTML = ''; items = []; idx = -1; };
  const montrer = () => {
    if (!items.length) { box.innerHTML = '<div class="sugg-vide">Aucune adresse trouvée</div>'; box.classList.remove('hidden'); return; }
    box.innerHTML = items.map((r, i) => `<div class="sugg-it ${i === idx ? 'on' : ''}" data-i="${i}"><b>${esc(r.adresse || r.ville)}</b>${r.adresse ? ` <span class="muted">${esc([r.cp, r.ville].filter(Boolean).join(' '))}</span>` : ''}${r.dept ? ` <span class="muted small">(${esc(r.dept)})</span>` : ''}${!estFrance(o.pays && o.pays()) ? `<div class="muted small">${esc(r.label).slice(0, 90)}</div>` : ''}</div>`).join('');
    box.classList.remove('hidden');
    box.querySelectorAll('.sugg-it').forEach(el => { el.onmousedown = e => { e.preventDefault(); choisir(+el.dataset.i); }; });
  };
  const choisir = i => { const r = items[i]; if (!r) return; fermer(); o.onPick(r); };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value, delai = estFrance(o.pays && o.pays()) ? 250 : 600;   // Nominatim : 1 requête/s maximum
    if (q.trim().length < 3) { fermer(); return; }
    timer = setTimeout(async () => {
      const mien = ++seq; box.innerHTML = '<div class="sugg-vide">Recherche…</div>'; box.classList.remove('hidden');
      try { const res = await suggererAdresses(q, o.pays && o.pays()); if (mien !== seq) return; items = res; idx = -1; montrer(); }
      catch (e) { if (mien === seq) { box.innerHTML = '<div class="sugg-vide">Recherche impossible (réseau ?)</div>'; } }
    }, delai);
  });
  input.addEventListener('keydown', e => {
    if (box.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown') { idx = Math.min(items.length - 1, idx + 1); montrer(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); montrer(); e.preventDefault(); }
    else if (e.key === 'Enter') { if (idx >= 0) { choisir(idx); e.preventDefault(); } }
    else if (e.key === 'Escape') fermer();
  });
  input.addEventListener('blur', () => setTimeout(fermer, 150));
}

/* ---------- géocodage (Nominatim, réseau, 1 requête/s) ---------- */
async function geocoder(c) {
  const q = [c.adresse, c.cp, c.ville, c.pays || 'France'].filter(Boolean).join(', ');
  if (!q.trim()) return null;
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q);
  const r = await fetch(url, { headers: { 'Accept-Language': 'fr' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (!j.length) return null;
  return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) };
}

/* ---------- import CSV / Excel ---------- */
const IMPORT_COLS = {
  nom: ['nom', 'client', 'societe', 'société', 'raison sociale', 'name'], activite: ['activite', 'activité', 'type'],
  adresse: ['adresse', 'address', 'rue'], cp: ['cp', 'code postal', 'code_postal', 'codepostal', 'zip'], ville: ['ville', 'commune', 'city'],
  dept: ['dept', 'departement', 'département', 'dep'], pays: ['pays', 'country'], fruits: ['fruits', 'produits', 'productions', 'fruit'],
  volumes: ['volumes_t', 'volumes', 'tonnage', 'tonnages', 'volume'], contact: ['contact', 'interlocuteur'], tel: ['tel', 'telephone', 'téléphone', 'tél', 'phone'],
  email: ['email', 'mail', 'e-mail', 'courriel'], notes: ['notes', 'commentaire', 'remarques'], lat: ['lat', 'latitude'], lng: ['lng', 'lon', 'longitude'],
};
const normCle = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
function mapperEntetes(h) {
  const out = {};
  h.forEach((col, i) => { const n = normCle(col); for (const k in IMPORT_COLS) if (IMPORT_COLS[k].some(a => normCle(a) === n)) { out[k] = i; break; } });
  return out;
}
function produitDepuisLibelle(lib) {
  const n = normCle(lib);
  for (const p of listeProduits()) { const pn = normCle(p.nom), pk = normCle(p.k); if (n === pn || n === pk || n === pn.replace(/s$/, '') || n + 's' === pn || n + 's' === pk) return p.k; }
  const alias = { pomme: 'pommes', poire: 'poires', kiwi: 'kiwis', melon: 'melons', mangue: 'mangues', peche: 'peches', nectarine: 'peches', abricot: 'abricots', prune: 'prunes', cerise: 'cerises', tomate: 'tomates', agrume: 'agrumes', orange: 'agrumes', clementine: 'agrumes', citron: 'agrumes', avocat: 'avocats', carotte: 'carottes', oignon: 'oignons', poivron: 'poivrons', concombre: 'concombres', courgette: 'courgettes', aubergine: 'aubergines', pommedeterre: 'pommesdeterre', patate: 'pommesdeterre', choudebruxelles: 'chouxbruxelles' };
  for (const a in alias) if (n.startsWith(a)) return alias[a];
  return n || 'autre';
}
function lignesVersClients(rows, mp) {
  return rows.map(r => {
    const g = k => mp[k] != null ? String(r[mp[k]] == null ? '' : r[mp[k]]).trim() : '';
    if (!g('nom')) return null;
    const fruits = g('fruits').split(/[;,/|]+/).map(s => s.trim()).filter(Boolean);
    const vols = g('volumes').split(/[;,/|]+/).map(s => parseFloat(s.replace(/[\s ]/g, '').replace(',', '.')));
    const c = { nom: g('nom'), activite: g('activite'), adresse: g('adresse'), cp: g('cp'), ville: g('ville'), dept: g('dept'), pays: g('pays') || 'France',
      contact: g('contact'), tel: g('tel'), email: g('email'), notes: g('notes'),
      fruits: fruits.map((f, i) => ({ produit: produitDepuisLibelle(f), volume_t: isFinite(vols[i]) ? vols[i] : null })) };
    if (!c.dept && /^\d{5}$/.test(c.cp) && c.pays === 'France') c.dept = c.cp.startsWith('20') ? (c.cp < '20200' ? '2A' : '2B') : c.cp.slice(0, 2);
    const la = parseFloat(g('lat').replace(',', '.')), ln = parseFloat(g('lng').replace(',', '.'));
    if (isFinite(la) && isFinite(ln)) { c.lat = la; c.lng = ln; }
    return c;
  }).filter(Boolean);
}
function chargerScript(src) { return new Promise((ok, ko) => { if (document.querySelector(`script[src="${src}"]`)) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = ko; document.head.appendChild(s); }); }

function importerClients() {
  let apercu = [];
  const bg = modal({
    title: 'Importer des clients (CSV ou Excel)',
    body: `<div class="hint mb">Colonnes reconnues : nom · activité · adresse · code postal · ville · département · pays · fruits (plusieurs : séparés par , ou /) · volumes_t (même ordre, même séparateur) · contact · téléphone · email · notes · lat · lng. L'ordre est libre, les entêtes sont détectées.</div>
      <div class="dropzone" id="dz">Déposer un fichier ici ou <label class="lnk">choisir un fichier<input type="file" id="fimp" accept=".csv,.txt,.xlsx,.xls" hidden></label></div>
      <div id="impState" class="muted small mt"></div>
      <div id="impPrev" class="mt"></div>
      <label class="check mt" id="impGeoL"><input type="checkbox" id="impGeo"> Géocoder les lignes sans coordonnées (Nominatim, réseau, ~1 s par client)</label>`,
    okLabel: 'Importer', onOk: async () => {
      if (!apercu.length) { toast('Aucune ligne à importer.', true); return false; }
      const geo = $('#impGeo').checked; let n = 0, ng = 0;
      for (const c of apercu) {
        if (geo && !(c.lat && c.lng)) { try { const p = await geocoder(c); if (p) { c.lat = p.lat; c.lng = p.lng; ng++; } await new Promise(r => setTimeout(r, 1100)); } catch (e) { } }
        try { await api('/api/clients', { method: 'POST', body: c, silent: true }); n++; } catch (e) { }
        $('#impState').textContent = `${n} / ${apercu.length} importés${geo ? ' · ' + ng + ' géocodés' : ''}…`;
      }
      toast(`${n} client${n > 1 ? 's' : ''} importé${n > 1 ? 's' : ''} ✓`);
      S.clients = await GET('/api/clients'); render();
    }
  });
  const lire = async file => {
    $('#impState').textContent = 'Lecture de ' + file.name + '…';
    let rows;
    try {
      if (/\.xlsx?$/i.test(file.name)) {
        await chargerScript('/static/commercial/vendor/xlsx.min.js');
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      } else {
        await chargerScript('/static/commercial/vendor/papaparse.min.js');
        const txt = await file.text();
        rows = Papa.parse(txt.replace(/^﻿/, ''), { skipEmptyLines: true, delimiter: '' }).data;
      }
    } catch (e) { $('#impState').textContent = 'Fichier illisible : ' + e.message; return; }
    if (!rows || rows.length < 2) { $('#impState').textContent = 'Fichier vide.'; return; }
    const mp = mapperEntetes(rows[0]);
    if (mp.nom == null) { $('#impState').textContent = 'Colonne « nom » introuvable. Entêtes lues : ' + rows[0].join(' · '); return; }
    apercu = lignesVersClients(rows.slice(1), mp);
    const sansGeo = apercu.filter(c => !(c.lat && c.lng)).length;
    $('#impState').innerHTML = `<b>${apercu.length}</b> client(s) lus · ${Object.keys(mp).length} colonnes reconnues (${Object.keys(mp).join(', ')})${sansGeo ? ` · <b>${sansGeo}</b> sans coordonnées` : ''}`;
    $('#impPrev').innerHTML = `<table class="grid"><thead><tr><th>Nom</th><th>Ville</th><th>Dépt</th><th>Produits</th><th>Coord.</th></tr></thead><tbody>${apercu.slice(0, 8).map(c =>
      `<tr style="cursor:default"><td>${esc(c.nom)}</td><td>${esc(c.ville)}</td><td>${esc(c.dept)}</td><td>${c.fruits.map(f => esc(nomProduit(f.produit)) + (f.volume_t ? ' ' + fmtNb(f.volume_t) + ' t' : '')).join(', ') || '—'}</td><td>${c.lat ? '✓' : '—'}</td></tr>`).join('')}</tbody></table>${apercu.length > 8 ? `<div class="muted small mt">… et ${apercu.length - 8} autres</div>` : ''}`;
  };
  $('#fimp').onchange = e => { if (e.target.files[0]) lire(e.target.files[0]); };
  const dz = $('#dz');
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('over'); }; dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove('over'); if (e.dataTransfer.files[0]) lire(e.dataTransfer.files[0]); };
}
