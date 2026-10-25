const $ = s => document.querySelector(s);
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => '\u20B9' + Number(n).toLocaleString('en-IN');
const ART = { Standard: '\u{1F6CF}\uFE0F', Deluxe: '\u{1F305}', Suite: '\u{1F451}' };
let session = JSON.parse(localStorage.getItem('se_session') || 'null');
let flash = null, returnTo = null;
const role = () => session && session.user.role;

async function api(path, opt = {}) {
  const r = await fetch('/api' + path, {
    method: opt.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: 'Bearer ' + session.token } : {}) },
    body: opt.body ? JSON.stringify(opt.body) : undefined
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && session) { logout('Your session has expired. Please log in again.'); }
    throw d;
  }
  return d;
}
const msg = e => (e && e.error) || 'Something went wrong. Please try again.';
function toast(t) {
  const el = $('#toast'); el.textContent = t; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 3500);
}
function go(h) { if (location.hash === h) route(); else location.hash = h; }
function logout(text) {
  session = null; localStorage.removeItem('se_session');
  flash = { t: text || 'You have been logged out.', cls: '' }; go('#/login');
}
const fmtDate = d => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

function nav() {
  const cur = (location.hash.slice(1) || '/').split('?')[0];
  const link = (h, t, id) => `<a href="#${h}" id="${id}" class="${cur === h ? 'active' : ''}">${t}</a>`;
  let html = link('/', 'Home', 'nav-home') + link('/rooms', 'Rooms', 'nav-rooms');
  if (role() === 'customer') html += link('/bookings', 'My bookings', 'nav-bookings');
  if (role() === 'admin') html += link('/admin/rooms', 'Manage rooms', 'nav-admin-rooms') + link('/admin/posts', 'Manage posts', 'nav-admin-posts') + link('/admin/bookings', 'All bookings', 'nav-admin-bookings');
  if (session) html += `<span class="who" id="who">${esc(session.user.name)} (${role()})</span><button id="logout-btn" type="button">Log out</button>`;
  else html += link('/login', 'Log in', 'nav-login') + link('/register', 'Register', 'nav-register');
  $('#nav').innerHTML = html;
  if (session) $('#logout-btn').onclick = () => logout();
}

// ---------- shared pieces ----------
function searchForm(v) {
  return `<form id="search-form" class="searchbar" novalidate>
    <label>Check-in<input type="date" id="s-checkin" value="${esc(v.checkIn)}"></label>
    <label>Check-out<input type="date" id="s-checkout" value="${esc(v.checkOut)}"></label>
    <label>Guests<input type="number" id="s-guests" min="1" max="6" value="${esc(v.guests)}"></label>
    <button class="btn" type="submit" id="s-submit">Search rooms</button></form>`;
}
function bindSearch() {
  $('#search-form').onsubmit = e => {
    e.preventDefault();
    const p = new URLSearchParams({ checkIn: $('#s-checkin').value, checkOut: $('#s-checkout').value, guests: $('#s-guests').value });
    go('#/rooms?' + p);
  };
}
function takeFlash() {
  const f = flash; flash = null;
  return f ? `<div class="notice ${f.cls || ''}" id="flash" role="status">${esc(f.t)}</div>` : '';
}
function fieldErr(box, e, map) {
  box.textContent = msg(e);
  if (e && e.field && map && map[e.field]) map[e.field].focus();
}

// ---------- public pages ----------
async function home() {
  app.innerHTML = `<section class="hero"><h1>Stay somewhere that feels like arriving</h1>
    <p>Six rooms, one courtyard garden and a front desk that never closes. Pick your dates and book direct.</p>
    ${searchForm({ checkIn: '', checkOut: '', guests: '2' })}</section>
    <h2 class="section">News from the hotel</h2><div class="posts" id="posts"></div>`;
  bindSearch();
  try {
    const posts = await api('/posts');
    $('#posts').innerHTML = posts.length ? posts.map(p => `<article class="post"><h3>${esc(p.title)}</h3><p>${esc(p.body)}</p><small>${fmtDate(p.created_at.slice(0, 10))}</small></article>`).join('')
      : '<p class="empty">No news yet. Check back soon.</p>';
  } catch (e) { $('#posts').innerHTML = `<p class="err">${esc(msg(e))}</p>`; }
}

