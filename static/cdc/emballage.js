/* ============================================================
   CDC EMBALLAGE — MAF RODA · moteur de la page
   ------------------------------------------------------------
   Architecture héritée du CDC Précalibrage (pages/onglets, barre de
   progression, sauvegarde auto, export/import JSON, récap PDF), mais
   logique de CONSTRUCTION : des lignes, des étapes, des ressources
   partagées (vidage, palettisation), deux catalogues (palox, formats).

   Modes de projet :
     neuf    — plusieurs lignes neuves (vidage / palettisation indépendants,
               mutualisés ou mixtes)
     unique  — une seule ligne neuve (pas de mutualisation)
     modif   — modification de lignes existantes (sections à modifier)

   État S (v:2) :
     gen, projet{mode,notes}, palox[], formats[], lignes[], vidage{mode,groupes[]},
     palettisation{mode,groupes[]}, fichiers[], ui{page,ligne}, sauveLe
   Hors Gestionnaire : localStorage. Avec ?demande=<id> : API du Gestionnaire.
   ============================================================ */
'use strict';

/* ================= OUTILS ================= */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = p => (p || 'x') + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
const dateAuj = () => { const d = new Date(); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); };
const machDef = k => MACHINES.find(m => m.k === k);
const vidDef = k => VIDAGES.find(v => v.k === k || v.lbl === k);      // clé ou libellé (les radios stockent le libellé)
const palDef = k => PALETTISATIONS.find(p => p.k === k || p.lbl === k);
const teteDef = k => ETAPES_TETE.find(e => e.k === k);

function get(path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), S); }
function set(path, val) {
  const ks = path.split('.'); let o = S;
  for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null) o[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {}; o = o[ks[i]]; }
  o[ks[ks.length - 1]] = val;
}
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.classList.toggle('err', !!err); t.classList.add('visible');
  clearTimeout(t._m); t._m = setTimeout(() => t.classList.remove('visible'), err ? 4000 : 2600);
}

/* ================= CONTEXTE GESTIONNAIRE ================= */
const P = new URLSearchParams(location.search);
const DEMANDE = P.get('demande');
const LECTURE = P.get('lecture') === '1';
const API = DEMANDE ? `/api/demandes/${encodeURIComponent(DEMANDE)}/cdc/emballage` : null;
const CLE_STOCKAGE = 'cdc-emballage-v2';
let META = null;          // {demande:{…}, complet} quand branché au Gestionnaire
let FIGEE = LECTURE;      // consultation seule

/* ================= ÉTAT ================= */
function etatVierge() {
  return {
    v: 2,
    gen: { comP: '', comN: '', email: '', client: '', pays: 'France', retour: dateAuj(), fruits: [], fruitsAutre: '', varietes: '',
           tonnageAn: '', tonnageH: '', tempsTravail: '', description: '', version: '', notes: '' },
    projet: { mode: '', notes: '' },
    palox: [],
    formats: [],
    lignes: [],
    vidage: { mode: '', groupes: [], notes: '' },
    palettisation: { mode: '', groupes: [], notes: '' },
    fichiers: [],
    ui: { page: 0, ligne: 0 },
    sauveLe: null,
  };
}
function ligneVierge(n) {
  const l = { id: uid('l'), nom: 'Ligne ' + n, debit: '', produits: '', formats: [], notes: '', machines: [], tete: {}, existant: {} };
  ETAPES_TETE.forEach(e => l.tete[e.k] = { actif: e.k !== 'brosseuse', opts: {}, notes: '' });
  SECTIONS_EXISTANT.forEach(s => l.existant[s.k] = { present: 'Oui', description: '', modifier: false, remplacer: '', remplacerDetail: '', notes: '' });
  return l;
}
const paloxVierge = () => { const p = { id: uid('p') }; PALOX_DEF.forEach(d => p[d.k] = ''); p.notes = ''; return p; };
const formatVierge = () => ({ id: uid('f'), nom: '', type: '', L: '', l: '', h: '', poids: '', colisCouche: '', couches: '', intercalaires: '', demi: '', palettes: [], corniere: '', nbLiens: '', notes: '' });
const machineVierge = k => ({ id: uid('m'), k, opts: {}, acc: [], notes: '' });
const groupeVidage = n => ({ id: uid('v'), nom: 'Vidage ' + n, type: '', typeAutre: '', lignes: [], palox: [], opts: {}, notes: '' });
const groupePalett = n => ({ id: uid('g'), nom: 'Palettisation ' + n, type: '', typeAutre: '', lignes: [], opts: {}, notes: '' });

let S = etatVierge();
const MODES = {
  neuf:   { lbl: 'Emballage neuf — plusieurs lignes', sous: 'Vidage et palettisation indépendants, mutualisés ou mixtes' },
  unique: { lbl: 'Une seule ligne d\'emballage', sous: 'Ligne neuve complète, du vidage à la palettisation' },
  modif:  { lbl: 'Modification de lignes existantes', sous: 'Décrire l\'existant et ce qui doit changer' },
};

/* ================= PAGES (dépendent du mode) ================= */
function pages() {
  const m = S.projet.mode;
  const p = [{ k: 'gen', lbl: 'Général', r: pageGeneral }, { k: 'projet', lbl: 'Projet', r: pageProjet }];
  if (!m) return p;
  p.push({ k: 'cat', lbl: 'Palox & formats', r: pageCatalogues });
  if (m === 'neuf') p.push({ k: 'vidage', lbl: 'Vidage', r: pageVidage }, { k: 'lignes', lbl: 'Lignes', r: pageLignes }, { k: 'palett', lbl: 'Palettisation', r: pagePalettisation });
  if (m === 'unique') p.push({ k: 'lignes', lbl: 'La ligne', r: pageLignes });
  if (m === 'modif') p.push({ k: 'lignes', lbl: 'Lignes existantes', r: pageLignes });
  p.push({ k: 'schema', lbl: 'Schéma', r: pageSchema });
  return p;
}

/* ================= GÉNÉRATEURS DE CHAMPS =================
   Tous les champs portent data-bind="chemin.dans.S". */
