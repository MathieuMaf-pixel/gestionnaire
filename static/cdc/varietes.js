/* ============================================================
   Sélecteur fruit & variétés — greffon pour les pages CDC
   ------------------------------------------------------------
   Remplace visuellement les champs « Fruits : » (6) et « Variétés : » (83)
   de la page Général par un sélecteur visuel : fruit → variétés → mix de
   tonnage, et ajoute un tableau de débit par variété sous la feuille de
   calcul de la page Calibrage (94).

   Ne modifie pas la page CDC : il masque deux rangs, en injecte deux blocs,
   et pilote les champs d'origine (S.f['6'], S.f['6o'], S.f['83']) pour que
   la complétude, le récapitulatif et le PDF continuent de fonctionner.

   Données : /static/common/varietes.json (158 variétés, 8 fruits), issu du
   référentiel fiche-varietes-fruits.html.
   État structuré : S.varietes — voyage dans le blob CDC, aucun changement
   de schéma.
   ============================================================ */
(function () {
  'use strict';

  const Q = s => document.querySelector(s);
  const QA = s => Array.from(document.querySelectorAll(s));
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const P = new URLSearchParams(location.search);
  const DEMANDE = P.get('demande');
  const LECTURE = P.get('lecture') === '1';

  let REF = null;                 // référentiel chargé
  let PAR_FRUIT = {}, PARCLE = {}, FRUITS = [];
  let uid = 0;
  let rech = '';

  /* ---------- format français ---------- */
  const NF = {};
  const nf = d => NF[d] || (NF[d] = new Intl.NumberFormat('fr-FR',
    { minimumFractionDigits: d, maximumFractionDigits: d }));
  const n = (x, d) => (typeof x === 'number' && isFinite(x)) ? nf(d == null ? 1 : d).format(x) : '—';

  /* ---------- état ---------- */
  const CORRESP = { pommes: 'Pomme', poires: 'Poire' };
  function etat() {
    if (!S.varietes || typeof S.varietes !== 'object') S.varietes = {};
    const v = S.varietes;
    if (!v.sel || !Array.isArray(v.sel)) v.sel = [];
    if (!v.mix || typeof v.mix !== 'object') v.mix = {};
    if (typeof v.jeu !== 'number') v.jeu = 6;
    if (typeof v.vit !== 'number') v.vit = 0.45;
    if (typeof v.grAuto !== 'boolean') v.grAuto = true;
    if (v.fruit === undefined) v.fruit = null;
    return v;
  }
  function selVar() {
    return etat().sel.map(k => PARCLE[k]).filter(Boolean)
      .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  }

  /* ---------- écriture dans les champs d'origine ---------- */
  let tPush = null;
  function pousserChamps() {
    const v = etat(), sel = selVar();
    const libelle = v.fruit ? REF.fruits[v.fruit] : '';
    if (Array.isArray(S.f['6'])) {
      if (!v.fruit) { S.f['6'] = []; S.f['6o'] = ''; }
      else if (CORRESP[v.fruit]) { S.f['6'] = [CORRESP[v.fruit]]; S.f['6o'] = ''; }
      else { S.f['6'] = ['__AUTRE__']; S.f['6o'] = libelle; }
    }
    S.f['83'] = sel.map(x => x.nom).join(', ');
    // poids typique pondéré → « gr » de la feuille de calcul, tant que l'utilisateur ne l'a pas saisi lui-même
    const p = poidsPondere();
    if (p && S.calc && (v.grAuto || !String(S.calc.c || '').trim())) {
      S.calc.c = String(Math.round(p));
      v.grAuto = true;
      const el = Q('#calc_c'); if (el) el.value = S.calc.c;
      if (typeof calculerTh === 'function') calculerTh();
    }
    if (typeof changement === 'function') changement();
    if (DEMANDE && !LECTURE) {
      clearTimeout(tPush);
      tPush = setTimeout(() => {
        fetch('/api/demandes/' + encodeURIComponent(DEMANDE), {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ produits: libelle, varietes: S.f['83'] })
        }).catch(() => { });
      }, 1200);
    }
  }
  function poidsPondere() {
    const v = etat(), sel = selVar();
    const som = sel.reduce((a, x) => a + (+v.mix[x.key] || 0), 0);
    if (!som) return sel.length ? sel.reduce((a, x) => a + (x.P.typ || 0), 0) / sel.length : null;
    return sel.reduce((a, x) => a + (x.P.typ || 0) * (+v.mix[x.key] || 0), 0) / som;
  }

  /* ---------- silhouettes ---------- */
  function silSvg(v, ech, alt, h) {
    const s = v.sil, bb = s.bb;
    const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
    const suf = s.pref + '-i' + (++uid);
    const defs = s.defs.split(s.pref).join(suf);
    const paint = s.paint.split(s.pref).join(suf);
    const rx = (v.D.amax || 0) / 2, ry = (v.L.amax || 0) / 2;
    return '<svg class="fv-sil" viewBox="' + r1(cx - ech / 2) + ' ' + r1(cy - ech / 2) + ' ' + r1(ech) + ' ' + r1(ech)
      + '" style="height:' + h + 'px" role="img" aria-label="' + esc(alt) + '">'
      + '<defs>' + defs + '</defs>'
      + '<ellipse class="fv-env" cx="' + r1(cx) + '" cy="' + r1(cy) + '" rx="' + r1(rx) + '" ry="' + r1(ry)
      + '" vector-effect="non-scaling-stroke"/>' + paint + '</svg>';
  }
  const r1 = x => Math.round(x * 10) / 10;
  function echelleFruit(f) {
    let m = 0;
    PAR_FRUIT[f].forEach(v => { m = Math.max(m, v.D.amax || 0, v.L.amax || 0); });
    return m * 1.06 || 100;
  }

  /* ---------- calcul ---------- */
  function calcul() {
    const v = etat(), sel = selVar();
    const r = { sel: sel, jeu: +v.jeu, vit: +v.vit, rows: [] };
    if (!sel.length) return r;
    r.rows = sel.map(x => ({ v: x, pas: (x.D.amax || 0) + r.jeu, part: +v.mix[x.key] || 0 }));
    r.pasRet = Math.max.apply(null, r.rows.map(x => x.pas));
    r.dim = r.rows.filter(x => x.pas === r.pasRet).map(x => x.v.nom).join(', ');
    r.gminMax = r.pasRet > 0 ? (r.vit * 60000) / r.pasRet : 0;
    r.oMin = Math.min.apply(null, r.rows.map(x => x.v.D.amin || 0));
    r.oMax = Math.max.apply(null, r.rows.map(x => x.v.D.amax || 0));
    r.lMax = Math.max.apply(null, r.rows.map(x => x.v.L.amax || 0));
    r.somme = r.rows.reduce((a, x) => a + x.part, 0);
    r.extrap = r.rows.filter(x => x.v.D.conf === 'X' || x.v.L.conf === 'X' || x.v.P.conf === 'X').map(x => x.v.nom);
    // débit avec les valeurs de la feuille de calcul de la page Calibrage
    const num = z => parseFloat(String(z == null ? '' : z).replace(',', '.'));
    const a = num(S.calc && S.calc.a), b = num(S.calc && S.calc.b), d = num(S.calc && S.calc.d);
    r.gminSaisie = isFinite(a) ? a : null;
    r.eta = isFinite(b) ? b : null;
    r.lignes = isFinite(d) ? d : null;
    if (r.gminSaisie != null && r.eta != null && r.lignes != null) {
      // la cadence applicable ne peut pas depasser le plafond impose par le pas retenu
      r.gminEff = Math.min(r.gminSaisie, r.gminMax);
      r.bride = r.gminSaisie > r.gminMax + 0.5;
      const th = (g, p) => (g * (r.eta / 100) * (p || 0) * r.lignes * 60) / 1e6;
      r.rows.forEach(x => {
        x.gminPropre = x.pas > 0 ? (r.vit * 60000) / x.pas : 0;
        // si la variete passait seule : meme cadence demandee, plafonnee par SON pas
        x.gminEffPropre = Math.min(r.gminSaisie, x.gminPropre);
        x.thPropre = th(x.gminEffPropre, x.v.P.typ);
        x.th = th(r.gminEff, x.v.P.typ);
        x.perte = x.thPropre > 0 ? (1 - x.th / x.thPropre) * 100 : 0;
        x.contrib = x.th * x.part / 100;
      });
      r.thMix = r.rows.reduce((a2, x) => a2 + x.contrib, 0);
      r.complet = true;
    }
    return r;
  }

  /* ---------- rendu : bloc page Général ---------- */
  function rendreBloc() {
    const hote = Q('#fv-bloc'); if (!hote || !REF) return;
    const v = etat();
    let h = '';

    h += '<div class="fv-sec"><div class="fv-lbl">Fruit <span class="req">*</span></div>'
      + '<div class="fv-ftiles">' + FRUITS.map(f => {
        const lst = PAR_FRUIT[f];
        const tri = lst.slice().sort((a, b) => (a.D.typ || 0) - (b.D.typ || 0));
        const rep = tri[Math.floor(tri.length / 2)];
        const bb = rep.sil.bb;
        const ech = Math.max(bb[2] - bb[0], bb[3] - bb[1]) * 1.34;
        const oMin = Math.min.apply(null, lst.map(x => x.D.amin || 0));
        const oMax = Math.max.apply(null, lst.map(x => x.D.amax || 0));
        return '<button type="button" class="fv-ftile" data-f="' + f + '" aria-pressed="' + (v.fruit === f) + '">'
          + silSvg(rep, ech, REF.fruits[f], 62)
          + '<span class="fv-fn">' + esc(REF.fruits[f]) + '</span>'
          + '<span class="fv-fc">' + n(lst.length, 0) + ' variétés · Ø ' + n(oMin, 0) + '–' + n(oMax, 0) + ' mm</span>'
          + '</button>';
      }).join('') + '</div></div>';

    if (!v.fruit) {
      h += '<div class="fv-info fv-bad">Choisir un fruit pour accéder aux variétés. Ce choix remplit le champ « Fruits » du cahier des charges.</div>';
      hote.innerHTML = h; lierTuiles(); return;
    }

    const ech = echelleFruit(v.fruit);
    const q = rech.trim().toLowerCase();
    const lst = PAR_FRUIT[v.fruit].filter(x => !q || x.nom.toLowerCase().indexOf(q) >= 0);
    h += '<div class="fv-sec"><div class="fv-lbl">Variétés · ' + esc(REF.fruits[v.fruit]) + '</div>'
      + '<div class="fv-note">Silhouettes à l\'échelle commune du fruit : trait plein = gabarit typique, pointillé = enveloppe récolte. Sélection multiple.</div>'
      + '<div class="fv-bar">'
      + '<input type="search" id="fv-rech" placeholder="Filtrer par nom…" value="' + esc(rech) + '" aria-label="Filtrer les variétés">'
      + '<button type="button" class="fv-b" id="fv-all">Tout cocher</button>'
      + '<button type="button" class="fv-b" id="fv-none">Tout décocher</button>'
      + '<span class="fv-cnt">' + n(lst.length, 0) + ' affichées · <b>' + n(v.sel.length, 0) + ' retenues</b></span>'
      + '</div><div class="fv-vtiles">'
      + lst.map(x => {
        const on = v.sel.indexOf(x.key) >= 0;
        const cf = (x.D.conf === 'X' || x.L.conf === 'X' || x.P.conf === 'X') ? 'X' : 'S';
        return '<div class="fv-vtile' + (on ? ' on' : '') + '" data-k="' + esc(x.key) + '">'
          + silSvg(x, ech, x.nom + ' : Ø typique ' + n(x.D.typ, 0) + ' mm, enveloppe ' + n(x.D.amin, 0) + ' à ' + n(x.D.amax, 0) + ' mm', 84)
          + '<span class="fv-vn">' + esc(x.nom) + '</span>'
          + '<span class="fv-vd">Ø ' + n(x.D.typ, 0) + ' · L ' + n(x.L.typ, 0) + ' mm · ' + n(x.P.typ, 0) + ' g</span>'
          + '<span class="fv-vd">env. Ø ' + n(x.D.amin, 0) + '–' + n(x.D.amax, 0) + ' mm</span>'
          + '<span class="fv-vb"><span class="fv-badge">' + esc(x.famille) + '</span>'
          + '<span class="fv-badge b' + cf + '" title="' + (cf === 'X' ? 'Enveloppe extrapolée' : 'Enveloppe sourcée') + '">' + cf + '</span></span>'
          + '<label class="fv-chk"><input type="checkbox" data-fvk="' + esc(x.key) + '"' + (on ? ' checked' : '')
          + ' aria-label="Retenir ' + esc(x.nom) + '"> Retenir</label></div>';
      }).join('') + '</div></div>';

    h += '<div id="fv-aval"></div>';
    hote.innerHTML = h;
    lierTuiles();
    rendreAval();
  }

  function rendreAval() {
    const hote = Q('#fv-aval'); if (!hote) return;
    const v = etat();
    let h = '';
    const r = calcul();
    if (r.rows.length) {
      h += '<div class="fv-sec"><div class="fv-lbl">Mix de tonnage</div>'
        + '<div class="fv-note">Part de chaque variété dans le tonnage de la saison. Sans elle, aucun débit moyen n\'est annonçable.</div>'
        + '<div class="fv-bar"><button type="button" class="fv-b" id="fv-equi">Répartir à parts égales</button>'
        + '<span class="fv-cnt">Somme : <b class="' + (Math.abs(r.somme - 100) < 0.05 ? 'fv-ok' : 'fv-ko') + '">' + n(r.somme, 1) + ' %</b></span></div>'
        + '<div class="fv-tw"><table class="fv-t"><thead><tr><th>Variété</th><th>Ø typ.</th><th>Poids typ.</th>'
        + '<th>Récolte</th><th>Part (%)</th><th>Tonnage (t)</th></tr></thead><tbody>'
        + r.rows.map(x => {
          const tan = parseFloat(String(S.f['104'] || '').replace(',', '.').replace(/[^\d.]/g, ''));
          return '<tr><td class="l">' + esc(x.v.nom) + '</td><td>' + n(x.v.D.typ, 0) + ' mm</td><td>' + n(x.v.P.typ, 0) + ' g</td>'
            + '<td>' + mois(x.v.saison) + '</td>'
            + '<td><input type="number" class="fv-mix" data-fvm="' + esc(x.v.key) + '" step="0.5" min="0" max="100" value="' + x.part + '"></td>'
            + '<td>' + (isFinite(tan) && tan ? n(tan * x.part / 100, 0) : '—') + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';

      h += '<div class="fv-sec"><div class="fv-lbl">Enveloppe retenue pour le dimensionnement</div>'
        + '<div class="fv-kpis">'
        + kpi('Ø mini de l\'union', n(r.oMin, 0) + ' mm', 'plus petit fruit récolté')
        + kpi('Ø maxi de l\'union', n(r.oMax, 0) + ' mm', 'fixe le pas de godet')
        + kpi('L maxi de l\'union', n(r.lMax, 0) + ' mm', 'encombrement en longueur')
        + kpi('Poids typ. pondéré', n(poidsPondere(), 0) + ' g', 'reporté dans « gr »')
        + '</div></div>';

      if (r.extrap.length) {
        h += '<div class="fv-info fv-warn"><b>' + n(r.extrap.length, 0) + ' variété(s) à enveloppe extrapolée</b> — '
          + esc(r.extrap.join(', ')) + '. Aucune dimension mesurée disponible : à confirmer par échantillonnage avant engagement.</div>';
      }
      if (Math.abs(r.somme - 100) > 0.05) {
        h += '<div class="fv-info fv-warn">Somme des parts à <b>' + n(r.somme, 1) + ' %</b> au lieu de 100 % : le débit moyen du mix reste faux.</div>';
      }
    } else {
      h += '<div class="fv-info fv-bad">Aucune variété retenue — cocher au moins une variété.</div>';
    }
    hote.innerHTML = h;
    lierAval();
  }
  function kpi(l, val, sub) {
    return '<div class="fv-kpi"><div class="k">' + esc(l) + '</div><div class="v">' + esc(val) + '</div><div class="s">' + esc(sub) + '</div></div>';
  }
  function mois(s) {
    if (!(typeof s === 'number' && isFinite(s))) return '—';
    const M = ['janv.', 'févr.', 'mars', 'avril', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
    return M[Math.max(0, Math.min(11, Math.round(s) - 1))];
  }

  /* ---------- rendu : bloc page Calibrage ---------- */
  function rendreDebit() {
    const hote = Q('#fv-debit'); if (!hote || !REF) return;
    const v = etat(), r = calcul();
    if (!r.rows.length) {
      hote.innerHTML = '<div class="fv-info fv-bad">Aucune variété retenue en page Général : pas de débit par variété.</div>';
      return;
    }
    let h = '<div class="fv-lbl">Débit par variété <span class="fv-note" style="text-transform:none;font-weight:400">— même formule que la feuille de calcul ci-dessus, un <span class="fv-m">gr</span> par variété</span></div>';
    h += '<div class="fv-bar">'
      + '<label class="fv-il">Jeu godet <input type="number" id="fv-jeu" step="0.5" min="0" max="30" value="' + v.jeu + '"> mm</label>'
      + '<label class="fv-il">Vitesse linéaire <input type="number" id="fv-vit" step="0.01" min="0.05" max="1.5" value="' + v.vit + '"> m/s</label>'
      + '</div>';
    h += '<div class="fv-kpis">'
      + kpi('Pas de godet retenu', n(r.pasRet, 0) + ' mm', 'Ø maxi + ' + n(r.jeu, 0) + ' mm de jeu')
      + kpi('Variété dimensionnante', r.dim, 'impose le pas à tous')
      + kpi('Cadence applicable', n(r.complet ? r.gminEff : r.gminMax, 0) + ' g/min',
        r.bride ? 'plafonnée — saisie ' + n(r.gminSaisie, 0) : 'plafond ' + n(r.gminMax, 0) + ' à ' + n(r.vit, 2) + ' m/s')
      + kpi('Débit du mix', r.complet ? n(r.thMix, 2) + ' t/h' : '—', r.complet ? 'pondéré par le tonnage' : 'compléter g/min, % et Lignes')
      + '</div>';
    if (r.complet) {
      h += '<div class="fv-tw"><table class="fv-t"><thead><tr><th>Variété</th><th>Ø env. max</th><th>pas(v)</th>'
        + '<th>g/min propre</th><th>gr</th><th>T/h propre</th><th>T/h retenu</th><th>Perte de mix</th><th>Part</th><th>Contribution</th></tr></thead><tbody>'
        + r.rows.map(x => {
          const dim = x.pas === r.pasRet;
          return '<tr><td class="l">' + esc(x.v.nom) + '</td>'
            + '<td>' + n(x.v.D.amax, 0) + ' mm</td>'
            + '<td class="' + (dim ? 'ko' : '') + '">' + n(x.pas, 0) + ' mm</td>'
            + '<td>' + n(x.gminEffPropre, 0) + '</td>'
            + '<td>' + n(x.v.P.typ, 0) + ' g</td>'
            + '<td>' + n(x.thPropre, 2) + '</td>'
            + '<td class="' + (dim ? 'hl' : '') + '">' + n(x.th, 2) + '</td>'
            + '<td class="' + (x.perte > 15 ? 'ko' : '') + '">' + (x.perte > 0.05 ? '−' + n(x.perte, 1) + ' %' : '0') + '</td>'
            + '<td>' + n(x.part, 1) + ' %</td><td>' + n(x.contrib, 2) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
      h += '<div class="fv-note">« T/h propre » = débit de la variété seule, à son propre pas. « T/h retenu » = débit réel dans le mix, au pas commun et à la cadence applicable. L\'écart est le coût du mix.<br>'
        + 'La feuille de calcul ci-dessus reste la formule d\'origine sur une seule ligne : elle utilise le poids pondéré ('
        + n(poidsPondere(), 0) + ' g) à la cadence saisie, sans plafonnement par le pas. D\'où l\'écart avec le débit du mix.</div>';
      if (r.bride) {
        h += '<div class="fv-info fv-bad">Cadence saisie <b>' + n(r.gminSaisie, 0) + ' g/min</b> inatteignable : à '
          + n(r.vit, 2) + ' m/s et un pas de ' + n(r.pasRet, 0) + ' mm, le plafond est de <b>' + n(r.gminMax, 0)
          + ' g/min</b>. Les débits ci-dessous sont calculés à ce plafond, pas à la valeur saisie.</div>';
      }
      const dimN = r.rows.filter(x => x.perte > 0.05).map(x => x.v.nom);
      if (dimN.length) {
        h += '<div class="fv-info fv-warn"><b>Coût du mix.</b> Le pas de ' + n(r.pasRet, 0) + ' mm imposé par '
          + esc(r.dim) + ' bride ' + esc(dimN.join(', ')) + '. Chaque variété perd ce que son propre pas lui aurait permis.</div>';
      }
      const cible = parseFloat(String(S.f['84'] || '').replace(',', '.'));
      if (isFinite(cible) && cible > 0) {
        const ok = r.thMix >= cible;
        h += '<div class="fv-info ' + (ok ? 'fv-good' : 'fv-bad') + '">' + (ok ? '✓ ' : '')
          + 'Tonnage horaire demandé ' + n(cible, 1) + ' t/h — débit du mix ' + n(r.thMix, 2) + ' t/h ('
          + (r.thMix - cible >= 0 ? '+' : '') + n(r.thMix - cible, 2) + ').</div>';
      }
    }
    hote.innerHTML = h;
    lierAval();
  }

  /* ---------- liaisons ---------- */
  function gele() {
    if (!LECTURE) return false;
    QA('#fv-bloc input,#fv-bloc button,#fv-debit input').forEach(e => e.disabled = true);
    return true;
  }

  function lierTuiles() {
    if (gele()) return;
    QA('#fv-bloc .fv-ftile').forEach(b => b.onclick = () => {
      const v = etat(), f = b.dataset.f;
      if (v.fruit !== f) { v.fruit = f; v.sel = []; v.mix = {}; }
      rech = ''; pousserChamps(); tout();
    });
    QA('#fv-bloc input[data-fvk]').forEach(c => c.onchange = () => {
      const v = etat(), k = c.dataset.fvk, i = v.sel.indexOf(k);
      if (c.checked && i < 0) { v.sel.push(k); if (v.mix[k] == null) v.mix[k] = 0; }
      if (!c.checked && i >= 0) { v.sel.splice(i, 1); delete v.mix[k]; }
      const t = c.closest('.fv-vtile'); if (t) t.classList.toggle('on', c.checked);
      const cnt = Q('#fv-bloc .fv-cnt b'); if (cnt) cnt.textContent = n(v.sel.length, 0) + ' retenues';
      pousserChamps(); rendreAval(); rendreDebit();   // la grille de tuiles reste en place
    });
    const rc = Q('#fv-rech');
    if (rc) rc.oninput = () => { rech = rc.value; rendreBloc(); const e = Q('#fv-rech'); if (e) { e.focus(); e.selectionStart = e.value.length; } };
    const ba = Q('#fv-all');
    if (ba) ba.onclick = () => {
      const v = etat(), q = rech.trim().toLowerCase();
      PAR_FRUIT[v.fruit].filter(x => !q || x.nom.toLowerCase().indexOf(q) >= 0)
        .forEach(x => { if (v.sel.indexOf(x.key) < 0) { v.sel.push(x.key); v.mix[x.key] = v.mix[x.key] || 0; } });
      pousserChamps(); tout();
    };
    const bn = Q('#fv-none');
    if (bn) bn.onclick = () => { const v = etat(); v.sel = []; v.mix = {}; pousserChamps(); tout(); };
  }

  function lierAval() {
    if (gele()) return;
    QA('#fv-bloc .fv-mix').forEach(el => el.oninput = () => {
      let x = parseFloat(String(el.value).replace(',', '.'));
      if (!isFinite(x) || x < 0) x = 0; if (x > 100) x = 100;
      etat().mix[el.dataset.fvm] = x;
      pousserChamps(); majSomme(); rendreDebit();
    });
    const be = Q('#fv-equi');
    if (be) be.onclick = () => {
      const v = etat(), k = v.sel.length; if (!k) return;
      const p = Math.round(1000 / k) / 10;
      v.sel.forEach((key, i) => v.mix[key] = (i === k - 1) ? Math.round((100 - p * (k - 1)) * 10) / 10 : p);
      pousserChamps(); tout();
    };
    ['jeu', 'vit'].forEach(kk => {
      const el = Q('#fv-' + kk); if (!el) return;
      el.oninput = () => {
        const x = parseFloat(String(el.value).replace(',', '.'));
        const b = kk === 'jeu' ? [0, 30] : [0.05, 1.5];
        if (!isFinite(x) || x < b[0] || x > b[1]) { el.classList.add('ko'); return; }
        el.classList.remove('ko'); etat()[kk] = x;
        if (typeof changement === 'function') changement();
        rendreDebit();
      };
    });
  }
  function majSomme() {
    const r = calcul(), el = Q('#fv-bloc .fv-cnt b.fv-ok, #fv-bloc .fv-cnt b.fv-ko');
    if (el) { el.textContent = n(r.somme, 1) + ' %'; el.className = Math.abs(r.somme - 100) < 0.05 ? 'fv-ok' : 'fv-ko'; }
  }
  function tout() { rendreBloc(); rendreDebit(); }

  /* ---------- injection ---------- */
  const CSS = `
#fv-bloc,#fv-debit{margin:4px 0 2px}
.fv-sec{margin:0 0 16px}
.fv-lbl{font-weight:600;font-size:14.5px;margin-bottom:4px}
.fv-note{font-size:11.5px;color:var(--muted);margin-bottom:8px;line-height:1.45}
.fv-m{font-family:Consolas,Menlo,monospace;font-size:11.5px}
.fv-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:9px}
.fv-bar input[type=search]{flex:1 1 170px;min-width:140px;border:1px solid var(--bord);border-radius:var(--rs);padding:7px 10px;font:inherit;font-size:13px}
.fv-bar input[type=search]:focus{outline:none;border-color:var(--vert);box-shadow:var(--focus)}
.fv-b{background:var(--vert-p);color:var(--vert-f);border:1px solid #cbe5b8;border-radius:var(--rs);padding:6px 11px;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer}
.fv-b:hover{background:var(--vert);color:#fff;border-color:var(--vert)}
.fv-cnt{font-size:12px;color:var(--muted);margin-left:auto}
.fv-ok{color:var(--vert-f)} .fv-ko{color:var(--rouge)}
.fv-il{font-size:12.5px;color:var(--muted);display:inline-flex;align-items:center;gap:6px}
.fv-il input{width:74px;text-align:right;border:1px solid var(--bord);border-radius:var(--rs);padding:5px 7px;font:inherit;font-size:13px}
.fv-il input:focus{outline:none;border-color:var(--vert);box-shadow:var(--focus)}
.fv-il input.ko{border-color:var(--rouge);background:var(--rouge-p)}
.fv-sil{width:100%;display:block}
.fv-env{fill:none;stroke:var(--muted);stroke-width:.9;stroke-dasharray:3 2.4;opacity:.7}
.fv-ftiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:10px}
.fv-ftile{background:#fff;border:1px solid var(--bord);border-radius:var(--r);padding:10px 8px 9px;cursor:pointer;
  display:flex;flex-direction:column;align-items:center;gap:3px;font:inherit;color:inherit;text-align:center}
.fv-ftile:hover{border-color:var(--vert)}
.fv-ftile[aria-pressed=true]{border-color:var(--vert);background:var(--vert-p);box-shadow:0 0 0 2px rgba(85,171,38,.3)}
.fv-fn{font-weight:700;font-size:14px}
.fv-fc{font-size:11px;color:var(--muted)}
.fv-vtiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:9px}
.fv-vtile{background:#fff;border:1px solid var(--bord);border-radius:var(--r);padding:8px 8px 6px;
  display:flex;flex-direction:column;align-items:center;gap:2px}
.fv-vtile.on{border-color:var(--vert);box-shadow:0 0 0 2px rgba(85,171,38,.28)}
.fv-vn{font-weight:700;font-size:12.5px;text-align:center;line-height:1.2;margin-top:2px}
.fv-vd{font-size:10.5px;color:var(--muted);text-align:center}
.fv-vb{display:flex;gap:4px;flex-wrap:wrap;justify-content:center;margin-top:3px}
.fv-badge{font-size:9.5px;font-weight:700;padding:1px 6px;border-radius:999px;background:#eef1f5;color:var(--muted)}
.fv-badge.bS{background:var(--vert-p);color:var(--vert-f)}
.fv-badge.bX{background:var(--orange-p);color:#a35f00}
.fv-chk{margin-top:auto;padding-top:6px;border-top:1px dashed var(--bord);width:100%;display:flex;align-items:center;
  justify-content:center;gap:5px;font-size:11px;font-weight:700;color:var(--ink);cursor:pointer}
.fv-chk input{width:15px;height:15px;accent-color:var(--vert);cursor:pointer;margin:0}
.fv-tw{overflow-x:auto}
table.fv-t{border-collapse:collapse;width:100%;font-size:12.5px}
table.fv-t th,table.fv-t td{border:1px solid var(--bord);padding:5px 8px;text-align:right;font-variant-numeric:tabular-nums}
table.fv-t thead th{background:var(--vert);color:#fff;text-align:center;font-weight:600;font-variant-numeric:normal}
table.fv-t td.l,table.fv-t th:first-child{text-align:left;font-weight:600}
table.fv-t tbody tr:nth-child(even) td{background:#fafbfc}
table.fv-t td.hl{background:var(--vert-p);color:var(--vert-f);font-weight:700}
table.fv-t td.ko{background:var(--rouge-p);color:var(--rouge);font-weight:700}
table.fv-t input{width:72px;text-align:right;border:1px solid var(--bord);border-radius:var(--rs);padding:4px 6px;font:inherit;font-size:12.5px}
table.fv-t input:focus{outline:none;border-color:var(--vert);box-shadow:var(--focus)}
.fv-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.fv-kpi{background:#fff;border:1px solid var(--bord);border-left:4px solid var(--vert);border-radius:var(--rs);padding:8px 11px}
.fv-kpi .k{font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:700}
.fv-kpi .v{font-size:19px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.15;margin:2px 0 1px}
.fv-kpi .s{font-size:11px;color:var(--muted)}
.fv-info{border-radius:var(--rs);padding:9px 12px;font-size:12.5px;margin-top:10px;border-left:4px solid}
.fv-info.fv-bad{background:var(--rouge-p);border-color:var(--rouge);color:#8f1f18}
.fv-info.fv-warn{background:var(--orange-p);border-color:var(--orange);color:#8a5300}
.fv-info.fv-good{background:var(--vert-p);border-color:var(--vert);color:var(--vert-f)}
@media print{.fv-bar,.fv-ftile:not([aria-pressed=true]),.fv-vtile:not(.on){display:none!important}}
`;

  function injecter() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

    const r6 = Q('#rang_6'), r83 = Q('#rang_83');
    if (!r6 || !r83) return false;
    r6.style.display = 'none';            // champ conservé (requis, récap, PDF) mais piloté par le bloc
    r83.style.display = 'none';

    const bloc = document.createElement('div');
    bloc.className = 'rang'; bloc.id = 'fv-bloc';
    r83.parentNode.insertBefore(bloc, r83.nextSibling);

    const r94 = Q('#rang_94');
    if (r94) {
      const d = document.createElement('div');
      d.className = 'rang'; d.id = 'fv-debit';
      r94.parentNode.insertBefore(d, r94.nextSibling);
    }
    return true;
  }

  /* ---------- démarrage ---------- */
  document.addEventListener('DOMContentLoaded', async () => {
    if (!injecter()) return;
    Q('#fv-bloc').innerHTML = '<div class="fv-note">Chargement du référentiel variétés…</div>';
    try {
      const rep = await fetch('/static/common/varietes.json');
      if (!rep.ok) throw new Error('HTTP ' + rep.status);
      REF = await rep.json();
    } catch (e) {
      Q('#fv-bloc').innerHTML = '<div class="fv-info fv-bad">Référentiel variétés introuvable '
        + '(<span class="fv-m">/static/common/varietes.json</span>). Les champs Fruits et Variétés d\'origine sont réaffichés.</div>';
      Q('#rang_6').style.display = ''; Q('#rang_83').style.display = '';
      const d = Q('#fv-debit'); if (d) d.remove();
      return;
    }
    REF.v.forEach(v => { (PAR_FRUIT[v.fruit] = PAR_FRUIT[v.fruit] || []).push(v); PARCLE[v.key] = v; });
    Object.keys(PAR_FRUIT).forEach(f => PAR_FRUIT[f].sort((a, b) => a.nom.localeCompare(b.nom, 'fr')));
    FRUITS = Object.keys(REF.fruits).sort((a, b) => REF.fruits[a].localeCompare(REF.fruits[b], 'fr'));

    // re-rendu après tout rechargement d'état (démarrage, pont Gestionnaire, import JSON)
    const restaurerOrig = window.restaurerDom;
    window.restaurerDom = function () { restaurerOrig.apply(null, arguments); tout(); };
    // les erreurs des champs masqués doivent rester visibles
    const validerOrig = window.validerTout;
    window.validerTout = function () {
      const f = validerOrig.apply(null, arguments);
      if (f && f.some(c => c.id === '6' || c.id === '83')) {
        const b = Q('#fv-bloc'); if (b) b.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return f;
    };
    // la feuille de calcul influence le tableau de débit
    ['calc_a', 'calc_b', 'calc_c', 'calc_d'].forEach(id => {
      const el = Q('#' + id); if (!el) return;
      el.addEventListener('input', () => {
        if (id === 'calc_c') etat().grAuto = false;   // saisie manuelle de gr : on ne l'écrase plus
        rendreDebit();
      });
    });
    tout();
  });
})();