async function rooms(q) {
  const v = { checkIn: q.get('checkIn') || '', checkOut: q.get('checkOut') || '', guests: q.get('guests') || '2' };
  app.innerHTML = `<div class="page"><h1 class="page-title">Find your room</h1>${searchForm(v)}
    <div id="search-error" class="err" role="alert"></div>
    <div class="filters"><label>Sort by<select id="sort"><option value="asc">Price, low to high</option><option value="desc">Price, high to low</option></select></label>
    <label>Max price per night<input id="max-price" type="number" min="0" placeholder="Any price"></label></div>
    <div id="room-grid" class="grid"></div></div>`;
  bindSearch();
  let list = [], dated = !!(v.checkIn || v.checkOut);
  try { list = await api('/rooms' + (dated ? '?' + q : '')); }
  catch (e) {
    $('#search-error').textContent = msg(e); dated = false;
    try { list = await api('/rooms'); } catch (_) { /* ignore */ }
  }
  const action = r => {
    if (r.status !== 'available') return '<span class="badge">Under maintenance</span>';
    if (!dated) return '<span class="hint">Choose dates to check availability.</span>';
    if (!r.available) return `<span class="badge">${esc(r.reason)}</span>`;
    return role() === 'admin' ? '' : `<button class="btn book-btn" data-id="${r.id}" type="button">Book now</button>`;
  };
  const draw = () => {
    const max = Number($('#max-price').value), dir = $('#sort').value;
    const shown = list.filter(r => !max || r.price <= max).sort((a, b) => dir === 'asc' ? a.price - b.price : b.price - a.price);
    $('#room-grid').innerHTML = shown.length ? shown.map(r => `<article class="room ${esc(r.type.toLowerCase())}" data-id="${r.id}">
      <div class="room-art">${ART[r.type] || ''}</div><div class="room-body"><span class="tag">${esc(r.type)}</span>
      <h3>${esc(r.name)}</h3><p>${esc(r.description)}</p><div>Up to ${r.capacity} guests</div>
      <div class="price"><strong>${inr(r.price)}</strong> per night</div>
      ${dated ? `<div class="total">${r.nights} night${r.nights > 1 ? 's' : ''}, total <strong>${inr(r.total)}</strong></div>` : ''}
      ${action(r)}</div></article>`).join('') : '<p class="empty">No rooms match your filters. Try a higher price limit.</p>';
  };
  $('#sort').onchange = draw; $('#max-price').oninput = draw; draw();
  $('#room-grid').onclick = e => {
    const b = e.target.closest('.book-btn'); if (!b) return;
    if (!session) { returnTo = location.hash; flash = { t: 'Please log in to book a room.', cls: 'warn' }; return go('#/login'); }
    bookModal(list.find(r => r.id == b.dataset.id), v);
  };
}