function champTexte(path, lbl, o = {}) {
  const v = get(path) ?? '';
  const type = o.t === 'nombre' ? 'number' : o.t === 'email' ? 'email' : o.t === 'date' ? 'text' : 'text';
  return `<div class="rang" id="r_${cssId(path)}"><label class="etq" for="i_${cssId(path)}">${esc(lbl)}${o.req ? '<span class="req">*</span>' : ''}</label>
    <input type="${type}" id="i_${cssId(path)}" class="${o.cls || ''}" data-bind="${path}" value="${esc(v)}" placeholder="${esc(o.ph || '')}" ${o.step ? `step="${o.step}"` : ''}>
    ${o.sous ? `<div class="sous-etq">${esc(o.sous)}</div>` : ''}<div class="msg-err">Ce champ est obligatoire.</div></div>`;
}
function champZone(path, lbl, o = {}) {
  return `<div class="rang" id="r_${cssId(path)}"><label class="etq" for="i_${cssId(path)}">${esc(lbl)}${o.req ? '<span class="req">*</span>' : ''}</label>
    <textarea id="i_${cssId(path)}" class="${o.notes ? 'notes' : ''}" data-bind="${path}" placeholder="${esc(o.ph || '')}">${esc(get(path) ?? '')}</textarea>
    ${o.sous ? `<div class="sous-etq">${esc(o.sous)}</div>` : ''}<div class="msg-err">Ce champ est obligatoire.</div></div>`;
}
function champNotes(path, lbl) { return champZone(path, lbl || 'Notes pour l\'implantation', { notes: 1, ph: 'Remarques, contraintes, souhaits du client…' }); }
function champListe(path, lbl, choix, o = {}) {
  const v = get(path) ?? '';
  return `<div class="rang" id="r_${cssId(path)}"><label class="etq">${esc(lbl)}${o.req ? '<span class="req">*</span>' : ''}</label>
    <select data-bind="${path}" data-rerender="${o.rerender ? 1 : ''}"><option value="">${esc(o.ph || 'Veuillez sélectionner')}</option>${choix.map(c => `<option ${c === v ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
    <div class="msg-err">Ce champ est obligatoire.</div></div>`;
}
function champRadio(path, lbl, choix, o = {}) {
  const v = get(path) ?? '', autre = o.autre ? get(path + 'Autre') ?? '' : null;
  return `<div class="rang" id="r_${cssId(path)}"><span class="etq">${esc(lbl)}${o.req ? '<span class="req">*</span>' : ''}</span>
    <div class="choix ${o.inline === false ? '' : 'inline'}">${choix.map(c => `<label class="opt"><input type="radio" name="rg_${cssId(path)}" data-bind="${path}" data-rerender="${o.rerender ? 1 : ''}" value="${esc(c)}" ${c === v ? 'checked' : ''}><span>${esc(c)}</span></label>`).join('')}</div>
    ${o.autre ? `<input type="text" class="autre-txt" data-bind="${path}Autre" placeholder="Préciser…" value="${esc(autre)}" style="${/autre/i.test(v) ? '' : 'display:none'}">` : ''}
    <div class="msg-err">Ce champ est obligatoire.</div></div>`;
}
function champCases(path, lbl, choix, o = {}) {
  const v = get(path) || [], autre = o.autre ? get(path + 'Autre') ?? '' : null;
  return `<div class="rang" id="r_${cssId(path)}"><span class="etq">${esc(lbl)}${o.req ? '<span class="req">*</span>' : ''}</span>
    <div class="choix ${o.inline === false ? '' : 'inline'}">${choix.map(c => `<label class="opt"><input type="checkbox" data-bind="${path}" data-multi="1" value="${esc(c)}" ${v.includes(c) ? 'checked' : ''}><span>${esc(c)}</span></label>`).join('')}</div>
    ${o.autre ? `<input type="text" class="autre-txt" data-bind="${path}Autre" placeholder="Préciser…" value="${esc(autre)}" style="${v.some(x => /autre/i.test(x)) ? '' : 'display:none'}">` : ''}
    <div class="msg-err">Choisir au moins une option.</div></div>`;
}
/* Rend une liste d'options du catalogue ({k,lbl,t,choix,ph}) sous un chemin de base */
function champsOpts(base, opts) {
  if (!opts || !opts.length) return '';
  return `<div class="grille">${opts.map(o => {
    const p = base + '.' + o.k;
    if (o.t === 'radio') return champRadio(p, o.lbl, o.choix);
    if (o.t === 'cases') return champCases(p, o.lbl, o.choix);
    if (o.t === 'liste') return champListe(p, o.lbl, o.choix);
    return champTexte(p, o.lbl, { t: o.t, ph: o.ph });
  }).join('')}</div>`;
}
/* Puces d'affectation (liste d'ids cochables) */
function puces(path, items, lblVide) {
  const v = get(path) || [];
  if (!items.length) return `<div class="puces"><span class="puce vide">${esc(lblVide || 'Rien à affecter pour le moment')}</span></div>`;
  return `<div class="puces">${items.map(it => `<button type="button" class="puce ${v.includes(it.id) ? 'on' : ''}" data-toggle="${path}" data-id="${it.id}">${esc(it.lbl)}</button>`).join('')}</div>`;
}
function grosChoix(path, choix) {           // choix = [{k,lbl,sous}]
  const v = get(path);
  return `<div class="btn-choix">${choix.map(c => `<button type="button" class="b-choix ${v === c.k ? 'actif' : ''}" data-set="${path}" data-val="${c.k}">${esc(c.lbl)}${c.sous ? `<small>${esc(c.sous)}</small>` : ''}</button>`).join('')}</div>`;
}
const cssId = p => p.replace(/[^\w]/g, '_');
const lblLigne = l => l.nom || 'Ligne sans nom';
const lblPalox = p => p.nom || [p.largeur, p.longueur, p.hauteur].filter(Boolean).join('×') || 'Palox sans nom';
const lblFormat = f => f.nom || [f.L, f.l, f.h].filter(Boolean).join('×') || 'Format sans nom';

/* ================= PAGE GÉNÉRAL ================= */
function pageGeneral() {
  return `<h2>Général</h2><p class="intro">Informations générales du dossier — préremplies depuis la demande quand le CDC est ouvert depuis le Gestionnaire.</p>
    <div class="sect"><h3>Interlocuteurs</h3>
      <div class="rang" id="r_gen_com"><span class="etq">Commercial<span class="req">*</span></span>
        <div class="ligne-multi"><span>Prénom<input type="text" class="court" data-bind="gen.comP" value="${esc(S.gen.comP)}"></span><span>Nom<input type="text" class="court" data-bind="gen.comN" value="${esc(S.gen.comN)}"></span></div><div class="msg-err">Ce champ est obligatoire.</div></div>
      ${champTexte('gen.email', 'Votre email', { t: 'email', req: 1, sous: 'exemple@exemple.com' })}
      ${champTexte('gen.client', 'Client', { req: 1 })}
      ${champListe('gen.pays', 'Pays', PAYS)}
      ${champTexte('gen.retour', 'Retour souhaité pour le', { sous: 'JJ/MM/AAAA', cls: 'court' })}
    </div>
    <div class="sect"><h3>Produits & débits</h3>
      ${champCases('gen.fruits', 'Fruits', FRUITS, { req: 1, autre: 1 })}
      ${champZone('gen.varietes', 'Variétés')}
      <div class="grille">${champTexte('gen.tonnageAn', 'Tonnage annuel', { ph: 'Ex : 15 000 T' })}${champTexte('gen.tonnageH', 'Tonnage horaire (T/h)', { req: 1, ph: 'Ex : 10 T/h' })}${champTexte('gen.tempsTravail', 'Temps de travail', { ph: 'Ex : 8 h/j, 5 j/7, 6 mois' })}</div>
    </div>
    <div class="sect"><h3>Projet</h3>
      ${champZone('gen.description', 'Description du projet')}
      ${champTexte('gen.version', 'Version du CDC', { cls: 'mini', ph: 'Ex : 1' })}
      <div class="rang"><span class="etq">Fichiers à partager</span>
        <div class="zone-dep" id="zoneDep">Glisser des fichiers ici ou cliquer pour sélectionner<br><small>(seuls les noms sont conservés dans le CDC — plans, photos, implantation existante…)</small></div>
        <input type="file" id="inpFic" multiple style="display:none"><ul id="lstFichiers">${S.fichiers.map((f, i) => `<li>📎 ${esc(f)}<button class="fx" data-delfic="${i}" title="Retirer">✕</button></li>`).join('')}</ul></div>
      ${champNotes('gen.notes', 'Notes générales')}
    </div>`;
}

/* ================= PAGE PROJET ================= */
function pageProjet() {
  const m = S.projet.mode;
  let h = `<h2>Projet</h2><p class="intro">Le type de projet détermine les pages suivantes. On peut le changer ensuite sans perdre la saisie.</p>
    <div class="sect"><h3>Type de projet<span class="req" style="color:var(--rouge)">*</span></h3>
      ${grosChoix('projet.mode', Object.entries(MODES).map(([k, v]) => ({ k, lbl: v.lbl, sous: v.sous })))}</div>`;
  if (m) {
    const unique = m === 'unique';
    h += `<div class="sect"><h3>${unique ? 'La ligne' : (m === 'modif' ? 'Lignes existantes concernées' : 'Lignes d\'emballage')}<span class="compteur">${S.lignes.length}</span></h3>
      <p class="gs-sous">${unique ? 'Nommer la ligne (ex : « Ligne pomme 20 T/h »).' : m === 'modif' ? 'Une entrée par ligne existante à modifier. Le détail des modifications se saisit dans l\'onglet « Lignes existantes ».' : 'Une entrée par ligne neuve. Le détail de chaque ligne se saisit dans l\'onglet « Lignes ».'}</p>
      ${S.lignes.map((l, i) => `<div class="sect" style="background:#fff"><h3><span class="num">L${i + 1}</span>${esc(lblLigne(l))}</h3>
        ${S.lignes.length > 1 && !unique ? `<button class="sect-x" data-del-ligne="${i}" title="Supprimer la ligne">×</button>` : ''}
        <div class="grille">${champTexte(`lignes.${i}.nom`, 'Nom de la ligne', { req: 1 })}${champTexte(`lignes.${i}.debit`, 'Débit visé (T/h ou colis/h)', { ph: 'Ex : 8 T/h' })}${champTexte(`lignes.${i}.produits`, 'Produits sur cette ligne', { ph: 'Ex : Pomme, Poire' })}</div></div>`).join('')}
      ${unique ? '' : `<button class="b-ajout" data-add-ligne="1">＋ Ajouter une ligne</button>`}</div>
      ${champNotes('projet.notes', 'Notes sur le projet (organisation générale, contraintes du bâtiment, phasage…)')}`;
  }
  return h;
}

/* ================= PAGE CATALOGUES (palox, formats) ================= */
function pageCatalogues() {
  const modif = S.projet.mode === 'modif';
  return `<h2>Palox & formats</h2><p class="intro">Deux catalogues réutilisés dans tout le CDC : les palox affectés aux vidages, les formats de colis affectés aux lignes. ${modif ? 'En modification, ne décrire que ce qui est concerné par le changement.' : ''}</p>
    <div class="sect"><h3>Palox<span class="compteur">${S.palox.length}</span></h3><p class="gs-sous">Même fiche que le CDC Précalibrage. ${modif ? '' : 'Au moins un palox est nécessaire pour décrire un vidage.'}</p>
      ${S.palox.map((p, i) => `<div class="sect" style="background:#fff"><h3><span class="num">P${i + 1}</span>${esc(lblPalox(p))}</h3><button class="sect-x" data-del="palox.${i}" title="Supprimer">×</button>
        <div class="grille">${PALOX_DEF.map(d => d.t === 'liste' ? champListe(`palox.${i}.${d.k}`, d.lbl, d.choix, { ph: 'Sélectionner' }) : champTexte(`palox.${i}.${d.k}`, d.lbl, { ph: d.ph, req: d.k === 'nom' })).join('')}</div>
        ${champZone(`palox.${i}.notes`, 'Notes', { notes: 1 })}</div>`).join('') || '<div class="info">Aucun palox pour le moment.</div>'}
      <button class="b-ajout" data-add="palox">＋ Ajouter un palox</button></div>
    <div class="sect"><h3>Formats de colis & conditionnement<span class="compteur">${S.formats.length}</span></h3><p class="gs-sous">Obligatoires : nom, dimensions, poids. Le reste précise la palettisation de ce format.</p>
      ${S.formats.map((f, i) => `<div class="sect" style="background:#fff"><h3><span class="num">F${i + 1}</span>${esc(lblFormat(f))}</h3><button class="sect-x" data-del="formats.${i}" title="Supprimer">×</button>
        <div class="grille">${champTexte(`formats.${i}.nom`, 'Nom du format', { req: 1, ph: 'Ex : Plateau 60×40 1 rang' })}${champListe(`formats.${i}.type`, 'Type', FORMAT_TYPES)}</div>
        <div class="rang" id="r_formats_${i}_dims"><span class="etq">Dimensions du colis (mm)<span class="req">*</span></span>
          <div class="ligne-multi"><span>Longueur<input type="text" class="mini" data-bind="formats.${i}.L" value="${esc(f.L)}"></span><span>Largeur<input type="text" class="mini" data-bind="formats.${i}.l" value="${esc(f.l)}"></span><span>Hauteur<input type="text" class="mini" data-bind="formats.${i}.h" value="${esc(f.h)}"></span>
          <span>Poids net (kg)<span class="req" style="color:var(--rouge)">*</span><input type="text" class="mini" data-bind="formats.${i}.poids" value="${esc(f.poids)}"></span></div><div class="msg-err">Dimensions et poids obligatoires.</div></div>
        <div class="grille">${champTexte(`formats.${i}.colisCouche`, 'Colis par couche sur palette', { t: 'nombre' })}${champTexte(`formats.${i}.couches`, 'Couches par palette', { t: 'nombre' })}${champTexte(`formats.${i}.intercalaires`, 'Nombre d\'intercalaires', { t: 'nombre' })}
          ${champRadio(`formats.${i}.demi`, 'Demi-palette', ['Oui', 'Non'])}${champRadio(`formats.${i}.corniere`, 'Cornières', ['Oui', 'Non'])}${champTexte(`formats.${i}.nbLiens`, 'Nombre de liens (cerclage)', { t: 'nombre' })}</div>
        ${champCases(`formats.${i}.palettes`, 'Palettes utilisées au palettiseur avec ce format', PALETTES_DIMS, { autre: 1 })}
        ${champZone(`formats.${i}.notes`, 'Notes', { notes: 1 })}</div>`).join('') || '<div class="info">Aucun format pour le moment.</div>'}
      <button class="b-ajout" data-add="formats">＋ Ajouter un format</button></div>`;
}

/* ================= GROUPES (vidage / palettisation) — rendu commun ================= */
function couverture(groupes) {          // lignes couvertes par ≥1 groupe
  const c = {}; groupes.forEach(g => (g.lignes || []).forEach(id => c[id] = (c[id] || 0) + 1)); return c;
}
function editeurGroupeVidage(i, g, o = {}) {
  const base = `vidage.groupes.${i}`;
  return `<div class="sect grp"><h3><span class="num">V${i + 1}</span>${esc(g.nom)}${g.type ? `<span class="tag">${esc(vidDef(g.type)?.lbl || g.type)}</span>` : ''}</h3>
    ${o.suppr ? `<button class="sect-x" data-del="${base}" title="Supprimer ce vidage">×</button>` : ''}
    ${o.sansLignes ? '' : `<div class="grille">${champTexte(base + '.nom', 'Nom du vidage', { ph: 'Ex : Vidage commun A' })}</div>`}
    ${champRadio(base + '.type', 'Type de vidage', VIDAGES.map(v => v.lbl), { req: 1, rerender: 1 })}
    ${/autre/i.test(g.type) ? champTexte(base + '.typeAutre', 'Préciser le type', { req: 1 }) : ''}
    ${o.sansLignes ? '' : `<div class="rang" id="r_${cssId(base)}_lignes"><span class="etq">Lignes alimentées par ce vidage<span class="req">*</span></span>${puces(base + '.lignes', S.lignes.map(l => ({ id: l.id, lbl: lblLigne(l) })), 'Créer d\'abord les lignes (onglet Projet)')}<div class="msg-err">Affecter au moins une ligne.</div></div>`}
    <div class="rang" id="r_${cssId(base)}_palox"><span class="etq">Palox qui passent sur ce vidage<span class="req">*</span></span>${puces(base + '.palox', S.palox.map(p => ({ id: p.id, lbl: lblPalox(p) })), 'Créer d\'abord les palox (onglet Palox & formats)')}<div class="msg-err">Affecter au moins un palox.</div>
      <div class="sous-etq">Le même palox peut passer sur plusieurs vidages.</div></div>
    ${champsOpts(base + '.opts', VIDAGE_OPTS)}
    ${champNotes(base + '.notes')}</div>`;
}
function editeurGroupePalett(i, g, o = {}) {
  const base = `palettisation.groupes.${i}`;
  return `<div class="sect grp" style="border-left-color:#7c3aed"><h3><span class="num" style="background:#7c3aed">PA${i + 1}</span>${esc(g.nom)}${g.type ? `<span class="tag">${esc(palDef(g.type)?.lbl || g.type)}</span>` : ''}</h3>
    ${o.suppr ? `<button class="sect-x" data-del="${base}" title="Supprimer">×</button>` : ''}
    ${o.sansLignes ? '' : `<div class="grille">${champTexte(base + '.nom', 'Nom', { ph: 'Ex : Palettiseur central' })}</div>`}
    ${champRadio(base + '.type', 'Type de palettisation', PALETTISATIONS.map(p => p.lbl), { req: 1, rerender: 1 })}
    ${/autre/i.test(g.type) ? champTexte(base + '.typeAutre', 'Préciser', { req: 1 }) : ''}
    ${o.sansLignes ? '' : `<div class="rang" id="r_${cssId(base)}_lignes"><span class="etq">Lignes desservies<span class="req">*</span></span>${puces(base + '.lignes', S.lignes.map(l => ({ id: l.id, lbl: lblLigne(l) })), 'Créer d\'abord les lignes')}<div class="msg-err">Affecter au moins une ligne.</div></div>`}
    ${/roulade/i.test(g.type) ? champsOpts(base + '.opts', PALETTISATION_OPTS.filter(x => ['evacuation', 'etiquetage', 'cadence'].includes(x.k))) : g.type ? champsOpts(base + '.opts', PALETTISATION_OPTS) : ''}
    ${champNotes(base + '.notes')}</div>`;
}
function bilanCouverture(groupes, lblGroupe) {
  if (!S.lignes.length) return `<div class="warn">Aucune ligne définie : créer les lignes dans l'onglet Projet.</div>`;
  const c = couverture(groupes);
  const sans = S.lignes.filter(l => !c[l.id]);
  const multi = S.lignes.filter(l => c[l.id] > 1);
  let h = '';
  if (sans.length) h += `<div class="bad">Lignes sans ${lblGroupe} : <b>${sans.map(lblLigne).map(esc).join(', ')}</b>.</div>`;
  if (multi.length) h += `<div class="warn">Lignes affectées à plusieurs ${lblGroupe}s : ${multi.map(lblLigne).map(esc).join(', ')} — vérifier que c'est voulu.</div>`;
  if (!sans.length && groupes.length) h += `<div class="info">✓ Toutes les lignes ont un ${lblGroupe}.</div>`;
  return h;
}

/* ================= PAGE VIDAGE (mode neuf) ================= */
function pageVidage() {
  const mode = S.vidage.mode;
  let h = `<h2>Vidage des palox</h2><p class="intro">Comment les palox sont vidés pour alimenter les lignes : un vidage par ligne, un vidage commun, ou un mélange (ex : 3 lignes sur un vidage commun, 2 lignes avec leur propre vidage).</p>
    <div class="sect"><h3>Organisation du vidage<span class="req" style="color:var(--rouge)">*</span></h3>
      ${grosChoix('vidage.mode', [{ k: 'indep', lbl: 'Indépendant', sous: 'Un vidage par ligne' }, { k: 'mutu', lbl: 'Mutualisé', sous: 'Un seul vidage pour toutes les lignes' }, { k: 'mixte', lbl: 'Mixte', sous: 'Certaines lignes partagent un vidage, d\'autres ont le leur' }])}</div>`;
  if (mode) {
    h += bilanCouverture(S.vidage.groupes, 'vidage');
    h += S.vidage.groupes.map((g, i) => editeurGroupeVidage(i, g, { suppr: true })).join('');
    h += `<button class="b-ajout" data-add-vidage="1">＋ Ajouter un vidage</button>`;
    if (mode === 'indep' && S.lignes.length > S.vidage.groupes.length) h += ` <button class="b-ajout orange" data-vidage-auto="1">⚡ Créer un vidage par ligne manquante</button>`;
    if (mode === 'mutu' && !S.vidage.groupes.length) h += ` <button class="b-ajout orange" data-vidage-auto="mutu">⚡ Créer le vidage commun (toutes les lignes)</button>`;
    h += champNotes('vidage.notes', 'Notes générales sur le vidage');
  }
  return h;
}

/* ================= PAGE PALETTISATION (mode neuf) ================= */
function pagePalettisation() {
  const mode = S.palettisation.mode;
  let h = `<h2>Palettisation</h2><p class="intro">Fin de chaque ligne : palettiseur (avec ou sans liaison automatique à la cercleuse) ou roulades pour palettiser à la main. Comme le vidage, la palettisation peut être partagée entre lignes.</p>
    <div class="sect"><h3>Organisation de la palettisation<span class="req" style="color:var(--rouge)">*</span></h3>
      ${grosChoix('palettisation.mode', [{ k: 'indep', lbl: 'Indépendante', sous: 'Une palettisation par ligne' }, { k: 'mutu', lbl: 'Mutualisée', sous: 'Un seul poste pour toutes les lignes' }, { k: 'mixte', lbl: 'Mixte', sous: 'Partagée pour certaines lignes seulement' }])}</div>`;
  if (mode) {
    h += bilanCouverture(S.palettisation.groupes, 'palettisation');
    h += S.palettisation.groupes.map((g, i) => editeurGroupePalett(i, g, { suppr: true })).join('');
    h += `<button class="b-ajout" data-add-palett="1">＋ Ajouter une palettisation</button>`;
    if (mode === 'indep' && S.lignes.length > S.palettisation.groupes.length) h += ` <button class="b-ajout orange" data-palett-auto="1">⚡ Créer une palettisation par ligne manquante</button>`;
    if (mode === 'mutu' && !S.palettisation.groupes.length) h += ` <button class="b-ajout orange" data-palett-auto="mutu">⚡ Créer la palettisation commune</button>`;
    h += champNotes('palettisation.notes', 'Notes générales sur la palettisation');
  }
  return h;
}

/* ================= PAGE LIGNES ================= */
function pageLignes() {
  const m = S.projet.mode;
  if (!S.lignes.length) return `<h2>Lignes</h2><div class="warn">Aucune ligne : créer les lignes dans l'onglet <b>Projet</b>.</div>`;
  if (S.ui.ligne >= S.lignes.length) S.ui.ligne = 0;
  const i = S.ui.ligne, l = S.lignes[i], base = `lignes.${i}`;
  const err = erreursParLigne();
  let h = `<h2>${m === 'modif' ? 'Lignes existantes' : m === 'unique' ? 'La ligne' : 'Lignes d\'emballage'}</h2>
    <p class="intro">${m === 'modif' ? 'Pour chaque ligne existante : décrire les sections en place, cocher celles à modifier et dire par quoi les remplacer.' : 'Une ligne se lit dans le sens du produit : vidage → cuve → élévateur → brosseuse → répartition → machines de conditionnement → palettisation.'}</p>`;
  if (S.lignes.length > 1) h += `<div class="sous-tabs">${S.lignes.map((x, j) => `<button class="sous-tab ${j === i ? 'actif' : ''} ${err[x.id] ? 'erreur' : ''}" data-ligne="${j}">L${j + 1} · ${esc(lblLigne(x))}</button>`).join('')}</div>`;
  h += `<div class="sect" style="background:#fff"><h3><span class="num">L${i + 1}</span>${esc(lblLigne(l))}${l.debit ? `<span class="tag">${esc(l.debit)}</span>` : ''}${l.produits ? `<span class="tag">${esc(l.produits)}</span>` : ''}</h3>
    <div class="grille">${champTexte(base + '.nom', 'Nom de la ligne', { req: 1 })}${champTexte(base + '.debit', 'Débit visé', { ph: 'Ex : 8 T/h' })}${champTexte(base + '.produits', 'Produits', { ph: 'Ex : Pomme' })}</div></div>`;
  if (m === 'modif') return h + ligneModif(i, l);

  /* — mode unique : vidage intégré — */
  if (m === 'unique') {
    if (!S.vidage.groupes.length) { const g = groupeVidage(1); g.lignes = [l.id]; S.vidage.groupes.push(g); }
    S.vidage.groupes[0].lignes = [l.id];
    h += `<div class="sect"><h3>Vidage des palox</h3>${editeurGroupeVidage(0, S.vidage.groupes[0], { sansLignes: true })}</div>`;
  } else {
    const gs = S.vidage.groupes.filter(g => g.lignes.includes(l.id));
    h += `<div class="sect off" style="background:var(--bleu-p);border-color:#c9daf0"><h3>Vidage</h3><p class="gs-sous" style="margin:0">${gs.length ? gs.map(g => `<b>${esc(g.nom)}</b> (${esc(vidDef(g.type)?.lbl || 'type à choisir')})`).join(', ') : '<span style="color:var(--rouge)">aucun vidage n\'alimente cette ligne</span>'} — se règle dans l'onglet <b>Vidage</b>.</p></div>`;
  }
  /* — étapes de tête — */
  h += `<div class="sect"><h3>Tête de ligne</h3><p class="gs-sous">Décocher une étape absente de cette ligne.</p>
    ${ETAPES_TETE.map(e => { const t = l.tete[e.k] || (l.tete[e.k] = { actif: true, opts: {}, notes: '' }); const b = `${base}.tete.${e.k}`;
      return `<div class="sect ${t.actif ? '' : 'off'}" style="background:#fff"><label class="interrupteur"><input type="checkbox" data-bind="${b}.actif" data-bool="1" ${t.actif ? 'checked' : ''}> ${esc(e.lbl)}${t.actif ? '' : ' <span class="tag">absente</span>'}</label>
        ${t.actif ? champsOpts(b + '.opts', e.opts) + champZone(b + '.notes', 'Notes', { notes: 1 }) : ''}</div>`; }).join('')}</div>`;
  /* — machines — */
  h += `<div class="sect"><h3>Machines de conditionnement<span class="compteur">${l.machines.length}</span></h3><p class="gs-sous">Dans l'ordre du flux produit. Les accessoires possibles s'affichent sous chaque machine.</p>
    <div class="rang" id="r_${cssId(base)}_machines">${l.machines.length ? '' : '<div class="msg-err" style="display:block">Ajouter au moins une machine.</div>'}</div>
    ${l.machines.map((mc, j) => machineHtml(i, j, mc)).join('')}
    <div class="ajout-machine"><select id="selMachine">${famillesOptions()}</select><button class="b-ajout" data-add-machine="${i}" style="margin:0">＋ Ajouter la machine</button></div></div>`;
  /* — formats — */
  h += `<div class="sect"><h3>Formats de colis sur cette ligne<span class="req" style="color:var(--rouge)">*</span></h3>
    <div class="rang" id="r_${cssId(base)}_formats">${puces(base + '.formats', S.formats.map(f => ({ id: f.id, lbl: lblFormat(f) })), 'Créer d\'abord les formats (onglet Palox & formats)')}<div class="msg-err">Affecter au moins un format.</div></div></div>`;
  /* — palettisation — */
  if (m === 'unique') {
    if (!S.palettisation.groupes.length) { const g = groupePalett(1); g.lignes = [l.id]; S.palettisation.groupes.push(g); }
    S.palettisation.groupes[0].lignes = [l.id];
    h += `<div class="sect"><h3>Palettisation</h3>${editeurGroupePalett(0, S.palettisation.groupes[0], { sansLignes: true })}</div>`;
  } else {
    const gs = S.palettisation.groupes.filter(g => g.lignes.includes(l.id));
    h += `<div class="sect off" style="background:#f3e8ff;border-color:#ddd0f5"><h3>Palettisation</h3><p class="gs-sous" style="margin:0">${gs.length ? gs.map(g => `<b>${esc(g.nom)}</b> (${esc(palDef(g.type)?.lbl || 'type à choisir')})`).join(', ') : '<span style="color:var(--rouge)">aucune palettisation pour cette ligne</span>'} — se règle dans l'onglet <b>Palettisation</b>.</p></div>`;
  }
  h += champNotes(base + '.notes', 'Notes sur cette ligne');
  return h;
}
function famillesOptions() {
  const fams = [...new Set(MACHINES.map(m => m.fam))];
  return fams.map(f => `<optgroup label="${esc(f)}">${MACHINES.filter(m => m.fam === f).map(m => `<option value="${m.k}">${esc(m.lbl)}</option>`).join('')}</optgroup>`).join('');
}
function machineHtml(i, j, mc) {
  const d = machDef(mc.k) || { lbl: mc.k, opts: [], acc: [] }, base = `lignes.${i}.machines.${j}`;
  const l = S.lignes[i];
  return `<div class="sect mach"><h3><span class="num">${j + 1}</span>${esc(d.lbl)}</h3>
    <div class="sect-move"><button data-move="${i}.${j}.-1" title="Monter" ${j === 0 ? 'disabled' : ''}>▲</button><button data-move="${i}.${j}.1" title="Descendre" ${j === l.machines.length - 1 ? 'disabled' : ''}>▼</button></div>
    <button class="sect-x" data-del="${base}" title="Retirer">×</button>
    ${champsOpts(base + '.opts', d.opts)}
    ${(d.acc || []).length ? `<div class="rang"><span class="etq">Accessoires</span><div class="puces">${d.acc.map(a => `<button type="button" class="puce ${mc.acc.includes(a) ? 'on' : ''}" data-toggle="${base}.acc" data-id="${a}">${esc(ACCESSOIRES[a]?.lbl || a)}</button>`).join('')}</div></div>` : ''}
    ${champZone(base + '.notes', 'Notes sur cette machine', { notes: 1 })}</div>`;
}

/* ================= LIGNE EN MODE MODIFICATION ================= */
function ligneModif(i, l) {
  const base = `lignes.${i}`;
  const nbMod = SECTIONS_EXISTANT.filter(s => l.existant[s.k]?.modifier).length;
  let h = `<div class="sect"><h3>Sections de la ligne existante<span class="compteur">${nbMod} à modifier</span></h3>
    <p class="gs-sous">Pour chaque section : est-elle présente aujourd'hui ? La décrire brièvement. Cocher « à modifier » et indiquer par quoi la remplacer.</p>
    <div class="rang" id="r_${cssId(base)}_modif">${nbMod ? '' : '<div class="msg-err" style="display:block">Cocher au moins une section à modifier.</div>'}</div>
    ${SECTIONS_EXISTANT.map(s => { const x = l.existant[s.k] || (l.existant[s.k] = { present: 'Oui', description: '', modifier: false, remplacer: '', remplacerDetail: '', notes: '' }); const b = `${base}.existant.${s.k}`;
      const choix = s.k === 'vidage' ? VIDAGES.map(v => v.lbl) : s.k === 'palettisation' ? PALETTISATIONS.map(p => p.lbl) : ['cuve', 'elevateur', 'brosseuse', 'repartition'].includes(s.k) ? (teteDef(s.k)?.opts.find(o => o.k === 'type')?.choix || []).concat(['Autre']) : MACHINES.map(m => m.lbl);
      return `<div class="sect ${x.modifier ? 'mach' : ''}" style="background:#fff;${x.modifier ? 'border-left-color:var(--orange)' : ''}"><h3>${esc(s.lbl)}${x.modifier ? '<span class="tag" style="background:var(--orange-p);color:#b86f00">à modifier</span>' : ''}</h3>
        <div class="grille" style="align-items:end">${champRadio(b + '.present', 'Présente aujourd\'hui', ['Oui', 'Non'], { rerender: 1 })}
          <label class="interrupteur" style="margin:0 0 6px"><input type="checkbox" data-bind="${b}.modifier" data-bool="1" ${x.modifier ? 'checked' : ''}> À modifier / ajouter</label></div>
        ${x.present !== 'Non' ? champZone(b + '.description', 'Description de l\'existant', { ph: 'Marque, modèle, âge, débit, état…' }) : ''}
        ${x.modifier ? champListe(b + '.remplacer', 'Remplacer / compléter par', choix, { rerender: 1 }) + (/autre/i.test(x.remplacer) ? champTexte(b + '.remplacerDetail', 'Préciser') : '') + champZone(b + '.notes', 'Détail de la modification souhaitée', { notes: 1, req: 1 }) : champZone(b + '.notes', 'Notes', { notes: 1 })}</div>`; }).join('')}</div>
    <div class="sect"><h3>Formats de colis concernés</h3><div class="rang">${puces(base + '.formats', S.formats.map(f => ({ id: f.id, lbl: lblFormat(f) })), 'Aucun format saisi (onglet Palox & formats) — facultatif en modification')}</div></div>
    ${champNotes(base + '.notes', 'Notes sur cette ligne')}`;
  return h;
}

/* ================= SCHÉMA ================= */
function pageSchema() {
  return `<h2>Schéma des lignes</h2><p class="intro">Vue de conception générée automatiquement depuis la saisie : une rangée par ligne, les vidages et palettisations mutualisés enjambent les lignes qu'ils desservent. Il est inclus dans le PDF.</p>
    <div id="schemaWrap">${svgSchema()}</div>
    <div class="legende"><span class="l-vid">Vidage</span><span class="l-tete">Tête de ligne</span><span class="l-mach">Machine</span><span class="l-acc">Accessoire</span><span class="l-pal">Palettisation</span></div>`;
}
function svgSchema() {
  const L = S.lignes; if (!L.length) return '<div class="warn" style="margin:0">Aucune ligne à dessiner.</div>';
  const modif = S.projet.mode === 'modif';
  const W = 160, H = 46, GX = 26, GY = 30, PADL = 20, ROWH = H + GY + 34;
  const idx = {}; L.forEach((l, i) => idx[l.id] = i);
  const rows = L.map(l => {
    const boxes = [];
    if (modif) {
      SECTIONS_EXISTANT.forEach(s => { const x = l.existant[s.k]; if (!x || x.present === 'Non' && !x.modifier) return;
        boxes.push({ cls: x.modifier ? 'acc' : 'tete', t: s.lbl.split(' (')[0].slice(0, 22), s: x.modifier ? ('→ ' + (x.remplacer || 'à définir')).slice(0, 26) : (x.description || '').slice(0, 26) }); });
    } else {
      ETAPES_TETE.forEach(e => { const t = l.tete[e.k]; if (!t?.actif) return; const typ = t.opts?.type; boxes.push({ cls: 'tete', t: e.court, s: Array.isArray(typ) ? typ.join(', ') : (typ || '') }); });
      l.machines.forEach(m => { const d = machDef(m.k); boxes.push({ cls: 'mach', t: d?.court || m.k, s: d?.opts?.[0] && m.opts?.[d.opts[0].k] ? String(m.opts[d.opts[0].k]) : '' });
        (m.acc || []).forEach(a => boxes.push({ cls: 'acc', t: ACCESSOIRES[a]?.court || a, s: '' })); });
    }
    return boxes;
  });
  const maxBoxes = Math.max(1, ...rows.map(r => r.length));
  const X0 = PADL + W + GX;                      // colonne vidage à gauche
  const XP = X0 + maxBoxes * (W + GX);           // colonne palettisation à droite
  const width = XP + W + PADL, height = L.length * ROWH + 30;
  const fill = { vid: ['#dbeafe', '#2b6cb0'], tete: ['#eef1f5', '#8a94a1'], mach: ['#eaf6e0', '#55AB26'], acc: ['#fdf1dc', '#F29400'], pal: ['#f3e8ff', '#7c3aed'] };
  const box = (x, y, w, h, cls, t, s) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${fill[cls][0]}" stroke="${fill[cls][1]}" stroke-width="1.5"/>
    <text x="${x + w / 2}" y="${y + (s ? h / 2 - 4 : h / 2 + 4)}" text-anchor="middle" font-size="12.5" font-weight="600" fill="#1c2430">${esc(t)}</text>
    ${s ? `<text x="${x + w / 2}" y="${y + h / 2 + 12}" text-anchor="middle" font-size="10.5" fill="#67707c">${esc(s)}</text>` : ''}`;
  let g = '';
  /* groupes vidage / palettisation (blocs qui enjambent) — dessinés d'abord */
  const bloc = (grp, x, cls, lblType) => grp.forEach(gp => {
    const ids = (gp.lignes || []).filter(id => idx[id] !== undefined); if (!ids.length) return;
    const is = ids.map(id => idx[id]); const i0 = Math.min(...is), i1 = Math.max(...is);
    const y0 = 20 + i0 * ROWH + 14, y1 = 20 + i1 * ROWH + 14 + H;
    g += box(x, y0, W, y1 - y0, cls, gp.nom || '', lblType(gp));
    if (is.length > 1) is.forEach(i => { const yc = 20 + i * ROWH + 14 + H / 2; g += `<circle cx="${cls === 'vid' ? x + W : x}" cy="${yc}" r="4" fill="${fill[cls][1]}"/>`; });
  });
  if (!modif) {
    bloc(S.vidage.groupes, PADL, 'vid', gp => vidDef(gp.type)?.court || 'type ?');
    bloc(S.palettisation.groupes, XP, 'pal', gp => palDef(gp.type)?.court || 'type ?');
  }
  /* rangées */
  L.forEach((l, i) => {
    const y = 20 + i * ROWH + 14;
    g += `<rect x="${X0 - 4}" y="${y - 20}" width="${Math.min(520, (XP - X0))}" height="16" fill="#fff" opacity=".85"/>`;
    g += `<text x="${X0}" y="${y - 7}" font-size="12" font-weight="700" fill="#3f8a1a">L${i + 1} · ${esc(lblLigne(l))}${l.debit ? ' — ' + esc(l.debit) : ''}</text>`;
    g += `<line x1="${PADL + W}" y1="${y + H / 2}" x2="${XP}" y2="${y + H / 2}" stroke="#b9c2cd" stroke-width="2" stroke-dasharray="4 4"/>`;
    rows[i].forEach((b, j) => g += box(X0 + j * (W + GX), y, W, H, b.cls, b.t, b.s));
    for (let j = 0; j < rows[i].length - 1; j++) { const x = X0 + j * (W + GX) + W; g += `<polygon points="${x + GX - 8},${y + H / 2 - 5} ${x + GX},${y + H / 2} ${x + GX - 8},${y + H / 2 + 5}" fill="#8a94a1"/>`; }
  });
  const style = width <= 1600 ? `style="width:100%;height:auto;max-width:${width}px"` : `width="${width}" height="${height}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" ${style} viewBox="0 0 ${width} ${height}">${g}</svg>`;
}

/* ================= VALIDATION & PROGRESSION ================= */
function erreurs() {
  const E = []; const add = (page, id, txt, ligne) => E.push({ page, id, txt, ligne });
  const g = S.gen;
  if (!g.comP && !g.comN) add('gen', 'r_gen_com', 'Commercial');
  if (!g.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g.email)) add('gen', 'r_gen_email', 'Email valide');
  if (!g.client) add('gen', 'r_gen_client', 'Client');
  if (!g.fruits.length) add('gen', 'r_gen_fruits', 'Fruits');
  if (!g.tonnageH) add('gen', 'r_gen_tonnageH', 'Tonnage horaire');
  const m = S.projet.mode;
  if (!m) { add('projet', null, 'Type de projet'); return E; }
  if (!S.lignes.length) add('projet', null, 'Au moins une ligne');
  S.lignes.forEach((l, i) => { if (!l.nom) add('projet', `r_lignes_${i}_nom`, `Nom de la ligne ${i + 1}`); });
  S.palox.forEach((p, i) => { if (!p.nom) add('cat', `r_palox_${i}_nom`, `Palox ${i + 1} : désignation`); });
  S.formats.forEach((f, i) => { if (!f.nom) add('cat', `r_formats_${i}_nom`, `Format ${i + 1} : nom`); if (!f.L || !f.l || !f.h || !f.poids) add('cat', `r_formats_${i}_dims`, `Format ${i + 1} : dimensions et poids`); });
  if (m === 'modif') {
    S.lignes.forEach((l, i) => {
      const mods = SECTIONS_EXISTANT.filter(s => l.existant[s.k]?.modifier);
      if (!mods.length) add('lignes', `r_lignes_${i}_modif`, `${lblLigne(l)} : aucune section à modifier`, i);
      mods.forEach(s => { if (!l.existant[s.k].notes && !l.existant[s.k].remplacer) add('lignes', `r_lignes_${i}_existant_${s.k}_notes`, `${lblLigne(l)} · ${s.lbl} : préciser la modification`, i); });
    });
    return E;
  }
  /* vidage */
  const pv = m === 'unique' ? 'lignes' : 'vidage';
  if (m === 'neuf' && !S.vidage.mode) add('vidage', null, 'Organisation du vidage');
  if (m === 'neuf' || m === 'unique') {
    const cv = couverture(S.vidage.groupes);
    S.lignes.forEach(l => { if (!cv[l.id]) add(pv, null, `${lblLigne(l)} : aucun vidage`); });
    S.vidage.groupes.forEach((gp, i) => {
      if (!gp.type) add(pv, `r_vidage_groupes_${i}_type`, `${gp.nom} : type de vidage`);
      if (/autre/i.test(gp.type) && !gp.typeAutre) add(pv, `r_vidage_groupes_${i}_typeAutre`, `${gp.nom} : préciser le type`);
      if (!gp.palox.length) add(pv, `r_vidage_groupes_${i}_palox`, `${gp.nom} : palox`);
      if (m === 'neuf' && !gp.lignes.length) add(pv, `r_vidage_groupes_${i}_lignes`, `${gp.nom} : lignes alimentées`);
    });
  }
  /* lignes */
  S.lignes.forEach((l, i) => {
    if (!l.machines.length) add('lignes', `r_lignes_${i}_machines`, `${lblLigne(l)} : au moins une machine`, i);
    if (!l.formats.length) add('lignes', `r_lignes_${i}_formats`, `${lblLigne(l)} : formats de colis`, i);
  });
  /* palettisation */
  const pp = m === 'unique' ? 'lignes' : 'palett';
  if (m === 'neuf' && !S.palettisation.mode) add('palett', null, 'Organisation de la palettisation');
  const cp = couverture(S.palettisation.groupes);
  S.lignes.forEach(l => { if (!cp[l.id]) add(pp, null, `${lblLigne(l)} : aucune palettisation`); });
  S.palettisation.groupes.forEach((gp, i) => {
    if (!gp.type) add(pp, `r_palettisation_groupes_${i}_type`, `${gp.nom} : type de palettisation`);
    if (/autre/i.test(gp.type) && !gp.typeAutre) add(pp, `r_palettisation_groupes_${i}_typeAutre`, `${gp.nom} : préciser`);
    if (m === 'neuf' && !gp.lignes.length) add(pp, `r_palettisation_groupes_${i}_lignes`, `${gp.nom} : lignes desservies`);
  });
  return E;
}
function erreursParLigne() { const r = {}; erreurs().forEach(e => { if (e.page === 'lignes' && e.id) { const m = e.id.match(/^r_lignes_(\d+)_/); if (m && S.lignes[+m[1]]) r[S.lignes[+m[1]].id] = true; } }); return r; }
function pointsTotaux() {          // dénominateur de la progression : points obligatoires potentiels
  let n = 5 + 1; const m = S.projet.mode; if (!m) return n;
  n += 1 + S.lignes.length + S.palox.length + S.formats.length * 2;
  if (m === 'modif') return n + S.lignes.length * 2;
  n += (m === 'neuf' ? 1 : 0) + S.lignes.length + S.vidage.groupes.length * (m === 'neuf' ? 3 : 2);
  n += S.lignes.length * 2;
  n += (m === 'neuf' ? 1 : 0) + S.lignes.length + S.palettisation.groupes.length * (m === 'neuf' ? 2 : 1);
  return n;
}
function majProgression() {
  const E = erreurs(), tot = pointsTotaux(), ok = Math.max(0, tot - E.length);
  const pct = tot ? Math.round(ok / tot * 100) : 0;
  $('#progFill').style.width = pct + '%'; $('#pctChamps').textContent = pct + '%';
  const t = $('#txtReq');
  if (!E.length) { t.innerHTML = `<span class="ok">✓ CDC complet — vous pouvez le terminer</span>`; $('#progFill').style.background = 'var(--orange)'; }
  else { t.innerHTML = `Points obligatoires restants : <b>${E.length}</b>`; $('#progFill').style.background = 'var(--vert)'; }
  /* état des onglets */
  const pg = pages(); const parPage = {}; E.forEach(e => parPage[e.page] = (parPage[e.page] || 0) + 1);
  $$('#tabs .tab').forEach((b, i) => { const k = pg[i]?.k; b.classList.toggle('complet', !!k && !parPage[k] && k !== 'schema' && (k !== 'projet' || !!S.projet.mode)); b.classList.toggle('erreur', !!parPage[k] && S.ui.touche); });
  return E;
}
function marquerErreurs(E) {
  $$('.rang.erreur').forEach(r => r.classList.remove('erreur'));
  E.forEach(e => { if (e.id) { const r = document.getElementById(e.id); if (r) r.classList.add('erreur'); } });
}

/* ================= RENDU ================= */
function construireOnglets() {
  const pg = pages();
  if (S.ui.page >= pg.length) S.ui.page = pg.length - 1;
  $('#tabs').innerHTML = pg.map((p, i) => `<button class="tab ${i === S.ui.page ? 'actif' : ''}" data-page="${i}">${esc(p.lbl)}</button>`).join('');
}
function render(garderScroll) {
  const y = window.scrollY;
  construireOnglets();
  const pg = pages(), p = pg[S.ui.page];
  let h = `<div class="page">${p.r()}`;
  const dernier = S.ui.page === pg.length - 1;
  h += `<div class="nav-page">${S.ui.page > 0 ? `<button class="b-nav" data-nav="prec">← Précédent</button>` : ''}<button class="b-nav" data-nav="sauve">💾 Enregistrer</button>
    ${dernier ? (FIGEE ? `<button class="b-nav env" data-nav="retour">${DEMANDE ? 'Retour à la demande' : 'Fermer'}</button>` : `<button class="b-nav env" data-nav="envoyer">${DEMANDE ? 'Terminer le CDC ✓' : 'Envoyer le CDC'}</button>`) : `<button class="b-nav suiv" data-nav="suiv">${esc(pg[S.ui.page + 1].lbl)} →</button>`}</div></div>`;
  $('#pageCour').innerHTML = h;
  if (FIGEE) $$('#pageCour input, #pageCour select, #pageCour textarea, #pageCour button:not([data-nav]):not([data-page]):not([data-ligne])').forEach(el => el.disabled = true);
  const E = majProgression();
  if (S.ui.touche) marquerErreurs(E);
  if (garderScroll) window.scrollTo(0, y);
}
function allerPage(i) { S.ui.page = Math.max(0, Math.min(pages().length - 1, i)); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); sauvegarder(false); }

/* ================= ÉVÉNEMENTS (délégués) ================= */
function lierEvenements() {
  const app = $('#appli');
  app.addEventListener('input', e => {
    const el = e.target, path = el.dataset.bind; if (!path || FIGEE) return;
    if (el.type === 'radio' || el.type === 'checkbox') return;
    set(path, el.value); changement(false);
    if (path === 'projet.mode') return;
    /* titres dynamiques (noms) sans re-rendu complet */
  });
  app.addEventListener('change', e => {
    const el = e.target, path = el.dataset.bind; if (!path || FIGEE) return;
    if (el.type === 'checkbox' && el.dataset.multi) { const arr = get(path) || []; const i = arr.indexOf(el.value); if (el.checked && i < 0) arr.push(el.value); if (!el.checked && i >= 0) arr.splice(i, 1); set(path, arr);
      const autre = el.closest('.rang')?.querySelector('.autre-txt'); if (autre) autre.style.display = arr.some(x => /autre/i.test(x)) ? '' : 'none'; changement(false); return; }
    if (el.type === 'checkbox' && el.dataset.bool) { set(path, el.checked); changement(true); return; }
    if (el.type === 'radio') { set(path, el.value); const autre = el.closest('.rang')?.querySelector('.autre-txt'); if (autre) autre.style.display = /autre/i.test(el.value) ? '' : 'none'; changement(!!el.dataset.rerender); return; }
    if (el.tagName === 'SELECT') { set(path, el.value); changement(!!el.dataset.rerender); return; }
    changement(!!el.dataset.rerender);   // texte : pas de re-rendu (les titres se rafraîchissent à la navigation)
  });
  app.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if (d.nav) { if (d.nav === 'prec') allerPage(S.ui.page - 1); if (d.nav === 'suiv') allerPage(S.ui.page + 1); if (d.nav === 'sauve') sauvegarder(true); if (d.nav === 'envoyer') envoyerCDC(); if (d.nav === 'retour') location.href = DEMANDE ? '/?d=' + encodeURIComponent(DEMANDE) : '/'; return; }
    if (FIGEE) return;
    if (d.set) { set(d.set, d.val); if (d.set === 'projet.mode') aprèsChangementMode(); changement(true); return; }
    if (d.toggle) { const arr = get(d.toggle) || []; const i = arr.indexOf(d.id); i < 0 ? arr.push(d.id) : arr.splice(i, 1); set(d.toggle, arr); changement(true); return; }
    if (d.addLigne) { S.lignes.push(ligneVierge(S.lignes.length + 1)); changement(true); return; }
    if (d.delLigne !== undefined) { if (!confirm('Supprimer cette ligne et sa saisie ?')) return; const id = S.lignes[+d.delLigne].id; S.lignes.splice(+d.delLigne, 1); [...S.vidage.groupes, ...S.palettisation.groupes].forEach(g => g.lignes = g.lignes.filter(x => x !== id)); changement(true); return; }
    if (d.ligne !== undefined) { S.ui.ligne = +d.ligne; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (d.add === 'palox') { S.palox.push(paloxVierge()); changement(true); return; }
    if (d.add === 'formats') { S.formats.push(formatVierge()); changement(true); return; }
    if (d.del) { const ks = d.del.split('.'); const i = +ks.pop(); const arr = get(ks.join('.')); const it = arr[i]; if (it && (it.nom || it.k || it.type) && !confirm('Supprimer cet élément ?')) return; arr.splice(i, 1);
      if (ks[0] === 'palox') S.vidage.groupes.forEach(g => g.palox = g.palox.filter(x => x !== it.id));
      if (ks[0] === 'formats') S.lignes.forEach(l => l.formats = l.formats.filter(x => x !== it.id));
      changement(true); return; }
    if (d.addVidage) { S.vidage.groupes.push(groupeVidage(S.vidage.groupes.length + 1)); changement(true); return; }
    if (d.addPalett) { S.palettisation.groupes.push(groupePalett(S.palettisation.groupes.length + 1)); changement(true); return; }
    if (d.vidageAuto) { auto(S.vidage.groupes, groupeVidage, d.vidageAuto === 'mutu', 'Vidage'); changement(true); return; }
    if (d.palettAuto) { auto(S.palettisation.groupes, groupePalett, d.palettAuto === 'mutu', 'Palettisation'); changement(true); return; }
    if (d.addMachine !== undefined) { const k = $('#selMachine').value; S.lignes[+d.addMachine].machines.push(machineVierge(k)); changement(true); return; }
    if (d.move) { const [i, j, dir] = d.move.split('.').map(Number); const arr = S.lignes[i].machines; const nj = j + dir; if (nj < 0 || nj >= arr.length) return; [arr[j], arr[nj]] = [arr[nj], arr[j]]; changement(true); return; }
    if (d.delfic !== undefined) { S.fichiers.splice(+d.delfic, 1); changement(true); return; }
  });
  /* fichiers */
  app.addEventListener('click', e => { if (e.target.closest('#zoneDep') && !FIGEE) $('#inpFic').click(); });
  app.addEventListener('change', e => { if (e.target.id === 'inpFic') { [...e.target.files].forEach(f => { if (!S.fichiers.includes(f.name)) S.fichiers.push(f.name); }); changement(true); } });
  app.addEventListener('dragover', e => { if (e.target.closest('#zoneDep')) { e.preventDefault(); } });
  app.addEventListener('drop', e => { if (e.target.closest('#zoneDep') && !FIGEE) { e.preventDefault(); [...e.dataTransfer.files].forEach(f => { if (!S.fichiers.includes(f.name)) S.fichiers.push(f.name); }); changement(true); } });
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) allerPage(+b.dataset.page); });
  $('#bandoErr').addEventListener('click', e => { const u = e.target.closest('u[data-pg]'); if (!u) return; allerPage(+u.dataset.pg); if (u.dataset.ligne) { S.ui.ligne = +u.dataset.ligne; render(); }
    setTimeout(() => { const r = u.dataset.id && document.getElementById(u.dataset.id); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 120); });
  /* barre d'outils */
  $('#btnSauveHaut').addEventListener('click', () => sauvegarder(true));
  $('#btnExport').addEventListener('click', exporterJson);
  $('#btnImport').addEventListener('click', () => $('#inpImport').click());
  $('#inpImport').addEventListener('change', e => { if (e.target.files[0]) importerJson(e.target.files[0]); e.target.value = ''; });
  $('#btnPdf').addEventListener('click', genererPdf);
  $('#btnRaz').addEventListener('click', () => {
    if (!confirm('Remise à zéro complète du CDC Emballage ?')) return;
    S = etatVierge(); if (META) preremplir(META.demande, true); if (!DEMANDE) localStorage.removeItem(CLE_STOCKAGE); S.ui.touche = false; render(); sauvegarder(false); toast('Formulaire réinitialisé');
  });
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); sauvegarder(true); } });
  window.addEventListener('beforeprint', construireRecap);
}
function auto(groupes, vierge, mutu, prefix) {
  if (mutu) { const g = vierge(1); g.nom = prefix + ' commun'; g.lignes = S.lignes.map(l => l.id); groupes.push(g); return; }
  const c = couverture(groupes);
  S.lignes.forEach(l => { if (!c[l.id]) { const g = vierge(groupes.length + 1); g.nom = prefix + ' ' + lblLigne(l); g.lignes = [l.id]; groupes.push(g); } });
}
function aprèsChangementMode() {
  const m = S.projet.mode;
  if (m === 'unique') { if (!S.lignes.length) S.lignes.push(ligneVierge(1)); S.lignes = S.lignes.slice(0, 1); S.vidage.mode = 'indep'; S.palettisation.mode = 'indep'; S.vidage.groupes = S.vidage.groupes.slice(0, 1); S.palettisation.groupes = S.palettisation.groupes.slice(0, 1); }
  if (m === 'neuf' && !S.lignes.length) { S.lignes.push(ligneVierge(1), ligneVierge(2)); }
  if (m === 'modif' && !S.lignes.length) { const l = ligneVierge(1); l.nom = 'Ligne existante 1'; S.lignes.push(l); }
}
let minuterie = null;
function changement(rerender) {
  S.ui.touche = S.ui.touche || false;
  if (rerender) render(true); else majProgression();
  clearTimeout(minuterie); minuterie = setTimeout(() => sauvegarder(false), 600);
}

/* ================= VALIDATION FINALE ================= */
function envoyerCDC() {
  S.ui.touche = true;
  const E = majProgression(); marquerErreurs(E);
  const bando = $('#bandoErr');
  if (E.length) {
    const pg = pages(); const pi = k => pg.findIndex(p => p.k === k);
    bando.classList.add('visible');
    bando.innerHTML = `⚠ ${E.length} point(s) obligatoire(s) manquant(s) : ` + E.slice(0, 8).map(e => `<u data-pg="${pi(e.page)}" ${e.id ? `data-id="${e.id}"` : ''} ${e.ligne !== undefined ? `data-ligne="${e.ligne}"` : ''}>${esc(e.txt)}</u>`).join(', ') + (E.length > 8 ? '…' : '');
    allerPage(pi(E[0].page)); if (E[0].ligne !== undefined) { S.ui.ligne = E[0].ligne; render(); }
    setTimeout(() => { const r = E[0].id && document.getElementById(E[0].id); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 150);
    toast(`${E.length} point(s) obligatoire(s) manquant(s)`, true); return;
  }
  bando.classList.remove('visible');
  if (DEMANDE) { pousser(false, true); }
  else { sauvegarder(false); toast('CDC complet ✓ — génération du PDF…'); setTimeout(genererPdf, 350); }
}

/* ================= SAUVEGARDE ================= */
function sauvegarder(manuel) {
  if (FIGEE) return;
  S.sauveLe = new Date().toISOString();
  if (DEMANDE) { pousser(manuel, false); return; }
  try { localStorage.setItem(CLE_STOCKAGE, JSON.stringify(S)); } catch (e) { toast('Sauvegarde locale impossible (' + e.name + ')', true); return; }
  const h = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  $('#statutSauve').innerHTML = `● Sauvegardé localement <b>${h}</b>`;
  if (manuel) toast('Enregistré ✓');
}
async function pousser(manuel, terminer) {
  const complet = erreurs().length === 0;
  let r;
  try { r = await fetch(API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: S, complet }) }); }
  catch (e) { toast('Serveur injoignable — sauvegarde impossible', true); return; }
  if (r.status === 401) { location.href = '/login?d=' + encodeURIComponent(DEMANDE); return; }
  if (!r.ok) { const j = await r.json().catch(() => ({})); toast(j.error || 'Sauvegarde impossible', true); return; }
  const h = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  $('#statutSauve').innerHTML = `● Sauvegardé dans la demande <b>${h}</b>${complet ? ' · <span style="color:var(--vert-f)">complet</span>' : ''}`;
  if (manuel) toast('Enregistré dans la demande ✓');
  if (terminer) { toast('CDC complet ✓ — retour à la demande…'); setTimeout(() => location.href = '/?d=' + encodeURIComponent(DEMANDE), 500); }
}
function fusionner(d) {
  if (!d || d.v !== 2) throw new Error('format');
  const v = etatVierge();
  S = Object.assign(v, d); S.gen = Object.assign(v.gen, d.gen || {}); S.projet = Object.assign(v.projet, d.projet || {});
  S.vidage = Object.assign(v.vidage, d.vidage || {}); S.palettisation = Object.assign(v.palettisation, d.palettisation || {});
  S.ui = Object.assign(v.ui, d.ui || {}); S.ui.touche = false;
  ['palox', 'formats', 'lignes', 'fichiers'].forEach(k => { if (!Array.isArray(S[k])) S[k] = []; });
}
function exporterJson() {
  const nom = `CDC_emballage_${(S.gen.client || 'client').replace(/[^\w\-]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.json`;
  const b = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = nom; a.click(); URL.revokeObjectURL(a.href); toast('Export : ' + nom);
}
function importerJson(fic) {
  if (FIGEE) return;
  const lect = new FileReader();
  lect.onload = () => { try { fusionner(JSON.parse(lect.result)); render(); sauvegarder(false); toast('Import réussi ✓'); } catch (e) { toast('Fichier JSON invalide (CDC emballage v2 attendu)', true); } };
  lect.readAsText(fic);
}
function preremplir(d, premier) {
  const g = S.gen, setv = (k, v) => { if (v && (!g[k] || (premier && k === 'retour'))) g[k] = v; };
  const nom = (d.commercial_nom || '').trim().split(/\s+/);
  setv('comP', nom[0] || ''); setv('comN', nom.slice(1).join(' ')); setv('email', d.commercial_email); setv('client', d.client_nom);
  if (d.client_pays && PAYS.includes(d.client_pays)) g.pays = d.client_pays;
  setv('retour', d.retour_souhaite); setv('varietes', d.varietes); setv('tonnageAn', d.tonnage_annuel); setv('tonnageH', d.tonnage_horaire); setv('tempsTravail', d.temps_travail); setv('description', d.description);
  if (d.produits && !g.fruits.length) { FRUITS.forEach(f => { if (f !== 'Autre' && d.produits.toLowerCase().includes(f.toLowerCase().split(' ')[0])) g.fruits.push(f); });
    const autres = d.produits.split(/[,;/]+/).map(s => s.trim()).filter(s => s && !FRUITS.some(f => f.toLowerCase().startsWith(s.toLowerCase().slice(0, 4)))); if (autres.length) { g.fruits.push('Autre'); g.fruitsAutre = autres.join(', '); } }
}

/* ================= RÉCAP PDF ================= */
function construireRecap() {
  const q = (lbl, v) => `<div class="r-q"><span class="q">${esc(lbl)}</span><span class="a ${v ? '' : 'vide'}">${v ? esc(v) : '—'}</span></div>`;
  const opts = (o, defs) => (defs || []).map(d => { const v = o?.[d.k]; if (v == null || v === '' || (Array.isArray(v) && !v.length)) return ''; return q(d.lbl, Array.isArray(v) ? v.join(', ') : v); }).join('');
  const note = t => t ? `<div class="r-note">${esc(t)}</div>` : '';
  const g = S.gen, m = S.projet.mode, num = META ? 'D-' + String(META.demande.numero).padStart(4, '0') : '';
  let h = `<div class="r-tete"><img src="/static/common/logo.png" alt=""><div><h1>CDC EMBALLAGE</h1><div class="r-ss">${esc(MODES[m]?.lbl || 'Type de projet non défini')}</div></div>
    <div class="r-meta">${num ? num + '<br>' : ''}Édité le ${dateAuj()}<br>${g.version ? 'Version ' + esc(g.version) : ''}</div></div>
    <div class="r-info"><div><b>Client :</b> ${esc(g.client)}</div><div><b>Pays :</b> ${esc(g.pays)}</div><div><b>Commercial :</b> ${esc(g.comP + ' ' + g.comN)}</div>
      <div><b>Fruits :</b> ${esc(g.fruits.join(', '))}${g.fruitsAutre ? ' (' + esc(g.fruitsAutre) + ')' : ''}</div><div><b>Tonnage :</b> ${esc(g.tonnageH)} T/h${g.tonnageAn ? ' · ' + esc(g.tonnageAn) + ' T/an' : ''}</div><div><b>Retour souhaité :</b> ${esc(g.retour)}</div></div>`;
  h += `<h2>Général</h2>${q('Email', g.email)}${q('Variétés', g.varietes)}${q('Temps de travail', g.tempsTravail)}${q('Description du projet', g.description)}${q('Fichiers partagés', S.fichiers.join(', '))}${note(g.notes)}`;
  h += `<h2>Projet</h2>${q('Type', MODES[m]?.lbl)}${q('Nombre de lignes', S.lignes.length)}${S.lignes.map((l, i) => q(`L${i + 1}`, `${lblLigne(l)}${l.debit ? ' — ' + l.debit : ''}${l.produits ? ' — ' + l.produits : ''}`)).join('')}${note(S.projet.notes)}`;
  if (S.palox.length) h += `<h2>Palox</h2><table><tr><th>#</th>${PALOX_DEF.map(d => `<th>${esc(d.lbl)}</th>`).join('')}<th>Notes</th></tr>${S.palox.map((p, i) => `<tr><td>P${i + 1}</td>${PALOX_DEF.map(d => `<td>${esc(p[d.k])}</td>`).join('')}<td>${esc(p.notes)}</td></tr>`).join('')}</table>`;
  if (S.formats.length) h += `<h2>Formats de colis</h2><table><tr><th>#</th><th>Nom</th><th>Type</th><th>L×l×h (mm)</th><th>Poids (kg)</th><th>Colis/couche</th><th>Couches</th><th>Intercal.</th><th>½ pal.</th><th>Palettes</th><th>Cornières</th><th>Liens</th></tr>
    ${S.formats.map((f, i) => `<tr><td>F${i + 1}</td><td>${esc(f.nom)}</td><td>${esc(f.type)}</td><td>${esc([f.L, f.l, f.h].join('×'))}</td><td>${esc(f.poids)}</td><td>${esc(f.colisCouche)}</td><td>${esc(f.couches)}</td><td>${esc(f.intercalaires)}</td><td>${esc(f.demi)}</td><td>${esc((f.palettes || []).join(', '))}${f.palettesAutre ? ' ' + esc(f.palettesAutre) : ''}</td><td>${esc(f.corniere)}</td><td>${esc(f.nbLiens)}</td></tr>`).join('')}</table>${S.formats.map(f => f.notes ? note(f.nom + ' : ' + f.notes) : '').join('')}`;
  const nomsLignes = ids => (ids || []).map(id => lblLigne(S.lignes.find(l => l.id === id) || {})).join(', ');
  const nomsPalox = ids => (ids || []).map(id => lblPalox(S.palox.find(p => p.id === id) || {})).join(', ');
  if (m !== 'modif') {
    h += `<h2>Vidage des palox</h2>${m === 'neuf' ? q('Organisation', { indep: 'Indépendant', mutu: 'Mutualisé', mixte: 'Mixte' }[S.vidage.mode]) : ''}`;
    S.vidage.groupes.forEach((gp, i) => { h += `<h3>V${i + 1} · ${esc(gp.nom)}</h3>${q('Type', (vidDef(gp.type)?.lbl || gp.type) + (gp.typeAutre ? ' — ' + gp.typeAutre : ''))}${m === 'neuf' ? q('Lignes alimentées', nomsLignes(gp.lignes)) : ''}${q('Palox', nomsPalox(gp.palox))}${opts(gp.opts, VIDAGE_OPTS)}${note(gp.notes)}`; });
    h += note(S.vidage.notes);
  }
  h += `<h2>${m === 'modif' ? 'Lignes existantes et modifications' : 'Lignes d\'emballage'}</h2>`;
  S.lignes.forEach((l, i) => {
    h += `<h3>L${i + 1} · ${esc(lblLigne(l))}${l.debit ? ' — ' + esc(l.debit) : ''}${l.produits ? ' — ' + esc(l.produits) : ''}</h3>`;
    if (m === 'modif') {
      SECTIONS_EXISTANT.forEach(s => { const x = l.existant[s.k]; if (!x) return; if (x.present === 'Non' && !x.modifier) return;
        h += q(s.lbl + (x.modifier ? ' — À MODIFIER' : ''), [x.present === 'Non' ? 'absente aujourd\'hui' : x.description, x.modifier ? '→ ' + (x.remplacer || '') + (x.remplacerDetail ? ' (' + x.remplacerDetail + ')' : '') : '', x.notes].filter(Boolean).join(' | ')); });
    } else {
      ETAPES_TETE.forEach(e => { const t = l.tete[e.k]; if (!t?.actif) { h += q(e.lbl, 'absente'); return; } h += q(e.lbl, 'oui' + (t.opts?.type ? ' — ' + (Array.isArray(t.opts.type) ? t.opts.type.join(', ') : t.opts.type) : '')); h += opts(t.opts, e.opts.filter(o => o.k !== 'type')); if (t.notes) h += note(e.lbl + ' : ' + t.notes); });
      l.machines.forEach((mc, j) => { const d = machDef(mc.k); h += q(`Machine ${j + 1}`, (d?.lbl || mc.k) + (mc.acc.length ? ' + ' + mc.acc.map(a => ACCESSOIRES[a]?.lbl || a).join(', ') : '')); h += opts(mc.opts, d?.opts); if (mc.notes) h += note(mc.notes); });
    }
    h += q('Formats de colis', (l.formats || []).map(id => lblFormat(S.formats.find(f => f.id === id) || {})).join(', '));
    h += note(l.notes);
  });
  if (m !== 'modif') {
    h += `<h2>Palettisation</h2>${m === 'neuf' ? q('Organisation', { indep: 'Indépendante', mutu: 'Mutualisée', mixte: 'Mixte' }[S.palettisation.mode]) : ''}`;
    S.palettisation.groupes.forEach((gp, i) => { h += `<h3>PA${i + 1} · ${esc(gp.nom)}</h3>${q('Type', (palDef(gp.type)?.lbl || gp.type) + (gp.typeAutre ? ' — ' + gp.typeAutre : ''))}${m === 'neuf' ? q('Lignes desservies', nomsLignes(gp.lignes)) : ''}${opts(gp.opts, PALETTISATION_OPTS)}${note(gp.notes)}`; });
    h += note(S.palettisation.notes);
  }
  h += `<h2>Schéma des lignes</h2><div class="r-schema">${svgSchema()}</div>`;
  h += `<div class="r-propriete">Ce document est la propriété exclusive de <b>MAF AGROBOTIC</b> et reste strictement confidentiel. Toute utilisation non autorisée pourra faire l'objet de poursuites.</div>
    <div class="r-pied"><span>CDC Emballage — MAF RODA</span><span>${esc(g.client)} · ${dateAuj()}</span></div>`;
  $('#recapPdf').innerHTML = h;
}
function genererPdf() { construireRecap(); window.print(); }

/* ================= DÉMARRAGE ================= */
async function demarrer() {
  lierEvenements();
  if (DEMANDE) {
    let r;
    try { r = await fetch(API); } catch (e) { toast('Serveur injoignable', true); render(); return; }
    if (r.status === 401) { location.href = '/login?d=' + encodeURIComponent(DEMANDE); return; }
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast(j.error || 'CDC introuvable', true); render(); return; }
    META = await r.json();
    const d = META.data && META.data.v === 2 ? META.data : null;
    if (d) fusionner(d); else S = etatVierge();
    preremplir(META.demande, !d);
    FIGEE = LECTURE || META.demande.statut !== 'brouillon';
    const dm = META.demande;
    $('#bandeauDemande').style.display = '';
    $('#bandeauDemande').innerHTML = `<div class="bd"><div><b style="color:var(--vert)">D-${String(dm.numero).padStart(4, '0')}</b> · <b>${esc(dm.client_nom)}</b> — ${esc(dm.titre)}
      <div class="sub">${FIGEE ? 'Consultation seule' : 'Sauvegarde automatique dans la demande'} · ${esc(dm.commercial_nom || '')}</div></div><a href="/?d=${encodeURIComponent(DEMANDE)}">← Retour à la demande</a></div>`;
    if (FIGEE) { ['btnSauveHaut', 'btnImport', 'btnRaz'].forEach(id => $('#' + id).style.display = 'none'); }
    document.title = `CDC Emballage — D-${String(dm.numero).padStart(4, '0')} ${dm.client_nom}`;
    if (FIGEE && !LECTURE) toast('Demande envoyée : le CDC est figé (consultation).');
  } else {
    try { const brut = localStorage.getItem(CLE_STOCKAGE); if (brut) fusionner(JSON.parse(brut)); } catch (e) { console.warn('Chargement impossible', e); }
    if (S.sauveLe) { $('#statutSauve').innerHTML = `● Sauvegardé <b>${new Date(S.sauveLe).toLocaleString('fr-FR')}</b>`; }
  }
  render();
}
document.addEventListener('DOMContentLoaded', demarrer);
