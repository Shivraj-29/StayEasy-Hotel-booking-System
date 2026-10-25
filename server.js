const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'stayease-demo-secret';
const db = new DatabaseSync(process.env.DB_FILE || path.join(__dirname, 'stayease.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT, email TEXT UNIQUE, password TEXT, role TEXT);
CREATE TABLE IF NOT EXISTS rooms(id INTEGER PRIMARY KEY, name TEXT, type TEXT, price INTEGER, capacity INTEGER, description TEXT, status TEXT DEFAULT 'available');
CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY, title TEXT, body TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS bookings(id INTEGER PRIMARY KEY, ref TEXT, user_id INTEGER, room_id INTEGER, check_in TEXT, check_out TEXT,
  guests INTEGER, nights INTEGER, total INTEGER, status TEXT DEFAULT 'confirmed', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);

// ---- seed data (first run only) ----
if (!db.prepare('SELECT 1 FROM users').get()) {
  db.prepare('INSERT INTO users(name,email,password,role) VALUES (?,?,?,?)')
    .run('Hotel Admin', 'admin@stayease.com', bcrypt.hashSync('Admin@123', 8), 'admin');
  const addRoom = db.prepare('INSERT INTO rooms(name,type,price,capacity,description) VALUES (?,?,?,?,?)');
  [
    ['Garden Nook', 'Standard', 2500, 2, 'A quiet room that opens onto the courtyard garden.'],
    ['City Light', 'Standard', 2800, 3, 'Bright corner room with a city view and a work desk.'],
    ['Terrace Deluxe', 'Deluxe', 4200, 3, 'King bed, rain shower and a private terrace.'],
    ['Sunrise Deluxe', 'Deluxe', 4800, 4, 'East-facing room with a sitting area for slow mornings.'],
    ['Heritage Suite', 'Suite', 7500, 4, 'Bedroom and lounge, with a soaking tub.'],
    ['Skyline Penthouse', 'Suite', 11000, 6, 'Top-floor suite with views across the whole city.']
  ].forEach(r => addRoom.run(...r));
  const addPost = db.prepare('INSERT INTO posts(title,body) VALUES (?,?)');
  addPost.run('Welcome to StayEase', 'Book direct and enjoy the best rate we offer. Our front desk is open around the clock.');
  addPost.run('Breakfast on the terrace', 'Fresh breakfast is served on the terrace every day from 7 to 10 am, free for all guests.');
  addPost.run('Rooftop cafe now open', 'Coffee, light bites and sunset views from the roof, open daily from 4 pm.');
}

// ---- helpers ----
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const bad = (res, error, code = 400, field) => res.status(code).json({ error, field });
const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s));
const nightsBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const taken = (roomId, ci, co) => !!db.prepare(
  "SELECT 1 FROM bookings WHERE room_id=? AND status='confirmed' AND check_in<? AND check_out>?").get(roomId, co, ci);

function dateErr(ci, co, guests) {
  if (!isDate(ci) || !isDate(co)) return 'Please select check-in and check-out dates.';
  if (ci < today()) return 'Check-in date cannot be in the past.';
  if (co <= ci) return 'Check-out date must be after check-in date.';
  const g = Number(guests);
  if (!Number.isInteger(g) || g < 1 || g > 6) return 'Guests must be between 1 and 6.';
}

const auth = role => (req, res, next) => {
  try { req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), SECRET); }
  catch (e) { return bad(res, 'Please log in to continue.', 401); }
  if (role && req.user.role !== role) return bad(res, 'You do not have permission to do this.', 403);
  next();
};

// ---- auth ----
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
app.post('/api/auth/register', (req, res) => {
  const { name = '', email = '', password = '', confirm = '' } = req.body;
  const n = String(name).trim(), em = String(email).trim().toLowerCase();
  if (!n) return bad(res, 'Full name is required.', 400, 'name');
  if (n.length < 2) return bad(res, 'Full name must be at least 2 characters.', 400, 'name');
  if (!em) return bad(res, 'Email is required.', 400, 'email');
  if (!EMAIL_RE.test(em)) return bad(res, 'Please enter a valid email address.', 400, 'email');
  if (!password) return bad(res, 'Password is required.', 400, 'password');
  if (!/^(?=.*[A-Z])(?=.*\d).{8,}$/.test(password))
    return bad(res, 'Password must be at least 8 characters and include an uppercase letter and a number.', 400, 'password');
  if (!confirm) return bad(res, 'Please confirm your password.', 400, 'confirm');
  if (password !== confirm) return bad(res, 'Passwords do not match.', 400, 'confirm');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(em))
    return bad(res, 'An account with this email already exists.', 409, 'email');
  db.prepare('INSERT INTO users(name,email,password,role) VALUES (?,?,?,?)').run(n, em, bcrypt.hashSync(password, 8), 'customer');
  res.status(201).json({ message: 'Registration successful. Please log in.' });
});

