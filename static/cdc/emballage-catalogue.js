/* ============================================================
   CDC EMBALLAGE — CATALOGUE (à enrichir librement)
   ------------------------------------------------------------
   Ce fichier est le seul à modifier pour ajouter une machine, un
   accessoire, un type de vidage ou de palettisation. La page
   emballage.js lit ces listes et construit les écrans toute seule.

   Conventions :
   - `k`       : clé technique unique (sans espace, sans accent) — ne pas la
                 changer une fois utilisée dans des CDC enregistrés.
   - `lbl`     : libellé affiché.
   - `fam`     : famille, pour regrouper dans les menus (Conditionnement…).
   - `opts`    : options propres à la machine — {k, lbl, t, choix?, ph?}
                 t = "radio" | "cases" | "texte" | "nombre" | "liste"
   - `acc`     : accessoires proposés quand la machine est sur la ligne
                 (clés du catalogue ACCESSOIRES).
   - `court`   : abréviation pour le schéma (≤ 12 caractères conseillés).
   ============================================================ */
'use strict';

/* ---------- Types de vidage (mutualisable entre lignes) ---------- */
const VIDAGES = [
  { k: 'dir2',      lbl: 'DIR 2',                          court: 'DIR2' },
  { k: 'dir3',      lbl: 'DIR 3',                          court: 'DIR3' },
  { k: 'robobin',   lbl: 'Robobin',                        court: 'Robobin' },
  { k: 'immersion', lbl: 'Immersion simple à fourche',     court: 'Immersion' },
  { k: 'manuel',    lbl: 'Vidage manuel',                  court: 'Manuel' },
  { k: 'autre',     lbl: 'Autre (préciser)',               court: 'Vidage' },
];
/* Options communes à tout groupe de vidage */
const VIDAGE_OPTS = [
  { k: 'nbPalox',   lbl: 'Nombre de palox par pile',      t: 'radio', choix: ['pile de 3 palox', 'pile de 4 palox', 'palox unitaire'] },
  { k: 'convoyage', lbl: 'Convoyage de palox',            t: 'radio', choix: ['Chaîne', 'Rouleaux', 'Indifférent'] },
  { k: 'attente',   lbl: 'Piles en attente',              t: 'texte', ph: 'Ex : 2 piles de pleins au sol' },
  { k: 'lavage',    lbl: 'Lavage des palox',              t: 'radio', choix: ['Oui', 'Non', 'En option'] },
  { k: 'retour',    lbl: 'Gestion des palox vides',       t: 'cases', choix: ['Reconstitution au sol', 'Reconstitution en 1 point', 'Retour vers remplissage', 'Pas de reconstitution'] },
  { k: 'cadence',   lbl: 'Cadence souhaitée (palox/h)',   t: 'nombre', ph: 'Ex : 40' },
];

/* ---------- Étapes fixes en tête de chaque ligne (après le vidage) ---------- */
const ETAPES_TETE = [
  { k: 'cuve',        lbl: 'Cuve de vidage',            court: 'Cuve',
    opts: [{ k: 'type', lbl: 'Type', t: 'radio', choix: ['Dans l\'eau', 'À sec'] },
           { k: 'volume', lbl: 'Volume / longueur', t: 'texte', ph: 'Ex : 8 m³ ou 6 m' }] },
  { k: 'elevateur',   lbl: 'Élévateur sortie d\'eau',   court: 'Élévateur',
    opts: [{ k: 'type', lbl: 'Type', t: 'cases', choix: ['Cascade', 'Douche HP', 'Relevage élévateur', 'Couteaux d\'air'] }] },
  { k: 'brosseuse',   lbl: 'Brosseuse',                 court: 'Brosseuse',
    opts: [{ k: 'type', lbl: 'Type', t: 'cases', choix: ['Brosseuse simple', 'Brosseuse + séchage', 'Cireuse', 'By-pass'] }] },
  { k: 'repartition', lbl: 'Tapis de répartition',      court: 'Répartition',
    opts: [{ k: 'longueur', lbl: 'Longueur', t: 'texte', ph: 'Ex : 6 m' },
           { k: 'tri', lbl: 'Table de tri intégrée', t: 'radio', choix: ['Oui', 'Non'] },
           { k: 'nbPostes', lbl: 'Nombre de postes de tri', t: 'nombre', ph: 'Ex : 4' }] },
];

