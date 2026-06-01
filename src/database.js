const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'ethiop2p.db');

let db;

async function initDatabase() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA journal_mode = WAL;');
  db.run('PRAGMA foreign_keys = ON;');

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      telegram_id TEXT UNIQUE,
      name TEXT,
      username TEXT,
      reputation INTEGER DEFAULT 0,
      total_trades INTEGER DEFAULT 0,
      positive_trades INTEGER DEFAULT 0,
      is_whitelisted INTEGER DEFAULT 0,
      is_admin INTEGER DEFAULT 0,
      trade_limit INTEGER DEFAULT 5000,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS payment_info (
      id INTEGER PRIMARY KEY,
      user_id INTEGER UNIQUE,
      bank_name TEXT,
      bank_account TEXT,
      bank_account_name TEXT,
      telebirr_number TEXT,
      mpesa_number TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS ads (
      id INTEGER PRIMARY KEY,
      user_id INTEGER,
      type TEXT CHECK(type IN ('buy', 'sell')),
      crypto TEXT,
      amount REAL,
      price_per_unit REAL,
      payment_methods TEXT,
      note TEXT,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'expired', 'cancelled', 'completed')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME DEFAULT (datetime('now', '+24 hours')),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY,
      ad_id INTEGER,
      buyer_id INTEGER,
      seller_id INTEGER,
      crypto TEXT,
      amount REAL,
      price_per_unit REAL,
      total_etb REAL,
      payment_method TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'buyer_confirmed', 'seller_confirmed', 'completed', 'disputed', 'cancelled', 'expired')),
      dispute_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME DEFAULT (datetime('now', '+4 hours')),
      completed_at DATETIME,
      FOREIGN KEY(ad_id) REFERENCES ads(id),
      FOREIGN KEY(buyer_id) REFERENCES users(id),
      FOREIGN KEY(seller_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY,
      trade_id INTEGER,
      from_user_id INTEGER,
      to_user_id INTEGER,
      rating INTEGER CHECK(rating IN (-1, 0, 1)),
      comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(trade_id, from_user_id),
      FOREIGN KEY(trade_id) REFERENCES trades(id),
      FOREIGN KEY(from_user_id) REFERENCES users(id),
      FOREIGN KEY(to_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS trade_messages (
      id INTEGER PRIMARY KEY,
      trade_id INTEGER,
      from_user_id INTEGER,
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(trade_id) REFERENCES trades(id),
      FOREIGN KEY(from_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      telegram_id TEXT PRIMARY KEY,
      state TEXT,
      data TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  save();
  console.log('Database initialized at', DB_PATH);
}

function save() {
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (e) {
    console.error('DB save error:', e.message);
  }
}

// Save every 30 seconds
setInterval(save, 30000);

// Helper: run a query that modifies data
function run(sql, params = []) {
  db.run(sql, params);
  save();
  // Get lastInsertRowid
  const row = db.exec('SELECT last_insert_rowid() as id');
  return { lastInsertRowid: row[0]?.values[0]?.[0] || 0 };
}

// Helper: get one row
function get(sql, params = []) {
  const result = db.exec(sql, params);
  if (!result[0] || !result[0].values[0]) return undefined;
  const cols = result[0].columns;
  const vals = result[0].values[0];
  const obj = {};
  cols.forEach((c, i) => obj[c] = vals[i]);
  return obj;
}

// Helper: get all rows
function all(sql, params = []) {
  const result = db.exec(sql, params);
  if (!result[0]) return [];
  const cols = result[0].columns;
  return result[0].values.map(vals => {
    const obj = {};
    cols.forEach((c, i) => obj[c] = vals[i]);
    return obj;
  });
}

// Helper: run without saving (for reads)
function exec(sql, params = []) {
  return all(sql, params);
}

// ─── User Queries ─────────────────────────────────────────────────────────────
const userQueries = {
  findByTelegramId: { get: (tid) => get('SELECT * FROM users WHERE telegram_id = ?', [tid]) },
  create: { run: (tid, name, username, whitelisted, admin) => run('INSERT INTO users (telegram_id, name, username, is_whitelisted, is_admin) VALUES (?, ?, ?, ?, ?)', [tid, name, username, whitelisted, admin]) },
  update: { run: (name, username, tid) => run('UPDATE users SET name = ?, username = ? WHERE telegram_id = ?', [name, username, tid]) },
  whitelist: { run: (tid) => run('UPDATE users SET is_whitelisted = 1 WHERE telegram_id = ?', [tid]) },
  unwhitelist: { run: (tid) => run('UPDATE users SET is_whitelisted = 0 WHERE telegram_id = ?', [tid]) },
  setAdmin: { run: (tid) => run('UPDATE users SET is_admin = 1 WHERE telegram_id = ?', [tid]) },
  setTradeLimit: { run: (limit, id) => run('UPDATE users SET trade_limit = ? WHERE id = ?', [limit, id]) },
  updateReputation: {
    run: (positiveDelta, repDelta, pd2, pd3, userId) => run(`
      UPDATE users SET
        total_trades = total_trades + 1,
        positive_trades = positive_trades + ?,
        reputation = reputation + ?,
        trade_limit = CASE
          WHEN (total_trades + 1) >= 11 AND (CAST((positive_trades + ?) AS REAL) / (total_trades + 1)) >= 0.9 THEN 50000
          WHEN (total_trades + 1) >= 3 AND (CAST((positive_trades + ?) AS REAL) / (total_trades + 1)) >= 0.8 THEN 20000
          ELSE 5000
        END
      WHERE id = ?
    `, [positiveDelta, repDelta, pd2, pd3, userId])
  },
  getAll: { all: () => all('SELECT * FROM users ORDER BY total_trades DESC') },
  getAllWhitelisted: { all: () => all('SELECT * FROM users WHERE is_whitelisted = 1') },
};

// ─── Payment Queries ──────────────────────────────────────────────────────────
const paymentQueries = {
  get: { get: (userId) => get('SELECT * FROM payment_info WHERE user_id = ?', [userId]) },
  upsert: {
    run: (userId, bankName, bankAccount, bankAccountName, telebirr, mpesa) => run(`
      INSERT INTO payment_info (user_id, bank_name, bank_account, bank_account_name, telebirr_number, mpesa_number)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        bank_name = excluded.bank_name,
        bank_account = excluded.bank_account,
        bank_account_name = excluded.bank_account_name,
        telebirr_number = excluded.telebirr_number,
        mpesa_number = excluded.mpesa_number
    `, [userId, bankName, bankAccount, bankAccountName, telebirr, mpesa])
  },
};

// ─── Ad Queries ───────────────────────────────────────────────────────────────
const adQueries = {
  create: { run: (userId, type, crypto, amount, price, methods, note) => run('INSERT INTO ads (user_id, type, crypto, amount, price_per_unit, payment_methods, note) VALUES (?, ?, ?, ?, ?, ?, ?)', [userId, type, crypto, amount, price, methods, note]) },
  getActive: { all: () => all("SELECT ads.*, users.name, users.reputation, users.total_trades FROM ads JOIN users ON ads.user_id = users.id WHERE ads.status = 'active' AND ads.expires_at > datetime('now') ORDER BY ads.created_at DESC") },
  getActiveFiltered: { all: (type, crypto) => all("SELECT ads.*, users.name, users.reputation, users.total_trades FROM ads JOIN users ON ads.user_id = users.id WHERE ads.status = 'active' AND ads.expires_at > datetime('now') AND ads.type = ? AND ads.crypto = ? ORDER BY ads.created_at DESC", [type, crypto]) },
  getActiveByCrypto: { all: (crypto) => all("SELECT ads.*, users.name, users.reputation, users.total_trades FROM ads JOIN users ON ads.user_id = users.id WHERE ads.status = 'active' AND ads.expires_at > datetime('now') AND ads.crypto = ? ORDER BY ads.created_at DESC", [crypto]) },
  getActiveByType: { all: (type) => all("SELECT ads.*, users.name, users.reputation, users.total_trades FROM ads JOIN users ON ads.user_id = users.id WHERE ads.status = 'active' AND ads.expires_at > datetime('now') AND ads.type = ? ORDER BY ads.created_at DESC", [type]) },
  getById: { get: (id) => get('SELECT ads.*, users.name, users.telegram_id as owner_telegram_id FROM ads JOIN users ON ads.user_id = users.id WHERE ads.id = ?', [id]) },
  getByUser: { all: (userId) => all("SELECT * FROM ads WHERE user_id = ? AND status IN ('active') ORDER BY created_at DESC", [userId]) },
  expire: { run: () => run("UPDATE ads SET status = 'expired' WHERE status = 'active' AND expires_at <= datetime('now')") },
  cancel: { run: (id, userId) => run("UPDATE ads SET status = 'cancelled' WHERE id = ? AND user_id = ?", [id, userId]) },
  delete: { run: (id) => run('DELETE FROM ads WHERE id = ?', [id]) },
  complete: { run: (id) => run("UPDATE ads SET status = 'completed' WHERE id = ?", [id]) },
};

// ─── Trade Queries ────────────────────────────────────────────────────────────
const tradeQueries = {
  create: { run: (adId, buyerId, sellerId, crypto, amount, price, totalEtb, method) => run('INSERT INTO trades (ad_id, buyer_id, seller_id, crypto, amount, price_per_unit, total_etb, payment_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [adId, buyerId, sellerId, crypto, amount, price, totalEtb, method]) },
  getById: { get: (id) => get(`SELECT trades.*, b.name as buyer_name, b.telegram_id as buyer_telegram_id, s.name as seller_name, s.telegram_id as seller_telegram_id FROM trades JOIN users b ON trades.buyer_id = b.id JOIN users s ON trades.seller_id = s.id WHERE trades.id = ?`, [id]) },
  getByUser: { all: (userId) => all(`SELECT trades.*, b.name as buyer_name, s.name as seller_name FROM trades JOIN users b ON trades.buyer_id = b.id JOIN users s ON trades.seller_id = s.id WHERE (trades.buyer_id = ? OR trades.seller_id = ?) AND trades.status IN ('pending', 'buyer_confirmed', 'seller_confirmed', 'disputed') ORDER BY trades.created_at DESC`, [userId, userId]) },
  buyerConfirm: { run: (id) => run("UPDATE trades SET status = 'buyer_confirmed' WHERE id = ? AND status = 'pending'", [id]) },
  sellerConfirm: { run: (id) => run("UPDATE trades SET status = 'seller_confirmed' WHERE id = ? AND status = 'buyer_confirmed'", [id]) },
  complete: { run: (id) => run("UPDATE trades SET status = 'completed', completed_at = datetime('now') WHERE id = ?", [id]) },
  dispute: { run: (reason, id) => run("UPDATE trades SET status = 'disputed', dispute_reason = ? WHERE id = ? AND status IN ('pending','buyer_confirmed','seller_confirmed')", [reason, id]) },
  cancel: { run: (id) => run("UPDATE trades SET status = 'cancelled' WHERE id = ?", [id]) },
  expireOld: { run: () => run("UPDATE trades SET status = 'expired' WHERE status IN ('pending','buyer_confirmed','seller_confirmed') AND expires_at <= datetime('now')") },
  getDisputed: { all: () => all(`SELECT trades.*, b.name as buyer_name, b.telegram_id as buyer_telegram_id, s.name as seller_name, s.telegram_id as seller_telegram_id FROM trades JOIN users b ON trades.buyer_id = b.id JOIN users s ON trades.seller_id = s.id WHERE trades.status = 'disputed'`) },
  getAll: { all: () => all(`SELECT trades.*, b.name as buyer_name, s.name as seller_name FROM trades JOIN users b ON trades.buyer_id = b.id JOIN users s ON trades.seller_id = s.id ORDER BY trades.created_at DESC LIMIT 50`) },
  statsToday: { get: () => get("SELECT COUNT(*) as count, SUM(total_etb) as volume FROM trades WHERE status = 'completed' AND DATE(completed_at) = DATE('now')") },
  statsWeek: { get: () => get("SELECT COUNT(*) as count, SUM(total_etb) as volume FROM trades WHERE status = 'completed' AND completed_at >= datetime('now', '-7 days')") },
  statsMonth: { get: () => get("SELECT COUNT(*) as count, SUM(total_etb) as volume FROM trades WHERE status = 'completed' AND completed_at >= datetime('now', '-30 days')") },
  popularCrypto: { get: () => get("SELECT crypto, COUNT(*) as cnt FROM trades WHERE status = 'completed' GROUP BY crypto ORDER BY cnt DESC LIMIT 1") },
  popularPayment: { get: () => get("SELECT payment_method, COUNT(*) as cnt FROM trades WHERE status = 'completed' GROUP BY payment_method ORDER BY cnt DESC LIMIT 1") },
};

// ─── Feedback Queries ─────────────────────────────────────────────────────────
const feedbackQueries = {
  create: { run: (tradeId, fromId, toId, rating, comment) => run('INSERT INTO feedback (trade_id, from_user_id, to_user_id, rating, comment) VALUES (?, ?, ?, ?, ?)', [tradeId, fromId, toId, rating, comment]) },
  exists: { get: (tradeId, fromId) => get('SELECT id FROM feedback WHERE trade_id = ? AND from_user_id = ?', [tradeId, fromId]) },
  getForUser: { all: (userId) => all('SELECT feedback.*, users.name as from_name FROM feedback JOIN users ON feedback.from_user_id = users.id WHERE feedback.to_user_id = ? ORDER BY feedback.created_at DESC LIMIT 5', [userId]) },
};

// ─── Message Queries ──────────────────────────────────────────────────────────
const messageQueries = {
  create: { run: (tradeId, fromId, message) => run('INSERT INTO trade_messages (trade_id, from_user_id, message) VALUES (?, ?, ?)', [tradeId, fromId, message]) },
  getByTrade: { all: (tradeId) => all('SELECT trade_messages.*, users.name FROM trade_messages JOIN users ON trade_messages.from_user_id = users.id WHERE trade_messages.trade_id = ? ORDER BY trade_messages.created_at ASC LIMIT 20', [tradeId]) },
};

// ─── Session Queries ──────────────────────────────────────────────────────────
const sessionQueries = {
  get: { get: (tid) => get('SELECT * FROM user_sessions WHERE telegram_id = ?', [tid]) },
  set: { run: (tid, state, data) => run("INSERT OR REPLACE INTO user_sessions (telegram_id, state, data, updated_at) VALUES (?, ?, ?, datetime('now'))", [tid, state, data]) },
  clear: { run: (tid) => run('DELETE FROM user_sessions WHERE telegram_id = ?', [tid]) },
};

module.exports = {
  initDatabase,
  save,
  userQueries,
  paymentQueries,
  adQueries,
  tradeQueries,
  feedbackQueries,
  messageQueries,
  sessionQueries,
};
