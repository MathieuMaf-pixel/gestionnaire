/* ============================================================
   Gestionnaire MAF — interface ADMIN
   Vues : Comptes & rôles · Toutes les demandes · Boîte mail (test)
   ============================================================ */
'use strict';

const S = { vue: 'users', users: [], demandes: [], openId: null, filtre: '' };

async function reload() {
  [S.users, S.demandes] = await Promise.all([GET('/api/users'), GET('/api/demandes')]);
  if (!S.openId) render();
}
G.onTick = reload;
function setVue(v) { S.vue = v; S.openId = null; setActiveTab(v); render(); }

function render() {
  const app = $('#app');
  if (S.vue === 'users') return renderUsers(app);
  if (S.vue === 'mails') return renderMails(app);
  const rows = filtrer(S.demandes, S.filtre);
  app.innerHTML = `<div class="kicker">Administration</div><h2 class="page">Toutes les demandes</h2><p class="lead">Vue complète, tous rôles confondus.</p>
    <div class="row between mb"><input class="search" id="q" placeholder="Rechercher…" value="${esc(S.filtre)}"></div>
    ${tableDemandes(rows, [COL.num, COL.client, COL.titre, COL.com, COL.impl, COL.statut, COL.indice, COL.maj],
      ['N°', 'Client', 'Projet', 'Commercial', 'Implanteur', 'Statut', 'Indice', 'Mise à jour'], ouvrirDemande)}`;
  $('#q').oninput = e => { S.filtre = e.target.value; render(); $('#q').focus(); $('#q').setSelectionRange(1e4, 1e4); };
}

function renderUsers(app) {
  app.innerHTML = `<div class="kicker">Administration</div><h2 class="page">Comptes & rôles</h2>
    <p class="lead">Chaque compte a un rôle unique : <b>Commercial</b> (ses clients, ses demandes), <b>Implantation</b> (plans), <b>Direction technique</b> (validation), <b>Administrateur</b>. L'adresse e-mail sert aux notifications.</p>
    <div class="row between mb"><span></span><button class="btn" id="btnNewU">＋ Nouveau compte</button></div>
    <table class="grid"><thead><tr><th>Identifiant</th><th>Nom affiché</th><th>Rôle</th><th>E-mail</th><th>Actif</th><th></th></tr></thead><tbody>
      ${S.users.map(u => `<tr style="cursor:default"><td class="mono">${esc(u.username)}</td><td><b>${esc(u.display_name)}</b></td>
        <td><span class="badge ${{ com: 'green', impl: 'blue', dt: 'orange', admin: 'black' }[u.role]}">${esc(G.cfg.roles[u.role])}</span></td>
        <td>${esc(u.email) || '<span class="muted">—</span>'}</td><td class="c">${u.actif ? '✓' : '<span class="badge red">désactivé</span>'}</td>
        <td class="c"><button class="btn grey sm" data-u="${u.username}">Modifier</button></td></tr>`).join('')}
    </tbody></table>`;
  $('#btnNewU').onclick = () => editerUser(null);
  $$('[data-u]').forEach(b => b.onclick = () => editerUser(S.users.find(u => u.username === b.dataset.u)));
}

function editerUser(u) {
  const roles = Object.entries(G.cfg.roles).map(([k, v]) => `<option value="${k}" ${u?.role === k ? 'selected' : ''}>${esc(v)}</option>`).join('');
  modal({
    title: u ? 'Modifier ' + u.username : 'Nouveau compte',
    body: `${u ? '' : `<div class="field"><label>Identifiant <span class="req">*</span></label><input id="uName" placeholder="ex : jdupont"></div>`}
      <div class="field"><label>Nom affiché</label><input id="uDisp" value="${esc(u?.display_name || '')}"></div>
      <div class="field"><label>Rôle</label><select id="uRole">${roles}</select></div>
      <div class="field"><label>E-mail</label><input id="uMail" type="email" value="${esc(u?.email || '')}"></div>
      <div class="field"><label>${u ? 'Nouveau mot de passe (laisser vide pour conserver)' : 'Mot de passe <span class="req">*</span>'}</label><input id="uPw" type="password"></div>
      ${u ? `<label class="check"><input type="checkbox" id="uActif" ${u.actif ? 'checked' : ''}> Compte actif</label>` : ''}`,
    okLabel: u ? 'Enregistrer' : 'Créer',
    onOk: async () => {
      const body = { display_name: $('#uDisp').value, role: $('#uRole').value, email: $('#uMail').value, password: $('#uPw').value };
      if (u) { body.actif = $('#uActif').checked; await PUT('/api/users/' + u.username, body, 'Compte modifié ✓'); }
      else { body.username = $('#uName').value; await POST('/api/users', body, 'Compte créé ✓'); }
      await reload();
    }
  });
}

async function renderMails(app) {
  const mails = await GET('/api/mails');
  app.innerHTML = `<div class="kicker">Test</div><h2 class="page">Boîte mail factice</h2>
    <p class="lead">Mode <code>MAIL_MODE=${esc(G.cfg.mail_mode)}</code> — les mails sont écrits dans <code>data/mails/</code>.</p>
    ${mails.length ? mails.map(m => `<div class="panel" style="margin-top:10px"><div class="mono muted">${esc(m.fichier)}</div><pre style="white-space:pre-wrap;font-family:var(--font);margin:8px 0 0">${esc(m.contenu)}</pre></div>`).join('') : '<div class="empty">Aucun mail.</div>'}`;
}

async function ouvrirDemande(id) {
  const d = await GET('/api/demandes/' + id);
  S.openId = id;
  renderDemandeDetail(d, { onBack: () => { S.openId = null; render(); }, onRefresh: () => ouvrirDemande(id), cdcEditable: d.statut === 'brouillon', actionsHtml: () => '' });
}

(async () => {
  if (!await bootCommon(['admin'])) return;
  renderHeader({
    title: 'Gestionnaire · Administration', subtitle: 'Comptes, rôles et supervision',
    tabs: [{ id: 'users', label: 'Comptes & rôles', on: true }, { id: 'demandes', label: 'Toutes les demandes' }, { id: 'mails', label: '✉ Boîte mail (test)' }],
    onTab: setVue
  });
  await reload();
  const d = new URLSearchParams(location.search).get('d');
  if (d) { history.replaceState(null, '', location.pathname); ouvrirDemande(d); }
})();
