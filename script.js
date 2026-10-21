'use strict';
/* Админ-ИС: всё хранится в localStorage браузера (ключ ais_db). Сервера нет. */
const KEY = 'ais_db', SES = 'ais_user';
const RES = ['users', 'roles', 'employees', 'documents', 'tasks', 'reports', 'settings'];
const PERMS = ['*', ...RES.flatMap(r => [r + ':read', r + ':write'])];
const ST = { todo: 'К выполнению', in_progress: 'В работе', done: 'Выполнено', draft: 'Черновик', review: 'На проверке', approved: 'Утверждён' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const $ = s => document.querySelector(s);

async function hash(pw, salt) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + pw));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
let db, me = null, page = 'reports', modal = null, filter = '', menuOpen = false, flash = null, found = null, fails = 0, lockUntil = 0;
const save = () => localStorage.setItem(KEY, JSON.stringify(db));

async function init() {
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
  if (!db) {
    const salt = uid();
    db = {
      roles: [
        { id: 'admin', name: 'Администратор', perms: ['*'] },
        { id: 'manager', name: 'Руководитель', perms: ['employees:read', 'employees:write', 'documents:read', 'documents:write', 'tasks:read', 'tasks:write', 'reports:read', 'users:read'] },
        { id: 'employee', name: 'Сотрудник', perms: ['employees:read', 'documents:read', 'tasks:read', 'tasks:write'] }],
      users: [{ id: 'u1', name: 'Администратор', email: 'admin@example.com', roleId: 'admin', active: true, salt, hash: await hash('Admin123!', salt) }],
      employees: [], documents: [], tasks: [], settings: { company: 'Моя компания' }
    };
    save();
  }
  const sid = sessionStorage.getItem(SES);
  me = db.users.find(u => u.id === sid && u.active) || null;
  render();
}

const can = p => { const r = me && db.roles.find(r => r.id === me.roleId); return !!r && (r.perms.includes('*') || r.perms.includes(p)); };
const opts = a => a.map(([v, l]) => ({ v, l }));
const stOpts = k => opts(k.map(x => [x, ST[x]]));
const userOpts = () => opts(db.users.map(u => [u.id, u.name]));
const ENT = {
  employees: { t: 'Сотрудники', f: [{ k: 'fullName', l: 'ФИО', req: 1 }, { k: 'position', l: 'Должность' }, { k: 'department', l: 'Отдел' }, { k: 'email', l: 'Email', type: 'email' }, { k: 'phone', l: 'Телефон' }] },
  documents: { t: 'Документы', f: [{ k: 'title', l: 'Название', req: 1 }, { k: 'description', l: 'Описание', type: 'textarea', hide: 1 }, { k: 'status', l: 'Статус', type: 'select', o: () => stOpts(['draft', 'review', 'approved']), def: 'draft' }, { k: 'ownerId', l: 'Автор', type: 'select', o: userOpts, noform: 1 }] },
  tasks: { t: 'Задачи', f: [{ k: 'title', l: 'Задача', req: 1 }, { k: 'description', l: 'Описание', type: 'textarea', hide: 1 }, { k: 'status', l: 'Статус', type: 'select', o: () => stOpts(['todo', 'in_progress', 'done']), def: 'todo' }, { k: 'assigneeId', l: 'Исполнитель', type: 'select', o: userOpts }, { k: 'due', l: 'Срок', type: 'date' }] },
  users: { t: 'Пользователи', f: [{ k: 'name', l: 'Имя', req: 1 }, { k: 'email', l: 'Email', type: 'email', req: 1 }, { k: 'roleId', l: 'Роль', type: 'select', o: () => opts(db.roles.map(r => [r.id, r.name])), req: 1 }, { k: 'password', l: 'Пароль (мин. 8 символов)', type: 'password', hide: 1 }, { k: 'active', l: 'Активен', type: 'bool' }] },
  roles: { t: 'Роли и права', f: [{ k: 'name', l: 'Название роли', req: 1 }, { k: 'perms', l: 'Права', type: 'perms' }] }
};
const show = (f, v) => f.type === 'select' ? esc((f.o().find(o => o.v === v) || {}).l || '—') : f.type === 'bool' ? (v ? '✓' : '—') : f.type === 'perms' ? `${(v || []).length} прав` : esc(v || '—');