/* ---------- Machines de conditionnement (ordre libre sur la ligne) ---------- */
const MACHINES = [
  /* — Transport / répartition — */
  { k: 'tapis2',      fam: 'Tapis & transport', lbl: 'Tapis 2 bandes',                 court: 'Tapis 2b',
    opts: [{ k: 'longueur', lbl: 'Longueur', t: 'texte', ph: 'Ex : 12 m' }, { k: 'postes', lbl: 'Nombre de postes', t: 'nombre' }] },
  { k: 'tapis3',      fam: 'Tapis & transport', lbl: 'Tapis 3 bandes',                 court: 'Tapis 3b',
    opts: [{ k: 'longueur', lbl: 'Longueur', t: 'texte', ph: 'Ex : 12 m' }, { k: 'postes', lbl: 'Nombre de postes', t: 'nombre' }] },
  { k: 'convoyeurs',  fam: 'Tapis & transport', lbl: 'Convoyeurs / transferts',        court: 'Convoyeurs',
    opts: [{ k: 'detail', lbl: 'Détail', t: 'texte' }] },
  /* — Calibrage — */
  { k: 'calibreuse',  fam: 'Calibrage',         lbl: 'Calibreuse',                     court: 'Calibreuse',
    opts: [{ k: 'modele', lbl: 'Modèle', t: 'radio', choix: ['Pomone', 'Bi-Axone', 'Autre'] },
           { k: 'nbLignes', lbl: 'Nombre de lignes', t: 'liste', choix: ['1', '2', '4', '6', '8', '10'] },
           { k: 'optique', lbl: 'Optique', t: 'cases', choix: ['Optiscan', 'Globalscan', 'IDD', 'Insight'] },
           { k: 'sorties', lbl: 'Nombre de sorties', t: 'nombre' }],
    acc: ['echantillonnage'] },
  /* — Conditionnement — */
  { k: 'fastpack',    fam: 'Conditionnement',   lbl: 'Fastpack (plateaux alvéolés)',   court: 'Fastpack',
    opts: [{ k: 'tetes', lbl: 'Nombre de têtes / postes', t: 'nombre' }],
    acc: ['depileur_plateaux', 'etiqueteuse_plateau', 'empileur', 'marquage_fruit'] },
  { k: 'flowpack',    fam: 'Conditionnement',   lbl: 'Flowpack',                       court: 'Flowpack',
    opts: [{ k: 'cadence', lbl: 'Cadence (sachets/min)', t: 'nombre' }],
    acc: ['ulma', 'peseuse', 'etiqueteuse_sachet', 'detecteur_metaux', 'marquage_fruit'] },
  { k: 'barquetteuse', fam: 'Conditionnement',  lbl: 'Barquetteuse',                   court: 'Barquett.',
    opts: [{ k: 'cadence', lbl: 'Cadence (barquettes/min)', t: 'nombre' }],
    acc: ['etiqueteuse_barquette', 'operculeuse', 'peseuse', 'marquage_fruit'] },
  { k: 'remplisseur_caisses', fam: 'Conditionnement', lbl: 'Remplisseur de caisses / cartons', court: 'Rempl. caisses',
    opts: [{ k: 'type', lbl: 'Type', t: 'radio', choix: ['Col de cygne', 'Tournant', 'Vertical', 'RIB', 'Indifférent'] },
           { k: 'nb', lbl: 'Nombre de remplisseurs', t: 'nombre' }],
    acc: ['formeuse_caisses', 'scotcheuse', 'etiqueteuse_caisse', 'imprimante_caisse'] },
  { k: 'linepack',    fam: 'Conditionnement',   lbl: 'Linepack',                       court: 'Linepack',
    opts: [{ k: 'nb', lbl: 'Nombre de postes', t: 'nombre' }],
    acc: ['etiqueteuse_caisse', 'scotcheuse'] },
  { k: 'ensacheuse_filet', fam: 'Conditionnement', lbl: 'Ensacheuse filet',            court: 'Filet',
    opts: [{ k: 'cadence', lbl: 'Cadence (sachets/min)', t: 'nombre' }],
    acc: ['peseuse', 'etiqueteuse_sachet'] },
  { k: 'peseuse_assoc', fam: 'Conditionnement', lbl: 'Peseuse associative',            court: 'Peseuse',
    opts: [{ k: 'tetes', lbl: 'Nombre de têtes', t: 'nombre' }] },
  { k: 'robot',       fam: 'Conditionnement',   lbl: 'Robot de conditionnement',       court: 'Robot',
    opts: [{ k: 'fonction', lbl: 'Fonction', t: 'texte', ph: 'Ex : mise en plateau, encaissage…' }] },
  { k: 'postes_manuel', fam: 'Conditionnement', lbl: 'Postes d\'emballage manuel',     court: 'Manuel',
    opts: [{ k: 'nb', lbl: 'Nombre de postes', t: 'nombre' }, { k: 'type', lbl: 'Type', t: 'radio', choix: ['Table', 'Rotative', 'Tapis frontal'] }] },
  /* — Fin de ligne (hors palettisation) — */
  { k: 'etiqueteuse_colis', fam: 'Fin de ligne', lbl: 'Étiqueteuse colis en ligne',   court: 'Étiq. colis', opts: [] },
  { k: 'controle_poids', fam: 'Fin de ligne',    lbl: 'Contrôle pondéral / trieuse pondérale', court: 'Ctrl poids', opts: [] },
  { k: 'accumulation', fam: 'Fin de ligne',      lbl: 'Zone d\'accumulation colis',    court: 'Accumul.', opts: [{ k: 'longueur', lbl: 'Longueur', t: 'texte' }] },
  { k: 'autre',       fam: 'Autre',              lbl: 'Autre machine (préciser)',       court: 'Autre',
    opts: [{ k: 'detail', lbl: 'Description', t: 'texte' }] },
];

