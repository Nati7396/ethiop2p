const CRYPTOS = ['USDT', 'BTC', 'ETH'];
const PAYMENT_METHODS = ['Bank', 'Telebirr', 'M-Pesa'];

function getOrCreateUser(ctx) {
  const { userQueries } = require('./database');
  const tgId = String(ctx.from.id);
  const adminId = process.env.ADMIN_TELEGRAM_ID;

  let user = userQueries.findByTelegramId.get(tgId);
  if (!user) {
    const isAdminUser = tgId === adminId ? 1 : 0;
    userQueries.create.run(tgId, ctx.from.first_name || ctx.from.username || 'Unknown', ctx.from.username || '', isAdminUser ? 1 : 0, isAdminUser);
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
  return `${parseFloat(amount).toFixed(2)} USDT`;
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
  if (!user.total_trades) return '☆☆☆☆☆';
  const pct = user.positive_trades / user.total_trades;
  const stars = Math.round(pct * 5);
  return '★'.repeat(Math.max(0, stars)) + '☆'.repeat(Math.max(0, 5 - stars));
}

function getPositivePct(user) {
  if (!user.total_trades) return '0%';
  return `${Math.round((user.positive_trades / user.total_trades) * 100)}%`;
}

function userTgLink(user) {
  const name = user.name || 'Unknown';
  if (user.username) return `[${escMd(name)}](https://t.me/${user.username})`;
  return `[${escMd(name)}](tg://user?id=${user.telegram_id})`;
}

function formatUserProfile(user) {
  const { feedbackQueries } = require('./database');
  const reviews = feedbackQueries.getForUser.all(user.id);
  const reviewText = reviews.length === 0
    ? '_No reviews yet\\._'
    : reviews.map(r => {
        const icon = r.rating === 1 ? '✅' : r.rating === -1 ? '❌' : '⚪';
        return `${icon} ${escMd(r.from_name)}: ${escMd(r.comment || '(no comment)')}`;
      }).join('\n');

  const tgLink = userTgLink(user);
  const joinDate = user.created_at ? new Date(user.created_at).toLocaleDateString('en-GB') : 'N/A';
  const hasPhone = user.phone_number ? `📱 \`${escMd(user.phone_number)}\`` : '_Not set_';

  return `👤 *${escMd(user.name)}* ${tgLink}
🆔 TG ID: \`${user.telegram_id}\`
📅 Joined: ${escMd(joinDate)}

📊 *Level:* ${escMd(getRepLevel(user))} ${getStarRating(user)}
🔢 *Total Trades:* ${user.total_trades}
👍 *Positive Rate:* ${getPositivePct(user)}
💰 *Trade Limit:* ${escMd(formatETB(user.trade_limit))}
📞 *Phone:* ${hasPhone}

📝 *Recent Reviews:*
${reviewText}`;
}

function formatAd(ad) {
  let methods = [];
  try { methods = JSON.parse(ad.payment_methods || '[]'); } catch (_) { methods = []; }

  const type = ad.type === 'buy' ? '🟢 BUY' : '🔴 SELL';
  const total = (ad.amount || 0) * (ad.price_per_unit || 0);
  const pct = ad.total_trades > 0
    ? Math.round(((ad.positive_trades || 0) / ad.total_trades) * 100)
    : 0;

  const traderLink = ad.username
    ? `[${escMd(ad.name || 'Unknown')}](https://t.me/${ad.username})`
    : `[${escMd(ad.name || 'Unknown')}](tg://user?id=${ad.owner_telegram_id || ''})`;

  const joinDate = ad.user_created_at
    ? new Date(ad.user_created_at).toLocaleDateString('en-GB')
    : 'N/A';

  const repIcon = ad.total_trades >= 11 && pct >= 90 ? '⭐' : ad.total_trades >= 3 && pct >= 80 ? '✅' : '🆕';

  const noteStr = ad.note ? `\n📝 _${escMd(ad.note)}_` : '';

  return `${type} *${escMd(formatCrypto(ad.crypto, ad.amount))}*
💱 Price: *${escMd(formatETB(ad.price_per_unit))}* per ${ad.crypto}
💵 Total: *${escMd(formatETB(total))}*
💳 Payment: ${escMd(methods.join(', '))}
👤 Trader: ${traderLink} ${repIcon}
📊 ${ad.total_trades} trades \\| ${pct}% positive
🆔 TG ID: \`${ad.owner_telegram_id || ''}\`
📅 Member since: ${escMd(joinDate)}${noteStr}
🔖 Ad \\#${ad.id}`;
}

function formatPaymentInfo(info) {
  if (!info) return '_No payment info set\\._';
  const lines = [];
  if (info.bank_name) lines.push(`🏦 *Bank:* ${escMd(info.bank_name)}\n   Account: \`${escMd(info.bank_account || '')}\`\n   Name: ${escMd(info.bank_account_name || '')}`);
  if (info.telebirr_number) lines.push(`📱 *Telebirr:* \`${escMd(info.telebirr_number)}\``);
  if (info.mpesa_number) lines.push(`📱 *M\\-Pesa:* \`${escMd(info.mpesa_number)}\``);
  return lines.length ? lines.join('\n') : '_No payment details saved\\._';
}

function escMd(text) {
  if (text === null || text === undefined) return '';
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

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

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📢 Post Ad', callback_data: 'post_ad' }, { text: '📋 Browse Ads', callback_data: 'browse_ads' }],
      [{ text: '📁 My Ads', callback_data: 'my_ads' }, { text: '👤 My Profile', callback_data: 'my_profile' }],
      [{ text: '💳 Payment Info', callback_data: 'payment_info' }, { text: '📊 Stats', callback_data: 'stats' }],
    ],
  };
}

module.exports = {
  CRYPTOS, PAYMENT_METHODS,
  getOrCreateUser, isWhitelisted, isAdmin,
  formatCrypto, formatETB, getRepLevel, getStarRating, getPositivePct,
  userTgLink, formatUserProfile, formatAd, formatPaymentInfo,
  escMd, mainReplyKeyboard, mainMenuKeyboard,
};