/* ---------- Отрисовка ---------- */
function render() {
  const app = $('#app');
  if (!me) { app.innerHTML = loginView(); return; }
  const nav = [['reports', 'Отчёты', can('reports:read')], ['search', 'Поиск', 1], ['employees', 'Сотрудники', can('employees:read')], ['documents', 'Документы', can('documents:read')],
    ['tasks', 'Задачи', can('tasks:read')], ['users', 'Пользователи', can('users:read')], ['roles', 'Роли и права', can('roles:read')], ['settings', 'Настройки', 1]].filter(n => n[2]);
  if (!nav.some(n => n[0] === page)) page = nav[0][0];
  const body = page === 'reports' ? reportsView() : page === 'search' ? searchView() : page === 'settings' ? settingsView() : tableView(page);
  app.innerHTML = `<div class="layout"><nav class="side${menuOpen ? ' open' : ''}"><h2>${esc(db.settings.company)}</h2>
    ${nav.map(n => `<a data-act="nav" data-p="${n[0]}" class="${n[0] === page ? 'on' : ''}">${n[1]}</a>`).join('')}</nav>
    <div class="main"><div class="top"><button class="btn sec menu" data-act="menu" aria-label="Меню">☰</button><span>${esc(me.name)}</span><button class="btn sec" data-act="logout">Выйти</button></div>
    ${flash ? `<div class="page" style="padding-bottom:0"><div class="${flash.ok ? 'ok' : 'err'}">${esc(flash.m)}</div></div>` : ''}${body}</div></div>${modal ? modalView() : ''}`;
}
function loginView() {
  return `<div class="login"><form data-form="login"><h1>Вход в систему</h1><label>Email</label><input name="email" type="email" required autofocus>
  <label>Пароль</label><input name="password" type="password" required>${flash ? `<div class="err">${esc(flash.m)}</div>` : ''}
  <p><button class="btn" style="width:100%">Войти</button></p><p class="hint">Первый вход: admin@example.com / Admin123!</p></form></div>`;
}
function tableView(res) {
  const e = ENT[res], w = can(res + ':write'), cols = e.f.filter(f => !f.hide);
  const rows = db[res].filter(r => JSON.stringify(Object.values(r)).toLowerCase().includes(filter.toLowerCase()));
  return `<div class="page"><div class="row"><h1>${e.t}</h1><div class="row" style="margin:0"><input data-filter placeholder="Фильтр…" value="${esc(filter)}" style="width:180px">
    ${w ? '<button class="btn" data-act="add">+ Добавить</button>' : ''}</div></div>
    <div class="card tw"><table><thead><tr>${cols.map(f => `<th>${f.l}</th>`).join('')}${w ? '<th></th>' : ''}</tr></thead><tbody>
    ${rows.map(r => `<tr>${cols.map(f => `<td>${show(f, r[f.k])}</td>`).join('')}${w ? `<td><button class="btn sec sm" data-act="edit" data-id="${r.id}">Изменить</button> <button class="btn dg sm" data-act="del" data-id="${r.id}">Удалить</button></td>` : ''}</tr>`).join('')}
    </tbody></table>${rows.length ? '' : '<div class="empty">Записей нет. Нажмите «Добавить», чтобы создать первую.</div>'}</div></div>`;
}
function modalView() {
  const e = ENT[page], r = modal.rec;
  return `<div class="modal"><form data-form="rec"><h3>${modal.id ? 'Изменить запись' : 'Новая запись'}</h3>${e.f.filter(f => !f.noform).map(f => {
    const v = r[f.k];
    if (f.type === 'bool') return `<label class="chk"><input type="checkbox" name="${f.k}" ${v ? 'checked' : ''}>${f.l}</label>`;
    let inp;
    if (f.type === 'select') inp = `<select name="${f.k}" ${f.req ? 'required' : ''}><option value="">—</option>${f.o().map(o => `<option value="${esc(o.v)}" ${o.v === v ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select>`;
    else if (f.type === 'textarea') inp = `<textarea name="${f.k}" rows="3">${esc(v)}</textarea>`;
    else if (f.type === 'perms') inp = PERMS.map(p => `<label class="chk"><input type="checkbox" name="perms" value="${p}" ${(v || []).includes(p) ? 'checked' : ''}>${p === '*' ? 'Полный доступ (*)' : p}</label>`).join('');
    else inp = `<input name="${f.k}" type="${f.type || 'text'}" value="${f.type === 'password' ? '' : esc(v)}" ${f.type === 'password' ? 'minlength="8" autocomplete="new-password"' : ''} ${(f.req || (f.type === 'password' && !modal.id && page === 'users')) && !(f.type === 'password' && modal.id) ? 'required' : ''}>`;
    return `<label>${f.l}</label>${inp}`;
  }).join('')}${modal.err ? `<div class="err">${esc(modal.err)}</div>` : ''}
  <div class="row" style="margin:16px 0 0;justify-content:flex-end"><button type="button" class="btn sec" data-act="close">Отмена</button><button class="btn">Сохранить</button></div></form></div>`;
}
function reportsView() {
  const cnt = (a, k) => Object.entries(a.reduce((m, x) => (m[x[k] || '—'] = (m[x[k] || '—'] || 0) + 1, m), {}));
  const bars = (t, a) => `<div class="card"><b>${t}</b>${a.map(([k, n]) => `<div class="bar"><span>${esc(ST[k] || k)}</span><i style="width:${Math.min(n * 30, 320)}px"></i><span>${n}</span></div>`).join('') || '<div class="hint">Нет данных</div>'}</div>`;
  const tot = { Пользователи: db.users.length, Сотрудники: db.employees.length, Документы: db.documents.length, Задачи: db.tasks.length };
  return `<div class="page"><div class="row"><h1>Отчёты</h1>${can('tasks:read') ? '<button class="btn" data-act="csv">Экспорт задач в CSV</button>' : ''}</div>
  <div class="grid">${Object.entries(tot).map(([k, n]) => `<div class="card"><b>${n}</b><span>${k}</span></div>`).join('')}</div>
  ${bars('Задачи по статусам', cnt(db.tasks, 'status'))}${bars('Документы по статусам', cnt(db.documents, 'status'))}${bars('Сотрудники по отделам', cnt(db.employees, 'department'))}</div>`;
}
function searchView() {
  const L = { employees: 'Сотрудники', documents: 'Документы', tasks: 'Задачи' };
  const res = found ? Object.entries(found.res).filter(([, a]) => a.length) : [];
  return `<div class="page"><div class="row"><h1>Поиск</h1></div><form data-form="search" class="row"><input name="q" style="flex:1" placeholder="Минимум 2 символа…" value="${esc(found?.q)}"><button class="btn">Найти</button></form>
  ${found && !res.length ? '<div class="card">Ничего не найдено. Попробуйте другое слово.</div>' : ''}
  ${res.map(([k, a]) => `<div class="card"><b>${L[k]}</b>${a.map(x => `<div style="padding:6px 0">${esc(x.fullName || x.title)} <span class="tag">${esc(ST[x.status] || x.position || x.department || '—')}</span></div>`).join('')}</div>`).join('')}</div>`;
}
function settingsView() {
  return `<div class="page"><div class="row"><h1>Настройки</h1></div>
  ${can('settings:write') ? `<form class="card" data-form="company"><b>Организация</b><label>Название</label><input name="company" required maxlength="100" value="${esc(db.settings.company)}"><p><button class="btn">Сохранить</button></p></form>` : ''}
  <form class="card" data-form="password"><b>Смена пароля</b><label>Текущий пароль</label><input name="cur" type="password" required><label>Новый пароль (мин. 8 символов)</label><input name="nw" type="password" minlength="8" required><p><button class="btn">Изменить пароль</button></p></form>
  ${can('settings:write') ? `<div class="card"><b>Резервная копия данных</b><p class="hint">Данные хранятся только в этом браузере. Сохраняйте копию регулярно.</p>
  <button class="btn" data-act="export">Скачать копию (JSON)</button> <button class="btn sec" data-act="import">Загрузить копию</button><input type="file" id="imp" accept=".json" hidden></div>` : ''}</div>`;
}

/* ---------- Действия ---------- */
const say = (m, ok) => { flash = { m, ok }; };
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const act = t.dataset.act, id = t.dataset.id, rec = () => db[page].find(r => r.id === id);
  flash = null;
  if (act === 'nav') { page = t.dataset.p; filter = ''; found = null; menuOpen = false; }
  else if (act === 'menu') menuOpen = !menuOpen;
  else if (act === 'logout') { sessionStorage.removeItem(SES); me = null; }
  else if (act === 'add' && can(page + ':write')) { const r = {}; ENT[page].f.forEach(f => { if (f.def) r[f.k] = f.def; if (f.type === 'bool') r[f.k] = true; }); modal = { id: null, rec: r }; }
  else if (act === 'edit' && can(page + ':write')) modal = { id, rec: { ...rec() } };
  else if (act === 'close') modal = null;
  else if (act === 'del' && can(page + ':write')) {
    if (!confirm('Удалить запись?')) return;
    if (page === 'users' && id === me.id) say('Нельзя удалить свою учётную запись', 0);
    else if (page === 'roles' && db.users.some(u => u.roleId === id)) say('Роль назначена пользователям — сначала смените им роль', 0);
    else { db[page] = db[page].filter(r => r.id !== id); save(); }
  }
  else if (act === 'csv') {
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    download('tasks.csv', '\ufeff' + ['id,title,status,due', ...db.tasks.map(x => [x.id, x.title, ST[x.status], x.due].map(q).join(','))].join('\n'), 'text/csv');
  }
  else if (act === 'export' && can('settings:write')) download('admin-is-backup.json', JSON.stringify(db), 'application/json');
  else if (act === 'import' && can('settings:write')) { const f = $('#imp'); f.onchange = importFile; f.click(); return; }
  render();
});
document.addEventListener('input', e => { if (e.target.matches('[data-filter]')) { filter = e.target.value; const p = e.target.selectionStart; render(); const i = $('[data-filter]'); i.focus(); i.setSelectionRange(p, p); } });
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href); }
async function importFile(e) {
  try {
    const d = JSON.parse(await e.target.files[0].text());
    if (!['roles', 'users', 'employees', 'documents', 'tasks'].every(k => Array.isArray(d[k])) || !d.users.some(u => u.id === me.id)) throw 0;
    db = d; me = db.users.find(u => u.id === me.id); save(); say('Данные загружены', 1);
  } catch { say('Файл не подходит: нужна копия из этой системы, содержащая вашу учётную запись', 0); }
  render();
}

document.addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target, type = form.dataset.form, fd = new FormData(form); flash = null;
  if (type === 'login') {
    if (Date.now() < lockUntil) say(`Слишком много попыток. Подождите ${Math.ceil((lockUntil - Date.now()) / 1000)} с`, 0);
    else {
      const u = db.users.find(u => u.email.toLowerCase() === fd.get('email').toLowerCase() && u.active);
      if (u && await hash(fd.get('password'), u.salt) === u.hash) { me = u; fails = 0; sessionStorage.setItem(SES, u.id); page = 'reports'; }
      else { if (++fails >= 5) { lockUntil = Date.now() + 30000; fails = 0; } say('Неверный email или пароль', 0); }
    }
  } else if (type === 'rec' && can(page + ':write')) {
    const rec = { ...modal.rec };
    for (const f of ENT[page].f.filter(f => !f.noform && f.type !== 'password')) rec[f.k] = f.type === 'bool' ? fd.has(f.k) : f.type === 'perms' ? fd.getAll('perms') : (fd.get(f.k) || '').trim();
    if (page === 'users') {
      if (db.users.some(u => u.id !== modal.id && u.email.toLowerCase() === rec.email.toLowerCase())) modal.err = 'Пользователь с таким email уже есть';
      else if (modal.id === me.id && !rec.active) modal.err = 'Нельзя отключить свою учётную запись';
      else if (modal.id === me.id && !can('users:write')) modal.err = 'Нет прав';
      const pw = fd.get('password');
      if (!modal.err && pw) { rec.salt = uid(); rec.hash = await hash(pw, rec.salt); }
      else if (!modal.err && !modal.id) modal.err = 'Укажите пароль';
    }
    if (!modal.err) {
      if (modal.id) db[page] = db[page].map(r => r.id === modal.id ? { ...r, ...rec } : r);
      else { rec.id = uid(); if (page === 'documents') rec.ownerId = me.id; db[page].unshift(rec); }
      save(); modal = null;
      me = db.users.find(u => u.id === me.id);
    }
  } else if (type === 'search') {
    const q = fd.get('q').trim().toLowerCase(), res = {};
    if (q.length >= 2) {
      const m = (r, ks) => ks.some(k => String(r[k] || '').toLowerCase().includes(q));
      if (can('employees:read')) res.employees = db.employees.filter(r => m(r, ['fullName', 'position', 'department', 'email'])).slice(0, 20);
      if (can('documents:read')) res.documents = db.documents.filter(r => m(r, ['title', 'description'])).slice(0, 20);
      if (can('tasks:read')) res.tasks = db.tasks.filter(r => m(r, ['title', 'description'])).slice(0, 20);
    }
    found = { q: fd.get('q'), res };
  } else if (type === 'company' && can('settings:write')) { db.settings.company = fd.get('company').trim(); save(); say('Сохранено', 1); }
  else if (type === 'password') {
    if (await hash(fd.get('cur'), me.salt) !== me.hash) say('Текущий пароль неверен', 0);
    else { me.salt = uid(); me.hash = await hash(fd.get('nw'), me.salt); save(); say('Пароль изменён', 1); }
  }
  render();
});
init();