app.post('/api/auth/login', (req, res) => {
  const em = String(req.body.email || '').trim().toLowerCase(), pw = String(req.body.password || '');
  if (!em || !pw) return bad(res, 'Email and password are required.');
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(em);
  if (!u || !bcrypt.compareSync(pw, u.password)) return bad(res, 'Invalid email or password.', 401);
  const user = { id: u.id, name: u.name, email: u.email, role: u.role };
  res.json({ token: jwt.sign(user, SECRET, { expiresIn: '8h' }), user });
});

// ---- rooms ----
const ROOM_TYPES = ['Standard', 'Deluxe', 'Suite'];
function roomErr(b) {
  if (!b.name || !String(b.name).trim()) return ['name', 'Room name is required.'];
  if (!ROOM_TYPES.includes(b.type)) return ['type', 'Room type must be Standard, Deluxe or Suite.'];
  if (!Number.isInteger(Number(b.price)) || Number(b.price) <= 0) return ['price', 'Price per night must be a positive whole number.'];
  const c = Number(b.capacity);
  if (!Number.isInteger(c) || c < 1 || c > 6) return ['capacity', 'Capacity must be between 1 and 6.'];
  if (!['available', 'maintenance'].includes(b.status || 'available')) return ['status', 'Status must be available or maintenance.'];
}

app.get('/api/rooms', (req, res) => {
  const rooms = db.prepare('SELECT * FROM rooms ORDER BY price').all();
  const { checkIn, checkOut, guests } = req.query;
  if (!checkIn && !checkOut) return res.json(rooms);
  const e = dateErr(checkIn, checkOut, guests || 1);
  if (e) return bad(res, e);
  const n = nightsBetween(checkIn, checkOut), g = Number(guests || 1);
  res.json(rooms.map(r => {
    let reason = null;
    if (r.status !== 'available') reason = 'Under maintenance';
    else if (r.capacity < g) reason = 'Too small for your group';
    else if (taken(r.id, checkIn, checkOut)) reason = 'Booked for these dates';
    return { ...r, nights: n, total: n * r.price, available: !reason, reason };
  }));
});

app.post('/api/rooms', auth('admin'), (req, res) => {
  const err = roomErr(req.body);
  if (err) return bad(res, err[1], 400, err[0]);
  const b = req.body;
  const info = db.prepare('INSERT INTO rooms(name,type,price,capacity,description,status) VALUES (?,?,?,?,?,?)')
    .run(b.name.trim(), b.type, Number(b.price), Number(b.capacity), (b.description || '').trim(), b.status || 'available');
  res.status(201).json(db.prepare('SELECT * FROM rooms WHERE id=?').get(info.lastInsertRowid));
});

app.put('/api/rooms/:id', auth('admin'), (req, res) => {
  if (!db.prepare('SELECT 1 FROM rooms WHERE id=?').get(req.params.id)) return bad(res, 'Room not found.', 404);
  const err = roomErr(req.body);
  if (err) return bad(res, err[1], 400, err[0]);
  const b = req.body;
  db.prepare('UPDATE rooms SET name=?,type=?,price=?,capacity=?,description=?,status=? WHERE id=?')
    .run(b.name.trim(), b.type, Number(b.price), Number(b.capacity), (b.description || '').trim(), b.status || 'available', req.params.id);
  res.json(db.prepare('SELECT * FROM rooms WHERE id=?').get(req.params.id));
});

app.delete('/api/rooms/:id', auth('admin'), (req, res) => {
  if (!db.prepare('SELECT 1 FROM rooms WHERE id=?').get(req.params.id)) return bad(res, 'Room not found.', 404);
  if (db.prepare("SELECT 1 FROM bookings WHERE room_id=? AND status='confirmed' AND check_out>?").get(req.params.id, today()))
    return bad(res, 'Room has upcoming bookings and cannot be deleted.', 409);
  db.prepare('DELETE FROM rooms WHERE id=?').run(req.params.id);
  res.json({ message: 'Room deleted.' });
});