/* ---------- Accessoires (proposés selon la machine) ---------- */
const ACCESSOIRES = {
  ulma:                 { lbl: 'Ensacheuse Ulma',                 court: 'Ulma' },
  peseuse:              { lbl: 'Peseuse',                         court: 'Peseuse' },
  etiqueteuse_sachet:   { lbl: 'Étiqueteuse sachet',              court: 'Étiq.' },
  detecteur_metaux:     { lbl: 'Détecteur de métaux',             court: 'Dét. métaux' },
  etiqueteuse_barquette:{ lbl: 'Étiqueteuse de barquette',        court: 'Étiq. barq.' },
  operculeuse:          { lbl: 'Operculeuse / filmeuse',          court: 'Opercul.' },
  depileur_plateaux:    { lbl: 'Dépileur de plateaux',            court: 'Dépileur' },
  etiqueteuse_plateau:  { lbl: 'Étiqueteuse plateau',             court: 'Étiq. plat.' },
  empileur:             { lbl: 'Empileur de plateaux',            court: 'Empileur' },
  formeuse_caisses:     { lbl: 'Formeuse de caisses',             court: 'Formeuse' },
  scotcheuse:           { lbl: 'Scotcheuse / fermeuse',           court: 'Scotcheuse' },
  etiqueteuse_caisse:   { lbl: 'Étiqueteuse caisse',              court: 'Étiq. caisse' },
  imprimante_caisse:    { lbl: 'Imprimante jet d\'encre caisse',  court: 'Impr.' },
  marquage_fruit:       { lbl: 'Marquage / étiquetage fruit',     court: 'Étiq. fruit' },
  echantillonnage:      { lbl: 'Échantillonnage',                 court: 'Échant.' },
};

/* ---------- Palettisation (mutualisable entre lignes) ---------- */
const PALETTISATIONS = [
  { k: 'palettiseur_auto', lbl: 'Palettiseur automatique',          court: 'Palettiseur' },
  { k: 'palettiseur_semi', lbl: 'Palettiseur semi-automatique',     court: 'Palett. semi' },
  { k: 'roulades',         lbl: 'Roulades — palettisation manuelle', court: 'Roulades' },
  { k: 'autre',            lbl: 'Autre (préciser)',                 court: 'Palett.' },
];
const PALETTISATION_OPTS = [
  { k: 'cercleuse', lbl: 'Cercleuse',                    t: 'radio', choix: ['Liaison automatique au palettiseur', 'Cercleuse séparée (manuelle)', 'Sans cercleuse'] },
  { k: 'coins',     lbl: 'Pose de cornières',            t: 'radio', choix: ['Automatique', 'Manuelle', 'Non'] },
  { k: 'intercal',  lbl: 'Pose d\'intercalaires',        t: 'radio', choix: ['Automatique', 'Manuelle', 'Non'] },
  { k: 'magasin',   lbl: 'Magasin de palettes vides',    t: 'radio', choix: ['Oui', 'Non'] },
  { k: 'evacuation',lbl: 'Évacuation palettes pleines',  t: 'cases', choix: ['Convoyeur', 'Chariot', 'Transpalette', 'Navette'] },
  { k: 'etiquetage',lbl: 'Étiquetage palette',           t: 'radio', choix: ['Automatique', 'Manuel', 'Non'] },
  { k: 'cadence',   lbl: 'Cadence (colis/h)',            t: 'nombre' },
];

