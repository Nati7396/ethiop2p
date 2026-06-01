const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'ethiop2p.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDatabase() {
  db.exec(`
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

  console.log('Database initialized');
}

// User queries
const userQueries = {
  findByTelegramId: db.prepare('SELECT * FROM users WHERE telegram_id = ?'),
  create: db.prepare(`
    INSERT INTO users (telegram_id, name, username, is_whitelisted, is_admin)
    VALUES (?, ?, ?, ?, ?)
  `),
  update: db.prepare('UPDATE users SET name = ?, username = ? WHERE telegram_id = ?'),
  whitelist: db.prepare('UPDATE users SET is_whitelisted = 1 WHERE telegram_id = ?'),
  unwhitelist: db.prepare('UPDATE users SET is_whitelisted = 0 WHERE telegram_id = ?'),
  setAdmin: db.prepare('UPDATE users SET is_admin = 1 WHERE telegram_id = ?'),
  setTradeLimit: db.prepare('UPDATE users SET trade_limit = ? WHERE id = ?'),
  updateReputation: db.prepare(`
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
  `),
  getAll: db.prepare('SELECT * FROM users ORDER BY total_trades DESC'),
  getAllWhitelisted: db.prepare('SELECT * FROM users WHERE is_whitelisted = 1'),
};

// Payment info queries
const paymentQueries = {
  get: db.prepare('SELECT * FROM payment_info WHERE user_id = ?'),
  upsert: db.prepare(`
    INSERT INTO payment_info (user_id, bank_name, bank_account, bank_account_name, telebirr_number, mpesa_number)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      bank_name = excluded.bank_name,
      bank_account = excluded.bank_account,
      bank_account_name = excluded.bank_account_name,
      telebirr_number = excluded.telebirr_number,
      mpesa_number = excluded.mpesa_number
  `),
};

// Ad queries
const adQueries = {
  create: db.prepare(`
    INSERT INTO ads (user_id, type, crypto, amount, price_per_unit, payment_methods, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  getActive: db.prepare("SELECT ads.*, users.name, users.reputation, users.total_trades FROM ads JOIN users ON ads.user_id = users.id WHERE ads.status = 'active' AND ads.expires_at > datetime('now') ORDER BY ads.created_at DESC"),
  getActiveFiltered: db.prepare("SELECT ads.*, users.name, users.reputation, users.total_trades FROM ads JOIN users ON ads.user_id = users.id WHERE ads.status = 'active' AND ads.expires_at > datetime('now') AND ads.type = ? AND ads.crypto = ? ORDER BY ads.created_at DESC"),
  getActiveByCrypto: db.prepare("SELECT ads.*, users.name, users.reputation, users.total_trades FROM ads JOIN users ON ads.user_id = users.id WHERE ads.status = 'active' AND ads.expires_at > datetime('now') AND ads.crypto = ? ORDER BY ads.created_at DESC"),
  getActiveByType: db.prepare("SELECT ads.*, users.name, users.reputation, users.total_trades FROM ads JOIN users ON ads.user_id = users.id WHERE ads.status = 'active' AND ads.expires_at > datetime('now') AND ads.type = ? ORDER BY ads.created_at DESC"),
  getById: db.prepare('SELECT ads.*, users.name, users.telegram_id as owner_telegram_id FROM ads JOIN users ON ads.user_id = users.id WHERE ads.id = ?'),
  getByUser: db.prepare("SELECT * FROM ads WHERE user_id = ? AND status IN ('active') ORDER BY created_at DESC"),
  expire: db.prepare("UPDATE ads SET status = 'expired' WHERE status = 'active' AND expires_at <= datetime('now')"),
  cancel: db.prepare("UPDATE ads SET status = 'cancelled' WHERE id = ? AND user_id = ?"),
  delete: db.prepare('DELETE FROM ads WHERE id = ?'),
  complete: db.prepare("UPDATE ads SET status = 'completed' WHERE id = ?"),
};

// Trade queries
const tradeQueries = {
  create: db.prepare(`
    INSERT INTO trades (ad_id, buyer_id, seller_id, crypto, amount, price_per_unit, total_etb, payment_method)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getById: db.prepare(`
    SELECT trades.*,
      b.name as buyer_name, b.telegram_id as buyer_telegram_id,
      s.name as seller_name, s.telegram_id as seller_telegram_id
    FROM trades
    JOIN users b ON trades.buyer_id = b.id
    JOIN users s ON trades.seller_id = s.id
    WHERE trades.id = ?
  `),
  getByUser: db.prepare(`
    SELECT trades.*,
      b.name as buyer_name, s.name as seller_name
    FROM trades
    JOIN users b ON trades.buyer_id = b.id
    JOIN users s ON trades.seller_id = s.id
    WHERE (trades.buyer_id = ? OR trades.seller_id = ?)
    AND trades.status IN ('pending', 'buyer_confirmed', 'seller_confirmed', 'disputed')
    ORDER BY trades.created_at DESC
  `),
  buyerConfirm: db.prepare("UPDATE trades SET status = 'buyer_confirmed' WHERE id = ? AND status = 'pending'"),
  sellerConfirm: db.prepare("UPDATE trades SET status = 'seller_confirmed' WHERE id = ? AND status = 'buyer_confirmed'"),
  complete: db.prepare("UPDATE trades SET status = 'completed', completed_at = datetime('now') WHERE id = ?"),
  dispute: db.prepare("UPDATE trades SET status = 'disputed', dispute_reason = ? WHERE id = ? AND status IN ('pending','buyer_confirmed','seller_confirmed')"),
  cancel: db.prepare("UPDATE trades SET status = 'cancelled' WHERE id = ?"),
  expireOld: db.prepare("UPDATE trades SET status = 'expired' WHERE status IN ('pending','buyer_confirmed','seller_confirmed') AND expires_at <= datetime('now')"),
  getDisputed: db.prepare(`
    SELECT trades.*,
      b.name as buyer_name, b.telegram_id as buyer_telegram_id,
      s.name as seller_name, s.telegram_id as seller_telegram_id
    FROM trades
    JOIN users b ON trades.buyer_id = b.id
    JOIN users s ON trades.seller_id = s.id
    WHERE trades.status = 'disputed'
  `),
  getAll: db.prepare(`
    SELECT trades.*,
      b.name as buyer_name, s.name as seller_name
    FROM trades
    JOIN users b ON trades.buyer_id = b.id
    JOIN users s ON trades.seller_id = s.id
    ORDER BY trades.created_at DESC LIMIT 50
  `),
  statsToday: db.prepare("SELECT COUNT(*) as count, SUM(total_etb) as volume FROM trades WHERE status = 'completed' AND DATE(completed_at) = DATE('now')"),
  statsWeek: db.prepare("SELECT COUNT(*) as count, SUM(total_etb) as volume FROM trades WHERE status = 'completed' AND completed_at >= datetime('now', '-7 days')"),
  statsMonth: db.prepare("SELECT COUNT(*) as count, SUM(total_etb) as volume FROM trades WHERE status = 'completed' AND completed_at >= datetime('now', '-30 days')"),
  popularCrypto: db.prepare("SELECT crypto, COUNT(*) as cnt FROM trades WHERE status = 'completed' GROUP BY crypto ORDER BY cnt DESC LIMIT 1"),
  popularPayment: db.prepare("SELECT payment_method, COUNT(*) as cnt FROM trades WHERE status = 'completed' GROUP BY payment_method ORDER BY cnt DESC LIMIT 1"),
};

// Feedback queries
const feedbackQueries = {
  create: db.prepare('INSERT INTO feedback (trade_id, from_user_id, to_user_id, rating, comment) VALUES (?, ?, ?, ?, ?)'),
  exists: db.prepare('SELECT id FROM feedback WHERE trade_id = ? AND from_user_id = ?'),
  getForUser: db.prepare('SELECT feedback.*, users.name as from_name FROM feedback JOIN users ON feedback.from_user_id = users.id WHERE feedback.to_user_id = ? ORDER BY feedback.created_at DESC LIMIT 5'),
};

// Trade message queries
const messageQueries = {
  create: db.prepare('INSERT INTO trade_messages (trade_id, from_user_id, message) VALUES (?, ?, ?)'),
  getByTrade: db.prepare('SELECT trade_messages.*, users.name FROM trade_messages JOIN users ON trade_messages.from_user_id = users.id WHERE trade_messages.trade_id = ? ORDER BY trade_messages.created_at ASC LIMIT 20'),
};

// Session queries
const sessionQueries = {
  get: db.prepare('SELECT * FROM user_sessions WHERE telegram_id = ?'),
  set: db.prepare('INSERT OR REPLACE INTO user_sessions (telegram_id, state, data, updated_at) VALUES (?, ?, ?, datetime(\'now\'))'),
  clear: db.prepare('DELETE FROM user_sessions WHERE telegram_id = ?'),
};

module.exports = {
  db,
  initDatabase,
  userQueries,
  paymentQueries,
  adQueries,
  tradeQueries,
  feedbackQueries,
  messageQueries,
  sessionQueries,
};