function bookModal(r, v) {
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="modal-card" role="dialog" aria-label="Confirm booking"><h2>Confirm your stay</h2><dl>
    <dt>Room</dt><dd>${esc(r.name)}</dd><dt>Check-in</dt><dd>${fmtDate(v.checkIn)}</dd><dt>Check-out</dt><dd>${fmtDate(v.checkOut)}</dd>
    <dt>Guests</dt><dd>${esc(v.guests)}</dd><dt>Price</dt><dd>${r.nights} x ${inr(r.price)}</dd>
    <dt class="grand">Total</dt><dd class="grand" id="modal-total">${inr(r.total)}</dd></dl>
    <div class="err" id="booking-error" role="alert"></div>
    <div class="actions"><button class="btn ghost" id="cancel-modal" type="button">Close</button><button class="btn" id="confirm-booking" type="button">Confirm booking</button></div></div>`;
  document.body.append(m);
  m.querySelector('#cancel-modal').onclick = () => m.remove();
  m.querySelector('#confirm-booking').onclick = async () => {
    try {
      const b = await api('/bookings', { method: 'POST', body: { roomId: r.id, checkIn: v.checkIn, checkOut: v.checkOut, guests: Number(v.guests) } });
      m.querySelector('.modal-card').innerHTML = `<h2>Booking confirmed</h2><p>Your booking ID is</p><div class="ref" id="booking-ref">${esc(b.ref)}</div>
        <p>${esc(b.room_name)}, ${fmtDate(b.check_in)} to ${fmtDate(b.check_out)}. Total ${inr(b.total)}.</p>
        <div class="actions"><a class="btn" href="#/bookings" id="view-bookings">View my bookings</a></div>`;
      m.querySelector('#view-bookings').onclick = () => m.remove();
    } catch (e) { m.querySelector('#booking-error').textContent = msg(e); }
  };
}

function authPage(kind) {
  const reg = kind === 'register';
  app.innerHTML = `<section class="panel form-card"><h1>${reg ? 'Create your account' : 'Welcome back'}</h1>${takeFlash()}
    <form id="auth-form" novalidate>
    ${reg ? '<div class="field"><label for="a-name">Full name</label><input id="a-name" autocomplete="off"></div>' : ''}
    <div class="field"><label for="a-email">Email</label><input id="a-email" type="email" autocomplete="off"></div>
    <div class="field"><label for="a-password">Password</label><input id="a-password" type="password" autocomplete="off"></div>
    ${reg ? '<div class="field"><label for="a-confirm">Confirm password</label><input id="a-confirm" type="password" autocomplete="off"></div>' : ''}
    <div class="err" id="auth-error" role="alert"></div>
    <button class="btn" type="submit" id="auth-submit">${reg ? 'Register' : 'Log in'}</button></form>
    <p>${reg ? 'Already registered? <a href="#/login">Log in</a>' : 'New here? <a href="#/register">Create an account</a>'}</p></section>`;
  $('#auth-form').onsubmit = async ev => {
    ev.preventDefault();
    const body = { email: $('#a-email').value, password: $('#a-password').value };
    if (reg) { body.name = $('#a-name').value; body.confirm = $('#a-confirm').value; }
    try {
      const d = await api(reg ? '/auth/register' : '/auth/login', { method: 'POST', body });
      if (reg) { flash = { t: d.message }; return go('#/login'); }
      session = d; localStorage.setItem('se_session', JSON.stringify(d));
      const dest = returnTo || (d.user.role === 'admin' ? '#/admin/rooms' : '#/'); returnTo = null; go(dest);
    } catch (e) { $('#auth-error').textContent = msg(e); }
  };
}

// ---------- customer ----------
async function myBookings() {
  app.innerHTML = '<h1 class="page-title">My bookings</h1><div id="list"></div>';
  const load = async () => {
    try {
      const rows = await api('/bookings/mine');
      $('#list').innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Booking ID</th><th>Room</th><th>Check-in</th><th>Check-out</th><th>Guests</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>
        ${rows.map(b => `<tr data-id="${b.id}"><td>${esc(b.ref)}</td><td>${esc(b.room_name)}</td><td>${fmtDate(b.check_in)}</td><td>${fmtDate(b.check_out)}</td><td>${b.guests}</td><td>${inr(b.total)}</td>
        <td><span class="status ${b.status}">${b.status}</span></td><td>${b.status === 'confirmed' ? `<button class="btn danger cancel-btn" data-id="${b.id}" type="button">Cancel booking</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="panel empty" id="no-bookings">No bookings yet. Find a room and plan your stay.<br><br><a class="btn" href="#/rooms">Browse rooms</a></div>';
    } catch (e) { $('#list').innerHTML = `<p class="err">${esc(msg(e))}</p>`; }
  };
  $('#list').onclick = async e => {
    const b = e.target.closest('.cancel-btn'); if (!b) return;
    try { await api('/bookings/' + b.dataset.id, { method: 'DELETE' }); toast('Booking cancelled.'); load(); }
    catch (er) { toast(msg(er)); }
  };
  load();
}

// ---------- admin ----------
async function adminRooms() {
  let editing = null, list = [];
  app.innerHTML = `<h1 class="page-title">Manage rooms</h1><section class="panel"><h2 id="room-form-title">Add a room</h2>
    <form id="room-form" novalidate><div class="row">
    <div class="field"><label for="r-name">Room name</label><input id="r-name"></div>
    <div class="field"><label for="r-type">Type</label><select id="r-type"><option value="">Select type</option><option>Standard</option><option>Deluxe</option><option>Suite</option></select></div>
    <div class="field"><label for="r-price">Price per night</label><input id="r-price" type="number"></div>
    <div class="field"><label for="r-capacity">Capacity</label><input id="r-capacity" type="number"></div>
    <div class="field"><label for="r-status">Status</label><select id="r-status"><option value="available">Available</option><option value="maintenance">Under maintenance</option></select></div></div>
    <div class="field"><label for="r-desc">Description</label><textarea id="r-desc"></textarea></div>
    <div class="err" id="room-error" role="alert"></div>
    <div class="actions"><button class="btn" id="room-save" type="submit">Save room</button><button class="btn ghost" id="room-reset" type="button">Clear form</button></div></form></section>
    <div id="room-list"></div>`;
  const F = { name: $('#r-name'), type: $('#r-type'), price: $('#r-price'), capacity: $('#r-capacity'), status: $('#r-status'), description: $('#r-desc') };
  const reset = () => { editing = null; Object.values(F).forEach(f => f.value = ''); F.status.value = 'available'; $('#room-form-title').textContent = 'Add a room'; $('#room-error').textContent = ''; };
  const load = async () => {
    list = await api('/rooms');
    $('#room-list').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th>Price per night</th><th>Capacity</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map(r => `<tr data-id="${r.id}"><td>${esc(r.name)}</td><td>${esc(r.type)}</td><td>${inr(r.price)}</td><td>${r.capacity}</td><td><span class="status ${r.status}">${r.status}</span></td>
      <td><button class="btn ghost small edit-room" data-id="${r.id}" type="button">Edit</button> <button class="btn danger delete-room" data-id="${r.id}" type="button">Delete</button></td></tr>`).join('')}</tbody></table></div>`;
  };
  $('#room-form').onsubmit = async ev => {
    ev.preventDefault();
    const body = Object.fromEntries(Object.entries(F).map(([k, f]) => [k, f.value]));
    try {
      await api(editing ? '/rooms/' + editing : '/rooms', { method: editing ? 'PUT' : 'POST', body });
      toast(editing ? 'Room updated.' : 'Room added.'); reset(); load();
    } catch (e) { fieldErr($('#room-error'), e, F); }
  };
  $('#room-reset').onclick = reset;
  $('#room-list').onclick = async e => {
    const ed = e.target.closest('.edit-room'), del = e.target.closest('.delete-room');
    if (ed) {
      const r = list.find(x => x.id == ed.dataset.id); editing = r.id;
      F.name.value = r.name; F.type.value = r.type; F.price.value = r.price; F.capacity.value = r.capacity; F.status.value = r.status; F.description.value = r.description;
      $('#room-form-title').textContent = 'Edit room'; $('#room-error').textContent = ''; window.scrollTo(0, 0);
    }
    if (del) { try { await api('/rooms/' + del.dataset.id, { method: 'DELETE' }); toast('Room deleted.'); load(); } catch (er) { toast(msg(er)); } }
  };
  load();
}