/* ---------- Formats de colis ---------- */
const FORMAT_TYPES = ['Plateau alvéolé', 'Plateau vrac', 'Barquette', 'Sachet flowpack', 'Sachet filet', 'Caisse / carton', 'Bushel', 'Cageot bois', 'Vrac (palox / bin)', 'Autre'];
const PALETTES_DIMS = ['1200 × 1000 (industrielle)', '1200 × 800 (Europe)', '1140 × 1140', '1100 × 1100', '1000 × 1000', 'Demi-palette 800 × 600', 'Autre'];

/* ---------- Sections d'une ligne existante (mode modification) ---------- */
const SECTIONS_EXISTANT = [
  { k: 'vidage',        lbl: 'Vidage des palox' },
  { k: 'cuve',          lbl: 'Cuve de vidage' },
  { k: 'elevateur',     lbl: 'Élévateur sortie d\'eau' },
  { k: 'brosseuse',     lbl: 'Brosseuse' },
  { k: 'repartition',   lbl: 'Tapis de répartition / tri' },
  { k: 'calibrage',     lbl: 'Calibrage' },
  { k: 'conditionnement', lbl: 'Conditionnement (machines d\'emballage)' },
  { k: 'fin_ligne',     lbl: 'Fin de ligne (étiquetage, contrôle, accumulation)' },
  { k: 'palettisation', lbl: 'Palettisation / cerclage' },
];

/* ---------- Palox (même fiche que le CDC précalibrage) ---------- */
const PALOX_DEF = [
  { k: 'nom',      lbl: 'Désignation', t: 'texte', ph: 'Ex : Palox bois 1200' },
  { k: 'largeur',  lbl: 'Largeur',     t: 'texte', ph: 'mm' },
  { k: 'longueur', lbl: 'Longueur',    t: 'texte', ph: 'mm' },
  { k: 'hauteur',  lbl: 'Hauteur',     t: 'texte', ph: 'mm' },
  { k: 'skis',     lbl: 'Skis',        t: 'liste', choix: ['2 skis', '3 skis', 'plots'] },
  { k: 'matiere',  lbl: 'Matière',     t: 'liste', choix: ['Bois', 'Plastique', 'Métal', 'Autre'] },
  { k: 'pVide',    lbl: 'Poids vide',  t: 'texte', ph: 'kg' },
  { k: 'pRempli',  lbl: 'Poids rempli',t: 'texte', ph: 'kg' },
];

const PAYS = ["France","Afghanistan","Afrique du Sud","Albanie","Algérie","Allemagne","Andorre","Angola","Arabie saoudite","Argentine","Arménie","Australie","Autriche","Azerbaïdjan","Bahreïn","Bangladesh","Belgique","Bénin","Biélorussie","Bolivie","Bosnie-Herzégovine","Botswana","Brésil","Bulgarie","Burkina Faso","Burundi","Cambodge","Cameroun","Canada","Chili","Chine","Chypre","Colombie","Corée du Sud","Costa Rica","Côte d'Ivoire","Croatie","Cuba","Danemark","Égypte","Émirats arabes unis","Équateur","Espagne","Estonie","États-Unis","Éthiopie","Finlande","Gabon","Géorgie","Ghana","Grèce","Guatemala","Guinée","Honduras","Hongrie","Île Maurice","Inde","Indonésie","Irak","Iran","Irlande","Islande","Israël","Italie","Japon","Jordanie","Kazakhstan","Kenya","Koweït","Lettonie","Liban","Libye","Liechtenstein","Lituanie","Luxembourg","Macédoine du Nord","Madagascar","Malaisie","Mali","Malte","Maroc","Mauritanie","Mexique","Moldavie","Monaco","Mongolie","Monténégro","Mozambique","Namibie","Népal","Nicaragua","Niger","Nigeria","Norvège","Nouvelle-Zélande","Oman","Ouganda","Ouzbékistan","Pakistan","Panama","Paraguay","Pays-Bas","Pérou","Philippines","Pologne","Portugal","Qatar","République dominicaine","République tchèque","Roumanie","Royaume-Uni","Russie","Rwanda","Salvador","Sénégal","Serbie","Singapour","Slovaquie","Slovénie","Somalie","Soudan","Sri Lanka","Suède","Suisse","Syrie","Tadjikistan","Taïwan","Tanzanie","Tchad","Thaïlande","Togo","Tunisie","Turkménistan","Turquie","Ukraine","Uruguay","Venezuela","Vietnam","Yémen","Zambie","Zimbabwe","Autre"];
const FRUITS = ['Pomme', 'Poire', 'Kiwi', 'Agrumes', 'Pêche / nectarine', 'Abricot', 'Prune', 'Tomate', 'Avocat', 'Mangue', 'Autre'];
