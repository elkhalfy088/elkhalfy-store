require("dotenv").config();

const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const Database = require("better-sqlite3");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PATH = "/2009elkhalfyabdeladimadmin1nembre";
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be at least 32 characters in production");
  }
  process.env.SESSION_SECRET = crypto.randomBytes(32).toString("hex");
  console.warn("Using a temporary development session secret. Set SESSION_SECRET in .env.");
}

const db = new Database(path.join(DATA_DIR, "store.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    price REAL NOT NULL DEFAULT 0 CHECK(price >= 0),
    old_price REAL,
    category_id INTEGER,
    thumbnail TEXT NOT NULL DEFAULT '',
    images TEXT NOT NULL DEFAULT '[]',
    video_url TEXT NOT NULL DEFAULT '',
    badge TEXT NOT NULL DEFAULT '',
    stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS slides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT '',
    subtitle TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    button_text TEXT NOT NULL DEFAULT '',
    button_url TEXT NOT NULL DEFAULT '#products',
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracking_code TEXT NOT NULL UNIQUE,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    product_id INTEGER,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    total REAL NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
`);

const defaultSettings = {
  storeName: "Elkhalfy",
  tagline: "متجر رقمي احترافي",
  description: "أضف وصف متجرك من لوحة التحكم.",
  currency: "MAD",
  logoText: "E",
  phone: "",
  whatsapp: "",
  instagram: "",
  facebook: "",
  primaryColor: "#05d6ad",
  darkMode: true
};
if (!db.prepare("SELECT id FROM settings WHERE id = 1").get()) {
  db.prepare("INSERT INTO settings (id, data) VALUES (1, ?)").run(JSON.stringify(defaultSettings));
}

const adminEmail = String(process.env.ADMIN_EMAIL || "admin@example.com").trim().toLowerCase();
const adminPassword = String(process.env.ADMIN_PASSWORD || "");
if (!db.prepare("SELECT id FROM admins WHERE email = ?").get(adminEmail)) {
  if (!adminPassword || adminPassword.length < 10) {
    console.warn("Set ADMIN_PASSWORD to at least 10 characters before production.");
  }
  const hash = bcrypt.hashSync(adminPassword || crypto.randomBytes(24).toString("hex"), 12);
  db.prepare("INSERT INTO admins (email, password_hash) VALUES (?, ?)").run(adminEmail, hash);
}

class SQLiteSessionStore extends session.Store {
  constructor(database) {
    super();
    this.database = database;
    this.read = database.prepare("SELECT data, expires_at FROM sessions WHERE sid = ?");
    this.write = database.prepare("INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET data=excluded.data, expires_at=excluded.expires_at");
    this.remove = database.prepare("DELETE FROM sessions WHERE sid = ?");
  }
  get(sid, callback) {
    try {
      const row = this.read.get(sid);
      if (!row || row.expires_at <= Date.now()) return callback(null, null);
      callback(null, JSON.parse(row.data));
    } catch (error) { callback(error); }
  }
  set(sid, sess, callback) {
    try {
      const expires = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86400000;
      this.write.run(sid, JSON.stringify(sess), expires);
      callback?.(null);
    } catch (error) { callback?.(error); }
  }
  destroy(sid, callback) {
    try { this.remove.run(sid); callback?.(null); } catch (error) { callback?.(error); }
  }
  touch(sid, sess, callback) {
    try {
      const expires = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86400000;
      this.database.prepare("UPDATE sessions SET expires_at = ? WHERE sid = ?").run(expires, sid);
      callback?.(null);
    } catch (error) { callback?.(error); }
  }
}
setInterval(() => db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now()), 60 * 60 * 1000).unref();

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "https:", "data:", "blob:"],
      mediaSrc: ["'self'", "https:", "blob:"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: "200kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));
app.use(session({
  store: new SQLiteSessionStore(db),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 8
  }
}));
app.use("/uploads", express.static(UPLOAD_DIR, {
  fallthrough: false,
  setHeaders(res) { res.set("X-Content-Type-Options", "nosniff"); }
}));
app.get(ADMIN_PATH, (req, res) => res.sendFile(path.join(ROOT, "public", "admin.html")));
app.use((req, res, next) => {
  if (req.path === "/admin.html") return res.status(404).send("Not found");
  next();
});
app.use(express.static(path.join(ROOT, "public"), { extensions: ["html"] }));

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 180, standardHeaders: "draft-7", legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: "draft-7", legacyHeaders: false });
app.use("/api", apiLimiter);

function jsonError(res, status, message) {
  return res.status(status).json({ error: message });
}
function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}
function safeUrl(value, fallback = "") {
  const raw = clean(value, 500);
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "https:" || (parsed.protocol === "http:" && process.env.NODE_ENV !== "production")) return parsed.toString();
  } catch {}
  return fallback;
}
function slugify(value) {
  const slug = clean(value, 120).toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  return slug || `item-${Date.now()}`;
}
function asBool(value) { return value === true || value === 1 || value === "1" || value === "true"; }
function asInt(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}
function asPrice(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
function csrfToken(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString("hex");
  return req.session.csrf;
}
function requireAdmin(req, res, next) {
  if (!req.session.adminId) return jsonError(res, 401, "يجب تسجيل الدخول أولاً.");
  next();
}
function requireCsrf(req, res, next) {
  if (!req.session.csrf || req.get("x-csrf-token") !== req.session.csrf) {
    return jsonError(res, 403, "رمز حماية غير صالح.");
  }
  next();
}
function publicProduct(row) {
  return {
    ...row,
    oldPrice: row.old_price,
    categoryId: row.category_id,
    images: JSON.parse(row.images || "[]"),
    active: Boolean(row.active)
  };
}
function adminProduct(row) {
  return publicProduct(row);
}

app.get("/api/store", (req, res) => {
  const settings = JSON.parse(db.prepare("SELECT data FROM settings WHERE id = 1").get().data);
  const categories = db.prepare("SELECT * FROM categories ORDER BY name").all();
  const products = db.prepare(`
    SELECT p.*, c.name AS category_name FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.active = 1 ORDER BY p.id DESC
  `).all().map(publicProduct);
  const slides = db.prepare("SELECT * FROM slides WHERE active = 1 ORDER BY sort_order, id").all();
  res.json({ settings, categories, products, slides });
});

app.get("/api/orders/:trackingCode", (req, res) => {
  const code = clean(req.params.trackingCode, 20).toUpperCase();
  const order = db.prepare(`
    SELECT tracking_code, product_name, quantity, total, status, created_at
    FROM orders WHERE tracking_code = ?
  `).get(code);
  if (!order) return jsonError(res, 404, "لم يتم العثور على الطلب.");
  res.json({ order });
});

app.post("/api/orders", (req, res) => {
  const name = clean(req.body.name, 80);
  const phone = clean(req.body.phone, 30);
  const productId = asInt(req.body.productId, 0);
  const quantity = Math.min(Math.max(asInt(req.body.quantity, 1), 1), 99);
  const notes = clean(req.body.notes, 500);
  if (name.length < 2 || !/^[+()\d\s-]{7,30}$/.test(phone) || !productId) {
    return jsonError(res, 400, "تحقق من الاسم ورقم الهاتف والمنتج.");
  }
  const product = db.prepare("SELECT * FROM products WHERE id = ? AND active = 1").get(productId);
  if (!product) return jsonError(res, 400, "المنتج غير متاح.");
  if (product.stock > 0 && quantity > product.stock) return jsonError(res, 400, "الكمية المطلوبة غير متوفرة.");
  const trackingCode = `EK${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const total = Math.round(product.price * quantity * 100) / 100;
  db.prepare(`
    INSERT INTO orders (tracking_code, customer_name, phone, product_id, product_name, quantity, total, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(trackingCode, name, phone, productId, product.name, quantity, total, notes);
  res.status(201).json({ trackingCode });
});

app.post("/api/messages", (req, res) => {
  const name = clean(req.body.name, 80);
  const email = clean(req.body.email, 160).toLowerCase();
  const message = clean(req.body.message, 2000);
  if (name.length < 2 || message.length < 3 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return jsonError(res, 400, "تحقق من بيانات التواصل.");
  }
  db.prepare("INSERT INTO messages (name, email, message) VALUES (?, ?, ?)").run(name, email, message);
  res.status(201).json({ ok: true });
});

app.post("/api/auth/login", authLimiter, (req, res) => {
  const email = clean(req.body.email, 160).toLowerCase();
  const password = String(req.body.password || "");
  const admin = db.prepare("SELECT * FROM admins WHERE email = ?").get(email);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) return jsonError(res, 401, "بيانات الدخول غير صحيحة.");
  req.session.regenerate((err) => {
    if (err) return jsonError(res, 500, "تعذر إنشاء الجلسة.");
    req.session.adminId = admin.id;
    req.session.adminEmail = admin.email;
    req.session.csrf = crypto.randomBytes(24).toString("hex");
    res.json({ ok: true });
  });
});
app.post("/api/auth/logout", requireAdmin, requireCsrf, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});
app.get("/api/auth/me", (req, res) => {
  res.json({ authenticated: Boolean(req.session.adminId), email: req.session.adminEmail || null, csrf: req.session.adminId ? csrfToken(req) : null });
});

app.get("/api/admin/dashboard", requireAdmin, (req, res) => {
  const stats = {
    products: db.prepare("SELECT COUNT(*) AS count FROM products").get().count,
    slides: db.prepare("SELECT COUNT(*) AS count FROM slides").get().count,
    orders: db.prepare("SELECT COUNT(*) AS count FROM orders").get().count,
    unread: db.prepare("SELECT COUNT(*) AS count FROM messages WHERE read = 0").get().count
  };
  res.json({ stats });
});
app.get("/api/admin/settings", requireAdmin, (req, res) => {
  res.json(JSON.parse(db.prepare("SELECT data FROM settings WHERE id = 1").get().data));
});
app.put("/api/admin/settings", requireAdmin, requireCsrf, (req, res) => {
  const current = JSON.parse(db.prepare("SELECT data FROM settings WHERE id = 1").get().data);
  const next = {
    ...current,
    storeName: clean(req.body.storeName, 80),
    tagline: clean(req.body.tagline, 160),
    description: clean(req.body.description, 500),
    currency: clean(req.body.currency, 10) || "MAD",
    logoText: clean(req.body.logoText, 3) || "E",
    phone: clean(req.body.phone, 30),
    whatsapp: safeUrl(req.body.whatsapp),
    instagram: safeUrl(req.body.instagram),
    facebook: safeUrl(req.body.facebook),
    primaryColor: /^#[0-9a-f]{6}$/i.test(req.body.primaryColor) ? req.body.primaryColor : current.primaryColor,
    darkMode: asBool(req.body.darkMode)
  };
  db.prepare("UPDATE settings SET data = ? WHERE id = 1").run(JSON.stringify(next));
  res.json(next);
});

app.get("/api/admin/products", requireAdmin, (req, res) => {
  res.json(db.prepare(`
    SELECT p.*, c.name AS category_name FROM products p
    LEFT JOIN categories c ON c.id = p.category_id ORDER BY p.id DESC
  `).all().map(adminProduct));
});
app.post("/api/admin/products", requireAdmin, requireCsrf, (req, res) => {
  const name = clean(req.body.name, 160);
  const price = asPrice(req.body.price);
  if (name.length < 2 || price === null) return jsonError(res, 400, "اسم المنتج والسعر مطلوبان.");
  const images = Array.isArray(req.body.images) ? req.body.images.map(x => safeUrl(x)).filter(Boolean).slice(0, 12) : [];
  const thumbnail = safeUrl(req.body.thumbnail || images[0]);
  const slug = slugify(req.body.slug || name);
  try {
    const info = db.prepare(`
      INSERT INTO products (name, slug, description, price, old_price, category_id, thumbnail, images, video_url, badge, stock, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name, slug, clean(req.body.description, 2000), price, asPrice(req.body.oldPrice),
      asInt(req.body.categoryId, 0) || null, thumbnail, JSON.stringify(images),
      safeUrl(req.body.videoUrl), clean(req.body.badge, 40), Math.max(asInt(req.body.stock, 0), 0), asBool(req.body.active) ? 1 : 0
    );
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) return jsonError(res, 409, "الرابط المختصر مستخدم.");
    return jsonError(res, 500, "تعذر حفظ المنتج.");
  }
});
app.put("/api/admin/products/:id", requireAdmin, requireCsrf, (req, res) => {
  const id = asInt(req.params.id);
  const existing = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  if (!existing) return jsonError(res, 404, "المنتج غير موجود.");
  const name = clean(req.body.name, 160);
  const price = asPrice(req.body.price);
  if (name.length < 2 || price === null) return jsonError(res, 400, "اسم المنتج والسعر مطلوبان.");
  const images = Array.isArray(req.body.images) ? req.body.images.map(x => safeUrl(x)).filter(Boolean).slice(0, 12) : [];
  try {
    db.prepare(`
      UPDATE products SET name=?, slug=?, description=?, price=?, old_price=?, category_id=?, thumbnail=?, images=?, video_url=?, badge=?, stock=?, active=?
      WHERE id=?
    `).run(
      name, slugify(req.body.slug || name), clean(req.body.description, 2000), price, asPrice(req.body.oldPrice),
      asInt(req.body.categoryId, 0) || null, safeUrl(req.body.thumbnail || images[0]), JSON.stringify(images),
      safeUrl(req.body.videoUrl), clean(req.body.badge, 40), Math.max(asInt(req.body.stock, 0), 0), asBool(req.body.active) ? 1 : 0, id
    );
    res.json({ ok: true });
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) return jsonError(res, 409, "الرابط المختصر مستخدم.");
    return jsonError(res, 500, "تعذر حفظ المنتج.");
  }
});
app.delete("/api/admin/products/:id", requireAdmin, requireCsrf, (req, res) => {
  db.prepare("DELETE FROM products WHERE id = ?").run(asInt(req.params.id));
  res.json({ ok: true });
});