// ---- posts ----
const postErr = b => !b.title || !String(b.title).trim() ? ['title', 'Title is required.']
  : !b.body || !String(b.body).trim() ? ['body', 'Content is required.'] : null;

app.get('/api/posts', (req, res) => res.json(db.prepare('SELECT * FROM posts ORDER BY id DESC').all()));
app.post('/api/posts', auth('admin'), (req, res) => {
  const err = postErr(req.body);
  if (err) return bad(res, err[1], 400, err[0]);
  const info = db.prepare('INSERT INTO posts(title,body) VALUES (?,?)').run(req.body.title.trim(), req.body.body.trim());
  res.status(201).json(db.prepare('SELECT * FROM posts WHERE id=?').get(info.lastInsertRowid));
});
app.put('/api/posts/:id', auth('admin'), (req, res) => {
  if (!db.prepare('SELECT 1 FROM posts WHERE id=?').get(req.params.id)) return bad(res, 'Post not found.', 404);
  const err = postErr(req.body);
  if (err) return bad(res, err[1], 400, err[0]);
  db.prepare('UPDATE posts SET title=?, body=? WHERE id=?').run(req.body.title.trim(), req.body.body.trim(), req.params.id);
  res.json(db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id));
});
app.delete('/api/posts/:id', auth('admin'), (req, res) => {
  if (!db.prepare('DELETE FROM posts WHERE id=?').run(req.params.id).changes) return bad(res, 'Post not found.', 404);
  res.json({ message: 'Post deleted.' });
});

// ---- bookings ----
const BOOKING_SQL = `SELECT b.*, COALESCE(r.name,'Removed room') AS room_name, r.type AS room_type, u.name AS customer, u.email AS customer_email
  FROM bookings b LEFT JOIN rooms r ON r.id=b.room_id JOIN users u ON u.id=b.user_id`;

app.post('/api/bookings', auth('customer'), (req, res) => {
  const { roomId, checkIn, checkOut, guests } = req.body;
  const e = dateErr(checkIn, checkOut, guests);
  if (e) return bad(res, e);
  const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(roomId);
  if (!room) return bad(res, 'Room not found.', 404);
  if (room.status !== 'available') return bad(res, 'This room is under maintenance.', 409);
  if (room.capacity < Number(guests)) return bad(res, `This room sleeps up to ${room.capacity} guests.`);
  if (taken(room.id, checkIn, checkOut)) return bad(res, 'Room is not available for the selected dates.', 409);
  const n = nightsBetween(checkIn, checkOut);
  const ref = 'SE' + Math.floor(100000 + Math.random() * 900000);
  const info = db.prepare('INSERT INTO bookings(ref,user_id,room_id,check_in,check_out,guests,nights,total) VALUES (?,?,?,?,?,?,?,?)')
    .run(ref, req.user.id, room.id, checkIn, checkOut, Number(guests), n, n * room.price);
  res.status(201).json(db.prepare(BOOKING_SQL + ' WHERE b.id=?').get(info.lastInsertRowid));
});

app.get('/api/bookings/mine', auth('customer'), (req, res) =>
  res.json(db.prepare(BOOKING_SQL + ' WHERE b.user_id=? ORDER BY b.id DESC').all(req.user.id)));

app.get('/api/bookings', auth('admin'), (req, res) =>
  res.json(db.prepare(BOOKING_SQL + ' ORDER BY b.id DESC').all()));

app.delete('/api/bookings/:id', auth(), (req, res) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(req.params.id);
  const admin = req.user.role === 'admin';
  if (!b || (!admin && b.user_id !== req.user.id)) return bad(res, 'Booking not found.', 404);
  if (b.status !== 'confirmed') return bad(res, 'This booking is already cancelled.', 409);
  if (!admin && today() >= b.check_in) return bad(res, 'Bookings can only be cancelled before the check-in date.', 409);
  db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(b.id);
  res.json({ message: 'Booking cancelled.' });
});

app.use('/api', (req, res) => bad(res, 'Endpoint not found.', 404));
app.listen(PORT, () => console.log(`StayEase running at http://localhost:${PORT}`));