async function adminPosts() {
  let editing = null, list = [];
  app.innerHTML = `<h1 class="page-title">Manage posts</h1><section class="panel"><h2 id="post-form-title">New post</h2><form id="post-form" novalidate>
    <div class="field"><label for="p-title">Title</label><input id="p-title"></div>
    <div class="field"><label for="p-body">Content</label><textarea id="p-body"></textarea></div>
    <div class="err" id="post-error" role="alert"></div>
    <div class="actions"><button class="btn" id="post-save" type="submit">Publish post</button><button class="btn ghost" id="post-reset" type="button">Clear form</button></div></form></section><div id="post-list" class="posts"></div>`;
  const reset = () => { editing = null; $('#p-title').value = ''; $('#p-body').value = ''; $('#post-form-title').textContent = 'New post'; $('#post-error').textContent = ''; };
  const load = async () => {
    list = await api('/posts');
    $('#post-list').innerHTML = list.length ? list.map(p => `<article class="post" data-id="${p.id}"><h3>${esc(p.title)}</h3><p>${esc(p.body)}</p>
      <div class="actions"><button class="btn ghost small edit-post" data-id="${p.id}" type="button">Edit</button><button class="btn danger delete-post" data-id="${p.id}" type="button">Delete</button></div></article>`).join('')
      : '<p class="empty">No posts yet. Write the first one above.</p>';
  };
  $('#post-form').onsubmit = async ev => {
    ev.preventDefault();
    try {
      await api(editing ? '/posts/' + editing : '/posts', { method: editing ? 'PUT' : 'POST', body: { title: $('#p-title').value, body: $('#p-body').value } });
      toast(editing ? 'Post updated.' : 'Post published.'); reset(); load();
    } catch (e) { $('#post-error').textContent = msg(e); }
  };
  $('#post-reset').onclick = reset;
  $('#post-list').onclick = async e => {
    const ed = e.target.closest('.edit-post'), del = e.target.closest('.delete-post');
    if (ed) { const p = list.find(x => x.id == ed.dataset.id); editing = p.id; $('#p-title').value = p.title; $('#p-body').value = p.body; $('#post-form-title').textContent = 'Edit post'; window.scrollTo(0, 0); }
    if (del) { try { await api('/posts/' + del.dataset.id, { method: 'DELETE' }); toast('Post deleted.'); load(); } catch (er) { toast(msg(er)); } }
  };
  load();
}