app.get("/api/admin/categories", requireAdmin, (req, res) => res.json(db.prepare("SELECT * FROM categories ORDER BY name").all()));
app.post("/api/admin/categories", requireAdmin, requireCsrf, (req, res) => {
  const name = clean(req.body.name, 80);
  if (name.length < 2) return jsonError(res, 400, "اسم التصنيف مطلوب.");
  try {
    const info = db.prepare("INSERT INTO categories (name, slug) VALUES (?, ?)").run(name, slugify(req.body.slug || name));
    res.status(201).json({ id: info.lastInsertRowid });
  } catch { return jsonError(res, 409, "التصنيف موجود مسبقًا."); }
});
app.delete("/api/admin/categories/:id", requireAdmin, requireCsrf, (req, res) => {
  db.prepare("DELETE FROM categories WHERE id = ?").run(asInt(req.params.id));
  res.json({ ok: true });
});

app.get("/api/admin/slides", requireAdmin, (req, res) => res.json(db.prepare("SELECT * FROM slides ORDER BY sort_order, id").all()));
app.post("/api/admin/slides", requireAdmin, requireCsrf, (req, res) => {
  const info = db.prepare(`
    INSERT INTO slides (title, subtitle, image_url, button_text, button_url, active, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    clean(req.body.title, 160), clean(req.body.subtitle, 500), safeUrl(req.body.imageUrl),
    clean(req.body.buttonText, 60), safeUrl(req.body.buttonUrl, "#products") || "#products",
    asBool(req.body.active) ? 1 : 0, asInt(req.body.sortOrder, 0)
  );
  res.status(201).json({ id: info.lastInsertRowid });
});
app.put("/api/admin/slides/:id", requireAdmin, requireCsrf, (req, res) => {
  db.prepare(`
    UPDATE slides SET title=?, subtitle=?, image_url=?, button_text=?, button_url=?, active=?, sort_order=? WHERE id=?
  `).run(
    clean(req.body.title, 160), clean(req.body.subtitle, 500), safeUrl(req.body.imageUrl),
    clean(req.body.buttonText, 60), safeUrl(req.body.buttonUrl, "#products") || "#products",
    asBool(req.body.active) ? 1 : 0, asInt(req.body.sortOrder, 0), asInt(req.params.id)
  );
  res.json({ ok: true });
});
app.delete("/api/admin/slides/:id", requireAdmin, requireCsrf, (req, res) => {
  db.prepare("DELETE FROM slides WHERE id = ?").run(asInt(req.params.id));
  res.json({ ok: true });
});

app.get("/api/admin/orders", requireAdmin, (req, res) => res.json(db.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT 500").all()));
app.put("/api/admin/orders/:id/status", requireAdmin, requireCsrf, (req, res) => {
  const allowed = new Set(["new", "processing", "completed", "cancelled"]);
  const status = clean(req.body.status, 20);
  if (!allowed.has(status)) return jsonError(res, 400, "حالة غير صالحة.");
  db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, asInt(req.params.id));
  res.json({ ok: true });
});
app.get("/api/admin/messages", requireAdmin, (req, res) => res.json(db.prepare("SELECT * FROM messages ORDER BY id DESC LIMIT 500").all()));
app.put("/api/admin/messages/:id/read", requireAdmin, requireCsrf, (req, res) => {
  db.prepare("UPDATE messages SET read = 1 WHERE id = ?").run(asInt(req.params.id));
  res.json({ ok: true });
});

const maxBytes = Math.min(Math.max(Number(process.env.MAX_UPLOAD_MB || 50), 1), 100) * 1024 * 1024;
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: maxBytes, files: 12 },
  fileFilter: (req, file, cb) => {
    const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4"]);
    cb(null, allowed.has(file.mimetype));
  }
});
app.post("/api/admin/uploads", requireAdmin, requireCsrf, upload.array("files", 12), (req, res) => {
  res.status(201).json({ files: (req.files || []).map(file => ({
    url: `/uploads/${file.filename}`, type: file.mimetype, size: file.size
  })) });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err) return jsonError(res, 400, "تعذر رفع الملف أو أن نوعه غير مسموح.");
  next();
});
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(ROOT, "public", "index.html"));
});

app.listen(PORT, () => console.log(`Elkhalfy Store running on http://localhost:${PORT}`));