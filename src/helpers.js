const { userQueries, paymentQueries, feedbackQueries } = require('./database');

const CRYPTOS = ['USDT', 'BTC', 'ETH'];
const PAYMENT_METHODS = ['Bank', 'Telebirr', 'M-Pesa'];

function getOrCreateUser(ctx) {
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
  return `${Number(amount).toLocaleString('en-ET', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB`;
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

function formatUserProfile(user) {
  const reviews = feedbackQueries.getForUser.all(user.id);
  const reviewText = reviews.length === 0 ? 'No reviews yet.' : reviews.map(r => {
    const icon = r.rating === 1 ? '✅' : r.rating === -1 ? '❌' : '⚪';
    return `${icon} ${r.from_name}: ${r.comment || '(no comment)'}`;
  }).join('\n');

  return `
👤 *Profile: ${escMd(user.name)}*
${user.username ? `@${escMd(user.username)}` : ''}

📊 *Reputation:* ${getRepLevel(user)} ${getStarRating(user)}
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
  const pct = ad.total_trades > 0 ? Math.round((ad.reputation / ad.total_trades) * 100) : 0;
  return `
${type} *${formatCrypto(ad.crypto, ad.amount)}*
💱 Price: *${formatETB(ad.price_per_unit)}* per ${ad.crypto}
💵 Total: *${formatETB(ad.amount * ad.price_per_unit)}*
💳 Payment: ${methods}
👤 Trader: ${escMd(ad.name)} (${ad.total_trades} trades, ${pct}% positive)
${ad.note ? `📝 Note: ${escMd(ad.note)}` : ''}
🆔 Ad #${ad.id}
`.trim();
}

function formatTrade(trade) {
  const statusIcons = {
    pending: '⏳ Pending',
    buyer_confirmed: '✅ Buyer Confirmed',
    seller_confirmed: '✅ Seller Confirmed',
    completed: '🎉 Completed',
    disputed: '⚠️ Disputed',
    cancelled: '❌ Cancelled',
    expired: '💨 Expired',
  };
  return `
🔄 *Trade #${trade.id}*
💰 ${formatCrypto(trade.crypto, trade.amount)} @ ${formatETB(trade.price_per_unit)}
💵 Total: *${formatETB(trade.total_etb)}*
💳 Payment: ${trade.payment_method}
🛒 Buyer: ${escMd(trade.buyer_name)}
💰 Seller: ${escMd(trade.seller_name)}
📊 Status: ${statusIcons[trade.status] || trade.status}
`.trim();
}

function formatPaymentInfo(info) {
  if (!info) return 'No payment info set.';
  const lines = [];
  if (info.bank_name) lines.push(`🏦 Bank: ${info.bank_name}\n   Account: ${info.bank_account}\n   Name: ${info.bank_account_name}`);
  if (info.telebirr_number) lines.push(`📱 Telebirr: ${info.telebirr_number}`);
  if (info.mpesa_number) lines.push(`📱 M-Pesa: ${info.mpesa_number}`);
  return lines.length ? lines.join('\n') : 'No payment details saved.';
}

function escMd(text) {
  if (!text) return '';
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📋 Browse Ads', callback_data: 'browse_ads' }, { text: '📢 Post Ad', callback_data: 'post_ad' }],
      [{ text: '📁 My Ads', callback_data: 'my_ads' }, { text: '👤 My Profile', callback_data: 'my_profile' }],
      [{ text: '💳 Payment Info', callback_data: 'payment_info' }, { text: '📊 Stats', callback_data: 'stats' }],
    ]
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
  formatUserProfile,
  formatAd,
  formatTrade,
  formatPaymentInfo,
  escMd,
  mainMenuKeyboard,
};