async function adminBookings() {
  app.innerHTML = '<h1 class="page-title">All bookings</h1><div id="list"></div>';
  const load = async () => {
    try {
      const rows = await api('/bookings');
      $('#list').innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Booking ID</th><th>Customer</th><th>Room</th><th>Check-in</th><th>Check-out</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>
        ${rows.map(b => `<tr data-id="${b.id}"><td>${esc(b.ref)}</td><td>${esc(b.customer)}<br><small>${esc(b.customer_email)}</small></td><td>${esc(b.room_name)}</td><td>${fmtDate(b.check_in)}</td><td>${fmtDate(b.check_out)}</td><td>${inr(b.total)}</td>
        <td><span class="status ${b.status}">${b.status}</span></td><td>${b.status === 'confirmed' ? `<button class="btn danger cancel-btn" data-id="${b.id}" type="button">Cancel booking</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="panel empty">No bookings have been made yet.</div>';
    } catch (e) { $('#list').innerHTML = `<p class="err">${esc(msg(e))}</p>`; }
  };
  $('#list').onclick = async e => {
    const b = e.target.closest('.cancel-btn'); if (!b) return;
    try { await api('/bookings/' + b.dataset.id, { method: 'DELETE' }); toast('Booking cancelled.'); load(); } catch (er) { toast(msg(er)); }
  };
  load();
}

// ---------- router ----------
const routes = { '/': home, '/rooms': rooms, '/login': () => authPage('login'), '/register': () => authPage('register'), '/bookings': myBookings, '/admin/rooms': adminRooms, '/admin/posts': adminPosts, '/admin/bookings': adminBookings };
function route() {
  const [p, q = ''] = (location.hash.slice(1) || '/').split('?');
  const needAdmin = p.startsWith('/admin'), needCustomer = p === '/bookings';
  if ((needAdmin && role() !== 'admin') || (needCustomer && role() !== 'customer')) {
    if (!session) { flash = { t: 'Please log in to continue.', cls: 'warn' }; return go('#/login'); }
    toast('You do not have permission to view this page.'); return go('#/');
  }
  document.querySelectorAll('.modal').forEach(m => m.remove());
  nav(); window.scrollTo(0, 0);
  (routes[p] || home)(new URLSearchParams(q));
}
window.addEventListener('hashchange', route);
route();
