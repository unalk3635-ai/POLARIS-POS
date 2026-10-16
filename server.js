
const os = require("os");
const getDbDir = () => {
  if (process.versions.electron) {
    const { app } = require("electron");
    return app ? app.getPath("userData") : path.join(os.homedir(), ".polaris-pos");
  }
  return path.join(__dirname, "data");
};
﻿const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Multi-Tenant Middleware & Veritabanı Havuzu (Cache)
const dbCache = {};

function getTenantId(req) {
    // 1. Subdomain kontrolü (örn: sekeristasyonu.localhost)
    const host = req.headers.host || '';
    const parts = host.split('.');
    if (parts.length > 1 && parts[0] !== 'localhost' && parts[0] !== 'www') {
        return parts[0].toLowerCase();
    }
    // 2. Query parametresi (örn: ?tenant=sekeristasyonu)
    if (req.query && req.query.tenant) {
        return req.query.tenant.toLowerCase();
    }
    // 3. Custom Header (örn: X-Tenant-ID: sekeristasyonu)
    if (req.headers['x-tenant-id']) {
        return req.headers['x-tenant-id'].toLowerCase();
    }
    // Varsayılan tenant
    return 'demo';
}

// Şubeye özel klasör ve DB hazırlama
function getTenantDb(tenantId) {
    if (dbCache[tenantId]) {
        return dbCache[tenantId];
    }

    const tenantDir = path.join(__dirname, 'tenants', tenantId);
    const uploadsDir = path.join(tenantDir, 'uploads');

    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(path.join(getDbDir(), "tenants"), { recursive: true });
    }

    const dbPath = path.join(tenantDir, 'pos_database.db');
    const db = new sqlite3.Database(dbPath, (err) => {
        if (err) console.error(`[${tenantId}] Veritabanı hatası:`, err.message);
        else console.log(`[${tenantId}] SQLite veritabanı bağlandı.`);
    });

    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price REAL NOT NULL,
            category_id INTEGER,
            img TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tableNo TEXT NOT NULL,
            items TEXT NOT NULL,
            note TEXT,
            totalAmount REAL NOT NULL,
            paidAmount REAL DEFAULT 0,
            nakit REAL DEFAULT 0,
            kart REAL DEFAULT 0,
            yemek REAL DEFAULT 0,
            status TEXT DEFAULT 'Hazırlanıyor',
            createdAt TEXT NOT NULL
        )`);

        db.get("SELECT COUNT(*) as count FROM categories", (err, row) => {
            if (row && row.count === 0) {
                db.run("INSERT INTO categories (name) VALUES ('Kahveler'), ('Tatlılar')");
                db.run("INSERT INTO products (name, price, category_id, img) VALUES ('Türk Kahvesi', 40, 1, '/logo.png'), ('San Sebastian', 110, 2, '/logo.png')");
            }
        });
    });

    dbCache[tenantId] = db;
    return db;
}

// Tenant Middleware
app.use((req, res, next) => {
    req.tenantId = getTenantId(req);
    req.db = getTenantDb(req.tenantId);
    next();
});

// Static klasörler
app.use(express.static('public'));
app.use('/uploads', (req, res, next) => {
    const tenantUploads = path.join(__dirname, 'tenants', req.tenantId, 'uploads');
    express.static(tenantUploads)(req, res, next);
});

// Dynamic Multer Storage for Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const tenantUploads = path.join(__dirname, 'tenants', req.tenantId, 'uploads');
        cb(null, tenantUploads);
    },
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Category APIs
app.get('/api/categories', (req, res) => {
    req.db.all("SELECT * FROM categories", [], (err, rows) => res.json(rows || []));
});

app.post('/api/categories', (req, res) => {
    const { name } = req.body;
    req.db.run("INSERT INTO categories (name) VALUES (?)", [name], function(err) {
        res.json({ id: this.lastID, name });
    });
});

app.delete('/api/categories/:id', (req, res) => {
    req.db.run("DELETE FROM categories WHERE id = ?", [req.params.id], () => res.json({ success: true }));
});

// Product APIs
app.get('/api/products', (req, res) => {
    req.db.all("SELECT * FROM products", [], (err, rows) => res.json(rows || []));
});

app.post('/api/products', upload.single('image'), (req, res) => {
    const { name, price, category_id, imgUrl } = req.body;
    let imgPath = imgUrl || '/logo.png';
    if (req.file) {
        imgPath = `/uploads/${req.file.filename}`;
    }
    req.db.run("INSERT INTO products (name, price, category_id, img) VALUES (?, ?, ?, ?)", 
        [name, parseFloat(price), parseInt(category_id), imgPath], function(err) {
            res.json({ id: this.lastID });
    });
});

app.delete('/api/products/:id', (req, res) => {
    req.db.run("DELETE FROM products WHERE id = ?", [req.params.id], () => res.json({ success: true }));
});

// Order APIs
app.get('/api/orders', (req, res) => {
    req.db.all("SELECT * FROM orders WHERE status != 'Kapatıldı'", [], (err, rows) => {
        if (err) return res.status(500).json([]);
        const parsed = rows.map(r => ({ ...r, items: JSON.parse(r.items) }));
        res.json(parsed);
    });
});

app.post('/api/orders', (req, res) => {
    const { tableNo, items, note, totalAmount } = req.body;
    const createdAt = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    req.db.run("INSERT INTO orders (tableNo, items, note, totalAmount, createdAt) VALUES (?, ?, ?, ?, ?)",
        [tableNo, JSON.stringify(items), note, totalAmount, createdAt], function(err) {
            res.json({ id: this.lastID });
    });
});

app.post('/api/orders/status', (req, res) => {
    const { id, status } = req.body;
    req.db.run("UPDATE orders SET status = ? WHERE id = ?", [status, id], () => res.json({ success: true }));
});

app.post('/api/orders/pay', (req, res) => {
    const { id, amount, nakit, kart, yemek } = req.body;

    req.db.get("SELECT * FROM orders WHERE id = ?", [id], (err, order) => {
        if (!order) return res.status(404).json({ error: "Sipariş bulunamadı" });

        const newPaidAmount = (order.paidAmount || 0) + amount;
        const newNakit = (order.nakit || 0) + (nakit || 0);
        const newKart = (order.kart || 0) + (kart || 0);
        const newYemek = (order.yemek || 0) + (yemek || 0);

        let newStatus = order.status;
        if (newPaidAmount >= order.totalAmount) {
            newStatus = 'Kapatıldı';
        }

        req.db.run(
            "UPDATE orders SET paidAmount = ?, nakit = ?, kart = ?, yemek = ?, status = ? WHERE id = ?",
            [newPaidAmount, newNakit, newKart, newYemek, newStatus, id],
            () => res.json({ success: true, closed: newStatus === 'Kapatıldı' })
        );
    });
});

// Admin History & Summary
app.get('/api/admin/history', (req, res) => {
    req.db.all("SELECT * FROM orders ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json([]);
        res.json(rows);
    });
});

app.delete('/api/admin/orders/:id', (req, res) => {
    req.db.run("DELETE FROM orders WHERE id = ?", [req.params.id], () => res.json({ success: true }));
});

app.delete('/api/admin/clear-history', (req, res) => {
    req.db.run("DELETE FROM orders", [], () => res.json({ success: true }));
});

app.listen(PORT, () => {
    console.log(`Multi-Tenant Sunucu aktif: http://localhost:${PORT}`);
});


// SPA Fallback: Sadece UI rotalarini index.html e yonlendir, API ve statik dosyaları pas gec
app.get("*", (req, res, next) => {
  if (req.originalUrl.startsWith("/api") || req.originalUrl.includes(".")) {
    return next();
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

