const { paymentQueries, feedbackQueries } = require('./database');

const CRYPTOS = ['USDT', 'BTC', 'ETH'];
const PAYMENT_METHODS = ['Bank', 'Telebirr', 'M-Pesa'];

function getOrCreateUser(ctx) {
  const { userQueries } = require('./database');
  const tgId = String(ctx.from.id);
  const adminId = process.env.ADMIN_TELEGRAM_ID;

  let user = userQueries.findByTelegramId.get(tgId);
  if (!user) {
    const isAdmin = tgId === adminId ? 1 : 0;
    userQueries.create.run(tgId, ctx.from.first_name || ctx.from.username || 'Unknown', ctx.from.username || '', isAdmin ? 1 : 0, isAdmin);
    user = userQueries.findByTelegramId.get(tgId);
  } else {
    userQueries.update.run(ctx.from.first_name || user.name, ctx.from.username || user.username || '', tgId);
    user = userQueries.findByTelegramId.get(tgId);
  }
  return user;
}

function isWhitelisted(user) {
  return user && (user.is_whitelisted === 1 || user.is_admin === 1);
}

function isAdmin(user) {
  return user && user.is_admin === 1;
}

function formatCrypto(crypto, amount) {
  if (crypto === 'BTC') return `${parseFloat(amount).toFixed(6)} BTC`;
  if (crypto === 'ETH') return `${parseFloat(amount).toFixed(4)} ETH`;
  return `${parseFloat(amount).toFixed(2)} ${crypto}`;
}

function formatETB(amount) {
  return `${Number(amount || 0).toLocaleString('en-ET', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB`;
}

function getRepLevel(user) {
  if (user.total_trades >= 11 && user.total_trades > 0 && (user.positive_trades / user.total_trades) >= 0.9) return '⭐ Trusted';
  if (user.total_trades >= 3 && user.total_trades > 0 && (user.positive_trades / user.total_trades) >= 0.8) return '✅ Verified';
  return '🆕 New';
}

function getStarRating(user) {
  if (user.total_trades === 0) return '☆☆☆☆☆';
  const pct = user.positive_trades / user.total_trades;
  const stars = Math.round(pct * 5);
  return '★'.repeat(stars) + '☆'.repeat(5 - stars);
}

function getPositivePct(user) {
  if (user.total_trades === 0) return '0%';
  return `${Math.round((user.positive_trades / user.total_trades) * 100)}%`;
}

// Build a Telegram profile link for a user
function profileLink(user) {
  if (user.username) return `[${escMd(user.name)}](https://t.me/${user.username})`;
  return `[${escMd(user.name)}](tg://user?id=${user.telegram_id})`;
}

function formatUserProfile(user) {
  const { feedbackQueries } = require('./database');
  const reviews = feedbackQueries.getForUser.all(user.id);
  const reviewText = reviews.length === 0 ? '_No reviews yet._' : reviews.map(r => {
    const icon = r.rating === 1 ? '✅' : r.rating === -1 ? '❌' : '⚪';
    return `${icon} ${escMd(r.from_name)}: ${escMd(r.comment || '(no comment)')}`;
  }).join('\n');

  const tgLink = user.username ? `[@${user.username}](https://t.me/${user.username})` : `[Profile](tg://user?id=${user.telegram_id})`;

  return `
👤 *${escMd(user.name)}* ${tgLink}

📊 *Level:* ${getRepLevel(user)} ${getStarRating(user)}
🔢 *Total Trades:* ${user.total_trades}
👍 *Positive Rate:* ${getPositivePct(user)}
💰 *Trade Limit:* ${formatETB(user.trade_limit)} per trade
📅 *Joined:* ${new Date(user.created_at).toLocaleDateString()}

📝 *Recent Reviews:*
${reviewText}
`.trim();
}

