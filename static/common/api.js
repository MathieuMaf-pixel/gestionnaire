/* ============================================================
   Gestionnaire MAF — utilitaires communs à toutes les interfaces
   (appel API, session, en-tête, notifications, toasts, modales)
   ============================================================ */
'use strict';

const G = {
  me: null,            // utilisateur connecté
  cfg: null,           // /api/config (statuts, rôles, types de CDC)
  notifs: [],
  onTick: null,        // callback de rafraîchissement périodique
  tickMs: 10000,
};

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nl2br = t => esc(t).replace(/\n/g, '<br>');

/* ---------- Appels API ---------- */
async function api(path, opts = {}) {
  const init = { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: {} };
  if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  let r;
  try { r = await fetch(path, init); }
  catch (e) { toast('Serveur injoignable — le serveur local est-il lancé ?', true); throw e; }
  if (r.status === 401) { location.href = '/login'; throw new Error('401'); }
  let j = null;
  try { j = await r.json(); } catch (e) { j = {}; }
  if (!r.ok) {
    if (!opts.silent) toast(j.error || ('Erreur ' + r.status), true);
    throw Object.assign(new Error(j.error || 'Erreur'), { status: r.status, body: j });
  }
  if (opts.ok) toast(opts.ok);
  return j;
}
const GET = (p) => api(p);
const POST = (p, body, ok) => api(p, { method: 'POST', body: body || {}, ok });
const PUT = (p, body, ok) => api(p, { method: 'PUT', body: body || {}, ok });

/* ---------- Formatage ---------- */
function fmtDT(iso) {           // 2026-09-04T13:05:22 → 04/09/2026 13:05
  if (!iso) return '—';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : iso;
}
function fmtD(iso) {
  if (!iso) return '—';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
const numero = d => 'D-' + String(d.numero).padStart(4, '0');
function badgeStatut(s) {
  const st = (G.cfg && G.cfg.statuts[s]) || { label: s, cls: 'grey' };
  return `<span class="badge ${st.cls}">${esc(st.label)}</span>`;
}
function badgePlan(s) {
  const m = { brouillon: ['grey', 'Brouillon'], a_valider: ['orange', 'En validation'], valide: ['green', 'Validé'], refuse: ['red', 'Refusé'] }[s] || ['grey', s];
  return `<span class="badge ${m[0]}">${m[1]}</span>`;
}
function ageJours(iso) {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? "aujourd'hui" : d === 1 ? 'hier' : `il y a ${d} j`;
}

/* ---------- Toast ---------- */
function toast(msg, err) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.toggle('err', !!err); t.classList.add('visible');
  clearTimeout(t._m); t._m = setTimeout(() => t.classList.remove('visible'), err ? 4200 : 2600);
}

/* ---------- Modale générique ----------
   modal({title, body(html), okLabel, okClass, onOk(async → return false pour garder ouvert)}) */
function modal(o) {
  closeModal();
  const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.id = 'modal';
  bg.innerHTML = `<div class="modal"><div class="mh">${esc(o.title)}</div><div class="mb">${o.body || ''}</div>
    <div class="mf"><button class="btn grey" id="mCancel">${esc(o.cancelLabel || 'Annuler')}</button>
    ${o.okLabel === null ? '' : `<button class="btn ${o.okClass || ''}" id="mOk">${esc(o.okLabel || 'Valider')}</button>`}</div></div>`;
  document.body.appendChild(bg);
  $('#mCancel').onclick = closeModal;
  bg.addEventListener('click', e => { if (e.target === bg) closeModal(); });
  const ok = $('#mOk');
  if (ok) ok.onclick = async () => {
    ok.disabled = true;
    try { const r = await o.onOk?.(); if (r !== false) closeModal(); }
    catch (e) { /* toast déjà affiché */ }
    finally { if ($('#mOk')) ok.disabled = false; }
  };
  const first = bg.querySelector('input,select,textarea'); if (first) setTimeout(() => first.focus(), 30);
  return bg;
}
function closeModal() { const m = $('#modal'); if (m) m.remove(); }
function confirmer(title, texte, onOk, okLabel, okClass) {
  return modal({ title, body: `<p>${texte}</p>`, okLabel: okLabel || 'Confirmer', okClass: okClass || '', onOk });
}