function formatAd(ad) {
  const methods = JSON.parse(ad.payment_methods || '[]').join(', ');
  const type = ad.type === 'buy' ? '🟢 BUY' : '🔴 SELL';
  const pct = ad.total_trades > 0 ? Math.round((ad.positive_trades || 0) / ad.total_trades * 100) : 0;
  const traderLink = ad.username ? `[${escMd(ad.name)}](https://t.me/${ad.username})` : `[${escMd(ad.name)}](tg://user?id=${ad.owner_telegram_id || ad.telegram_id})`;
  return `${type} *${formatCrypto(ad.crypto, ad.amount)}*
💱 Price: *${formatETB(ad.price_per_unit)}* per ${ad.crypto}
💵 Total: *${formatETB(ad.amount * ad.price_per_unit)}*
💳 Payment: ${methods}
👤 Trader: ${traderLink} \\(${ad.total_trades} trades, ${pct}% \\+\\)
${ad.note ? `📝 Note: ${escMd(ad.note)}` : ''}
🆔 Ad \\#${ad.id}`;
}

function formatTrade(trade) {
  const statusIcons = {
    pending: '⏳ Pending',
    buyer_confirmed: '✅ Buyer Confirmed — waiting for seller',
    seller_confirmed: '✅ Seller Confirmed',
    completed: '🎉 Completed',
    disputed: '⚠️ Disputed',
    cancelled: '❌ Cancelled',
    expired: '💨 Expired',
  };
  return `🔄 *Trade \\#${trade.id}*
💰 ${escMd(formatCrypto(trade.crypto, trade.amount))} @ ${escMd(formatETB(trade.price_per_unit))}
💵 Total: *${escMd(formatETB(trade.total_etb))}*
💳 Payment: ${escMd(trade.payment_method)}
🛒 Buyer: ${escMd(trade.buyer_name)}
💰 Seller: ${escMd(trade.seller_name)}
📊 Status: ${statusIcons[trade.status] || trade.status}`;
}

function formatPaymentInfo(info) {
  if (!info) return '_No payment info set\\._';
  const lines = [];
  if (info.bank_name) lines.push(`🏦 *Bank:* ${escMd(info.bank_name)}\n   Account: \`${escMd(info.bank_account)}\`\n   Name: ${escMd(info.bank_account_name)}`);
  if (info.telebirr_number) lines.push(`📱 *Telebirr:* \`${escMd(info.telebirr_number)}\``);
  if (info.mpesa_number) lines.push(`📱 *M\\-Pesa:* \`${escMd(info.mpesa_number)}\``);
  return lines.length ? lines.join('\n') : '_No payment details saved\\._';
}

function escMd(text) {
  if (text === null || text === undefined) return '';
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

// Persistent bottom keyboard — always visible
function mainReplyKeyboard() {
  return {
    keyboard: [
      ['📢 Post Ad', '📋 Browse Ads'],
      ['📁 My Ads', '👤 My Profile'],
      ['💳 Payment Info', '📊 Stats'],
    ],
    resize_keyboard: true,
    persistent: true,
  };
}

// Inline keyboard for main menu (used in messages)
function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📋 Browse Ads', callback_data: 'browse_ads' }, { text: '📢 Post Ad', callback_data: 'post_ad' }],
      [{ text: '📁 My Ads', callback_data: 'my_ads' }, { text: '👤 My Profile', callback_data: 'my_profile' }],
      [{ text: '💳 Payment Info', callback_data: 'payment_info' }, { text: '📊 Stats', callback_data: 'stats' }],
    ],
  };
}

module.exports = {
  CRYPTOS,
  PAYMENT_METHODS,
  getOrCreateUser,
  isWhitelisted,
  isAdmin,
  formatCrypto,
  formatETB,
  getRepLevel,
  getStarRating,
  getPositivePct,
  profileLink,
  formatUserProfile,
  formatAd,
  formatTrade,
  formatPaymentInfo,
  escMd,
  mainReplyKeyboard,
  mainMenuKeyboard,
};