/* ---------- En-tête & navigation ---------- */
function renderHeader(o) {
  // o = {title, subtitle, tabs:[{id,label,count,countCls}], onTab(id)}
  const u = G.me;
  $('#hdr').innerHTML = `
  <header class="app"><div class="head-in">
    <img class="logo" src="/static/common/logo.png" alt="MAF RODA AGROBOTIC">
    <div class="titles"><h1>${esc(o.title)}</h1><p>${esc(o.subtitle || '')}</p></div>
    <div class="head-actions">
      <button class="bell" id="bell" title="Notifications">&#128276;<span class="n hidden" id="bellN"></span></button>
      <div class="head-user"><b>${esc(u.display_name)}</b>${esc(u.role_label)}</div>
      <button class="btn grey sm" id="btnPwd" title="Changer mon mot de passe">&#128273;</button>
      <button class="btn dark sm" id="btnOut">Déconnexion</button>
    </div>
  </div>
  ${o.tabs ? `<nav class="tabs"><div class="in">${o.tabs.map(t => `<button data-tab="${t.id}" class="${t.on ? 'on' : ''}">${esc(t.label)}${t.count ? `<span class="count ${t.countCls || ''}">${t.count}</span>` : ''}</button>`).join('')}</div></nav>` : ''}
  </header>`;
  $('#btnOut').onclick = async () => { await POST('/api/logout'); location.href = '/login'; };
  $('#btnPwd').onclick = changerMdp;
  $('#bell').onclick = toggleNotifs;
  $$('#hdr nav button').forEach(b => b.onclick = () => o.onTab?.(b.dataset.tab));
  majBell();
}
function setTabCount(id, n, cls) {
  const b = $(`#hdr nav button[data-tab="${id}"]`); if (!b) return;
  let c = b.querySelector('.count');
  if (!n) { if (c) c.remove(); return; }
  if (!c) { c = document.createElement('span'); c.className = 'count'; b.appendChild(c); }
  c.className = 'count ' + (cls || ''); c.textContent = n;
}
function setActiveTab(id) { $$('#hdr nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === id)); }

function changerMdp() {
  modal({
    title: 'Changer mon mot de passe',
    body: `<div class="field"><label>Ancien mot de passe</label><input type="password" id="pOld"></div>
           <div class="field"><label>Nouveau mot de passe</label><input type="password" id="pNew"></div>`,
    okLabel: 'Enregistrer',
    onOk: async () => { await POST('/api/change_password', { old: $('#pOld').value, new: $('#pNew').value }, 'Mot de passe modifié ✓'); }
  });
}

/* ---------- Notifications ---------- */
async function chargerNotifs() {
  try { G.notifs = await api('/api/notifications', { silent: true }); majBell(); } catch (e) { }
}
function majBell() {
  const n = G.notifs.filter(x => !x.lu).length, el = $('#bellN');
  if (!el) return;
  el.textContent = n; el.classList.toggle('hidden', !n);
}
function toggleNotifs() {
  const ex = $('#notifs'); if (ex) { ex.remove(); return; }
  const box = document.createElement('div'); box.id = 'notifs'; box.className = 'notifs';
  const unread = G.notifs.filter(x => !x.lu).map(x => x.id);
  box.innerHTML = `<div class="h">Notifications ${unread.length ? `<button class="btn ghost sm" id="nAll">Tout marquer lu</button>` : ''}</div>` +
    (G.notifs.length ? G.notifs.map(x => `<div class="it ${x.lu ? '' : 'unread'}" data-id="${x.id}" data-d="${x.demande_id || ''}">
      <div class="s">${esc(x.sujet)}</div><div class="d">${fmtDT(x.ts)}${x.numero ? ' · D-' + String(x.numero).padStart(4, '0') : ''}</div></div>`).join('')
      : '<div class="it muted">Aucune notification.</div>');
  document.body.appendChild(box);
  const nAll = $('#nAll'); if (nAll) nAll.onclick = async () => { await POST('/api/notifications/lu', { ids: unread }); await chargerNotifs(); box.remove(); };
  box.querySelectorAll('.it[data-id]').forEach(it => it.onclick = async () => {
    await POST('/api/notifications/lu', { ids: [+it.dataset.id] }); await chargerNotifs(); box.remove();
    if (it.dataset.d && window.ouvrirDemande) ouvrirDemande(it.dataset.d);
  });
  setTimeout(() => document.addEventListener('click', function h(e) { if (!box.contains(e.target) && e.target.id !== 'bell') { box.remove(); document.removeEventListener('click', h); } }), 0);
}

/* ---------- Pied de page ---------- */
function renderFooter() {
  $('#ftr').innerHTML = `<footer class="app"><div class="mention-propriete">Ce document est la propriété exclusive de <b>MAF AGROBOTIC</b> et reste strictement confidentiel. Toute utilisation non autorisée pourra faire l'objet de poursuites.</div></footer>`;
}

/* ---------- Démarrage commun ---------- */
async function bootCommon(allowedRoles) {
  try { G.me = await api('/api/me', { silent: true }); } catch (e) { location.href = '/login'; return false; }
  if (allowedRoles && !allowedRoles.includes(G.me.role) && G.me.role !== 'admin') { location.href = G.me.home; return false; }
  G.cfg = await GET('/api/config');
  G.tickMs = (G.cfg.poll_seconds || 10) * 1000;
  await chargerNotifs();
  renderFooter();
  setInterval(async () => {
    if (document.hidden) return;
    await chargerNotifs();
    if (G.onTick && !$('#modal')) { try { await G.onTick(); } catch (e) { } }
  }, G.tickMs);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && G.onTick && !$('#modal')) G.onTick(); });
  return true;
}
