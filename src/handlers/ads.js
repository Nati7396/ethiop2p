const { Markup } = require('telegraf');
const { adQueries, userQueries } = require('../database');
const { getSession, setSession, clearSession } = require('../sessions');
const { getOrCreateUser, isWhitelisted, formatAd, formatETB, escMd, CRYPTOS, PAYMENT_METHODS } = require('../helpers');

async function handlePostAd(ctx) {
  const user = getOrCreateUser(ctx);
  if (!isWhitelisted(user)) return ctx.reply('⛔ You are not whitelisted. Contact admin to get access.');

  const payInfo = require('../database').paymentQueries.get.get(user.id);
  if (!payInfo || (!payInfo.bank_name && !payInfo.telebirr_number && !payInfo.mpesa_number)) {
    return ctx.reply('⚠️ Please set your payment info first with /payment before posting an ad.');
  }

  setSession(ctx.from.id, 'post_ad_type', {});
  await ctx.reply('📢 *Create a New Ad*\n\nAre you looking to buy or sell crypto?', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🟢 BUY Crypto', 'ad_type_buy'), Markup.button.callback('🔴 SELL Crypto', 'ad_type_sell')],
      [Markup.button.callback('❌ Cancel', 'cancel_flow')],
    ]),
  });
}

async function handleAdTypeSelect(ctx, type) {
  const user = getOrCreateUser(ctx);
  setSession(ctx.from.id, 'post_ad_crypto', { type });
  await ctx.editMessageText(`✅ Type: *${type.toUpperCase()}*\n\nSelect cryptocurrency:`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      CRYPTOS.map(c => Markup.button.callback(c, `ad_crypto_${c}`)),
      [Markup.button.callback('❌ Cancel', 'cancel_flow')],
    ]),
  });
}

async function handleAdCryptoSelect(ctx, crypto) {
  const sess = getSession(ctx.from.id);
  setSession(ctx.from.id, 'post_ad_amount', { ...sess.data, crypto });
  await ctx.editMessageText(`✅ Crypto: *${crypto}*\n\nEnter the *amount* of ${crypto} to trade:`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'cancel_flow')]]),
  });
}

async function handleAdPaymentSelect(ctx, method) {
  const sess = getSession(ctx.from.id);
  const selected = sess.data.payment_methods || [];
  const idx = selected.indexOf(method);
  if (idx === -1) selected.push(method);
  else selected.splice(idx, 1);

  setSession(ctx.from.id, 'post_ad_payment', { ...sess.data, payment_methods: selected });

  const buttons = PAYMENT_METHODS.map(m => {
    const checked = selected.includes(m) ? '✅ ' : '';
    return Markup.button.callback(`${checked}${m}`, `ad_pay_${m}`);
  });

  await ctx.editMessageText(`Select payment methods (tap to toggle):\n\nSelected: ${selected.length ? selected.join(', ') : 'None'}`, {
    ...Markup.inlineKeyboard([
      buttons,
      [Markup.button.callback('✅ Done', 'ad_pay_done'), Markup.button.callback('❌ Cancel', 'cancel_flow')],
    ]),
  });
}

async function handleAdPaymentDone(ctx) {
  const sess = getSession(ctx.from.id);
  if (!sess.data.payment_methods || sess.data.payment_methods.length === 0) {
    return ctx.answerCbQuery('Please select at least one payment method!', { show_alert: true });
  }
  setSession(ctx.from.id, 'post_ad_note', sess.data);
  await ctx.editMessageText('📝 Add an optional note for your ad (or tap Skip):\n\nExample: "Only morning trades", "CBE preferred"', {
    ...Markup.inlineKeyboard([
      [Markup.button.callback('⏭️ Skip', 'ad_note_skip'), Markup.button.callback('❌ Cancel', 'cancel_flow')],
    ]),
  });
}

async function handleAds(ctx) {
  const user = getOrCreateUser(ctx);
  if (!isWhitelisted(user)) return ctx.reply('⛔ You are not whitelisted.');

  await ctx.reply('🔍 *Browse Ads*\n\nFilter by:', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📋 All Active', 'filter_all'), Markup.button.callback('🟢 Buy Ads', 'filter_buy'), Markup.button.callback('🔴 Sell Ads', 'filter_sell')],
      CRYPTOS.map(c => Markup.button.callback(c, `filter_crypto_${c}`)),
    ]),
  });
}

async function showFilteredAds(ctx, ads, label) {
  if (ads.length === 0) {
    return ctx.editMessageText(`No ${label} ads found right now.`);
  }

  const chunks = [];
  for (let i = 0; i < Math.min(ads.length, 10); i++) {
    const ad = ads[i];
    chunks.push({
      text: formatAd(ad),
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback(`💬 Trade with #${ad.id}`, `trade_ad_${ad.id}`)],
      ]),
    });
  }

  await ctx.editMessageText(`📋 *${label}* — ${ads.length} ad(s) found:`, { parse_mode: 'Markdown' });
  for (const chunk of chunks) {
    await ctx.reply(chunk.text, { parse_mode: 'Markdown', ...chunk.keyboard });
  }
}

async function handleMyAds(ctx) {
  const user = getOrCreateUser(ctx);
  if (!isWhitelisted(user)) return ctx.reply('⛔ You are not whitelisted.');

  const ads = adQueries.getByUser.all(user.id);
  if (ads.length === 0) return ctx.reply('You have no active ads. Use /post to create one.');

  await ctx.reply(`📁 *Your Active Ads* (${ads.length}):`, { parse_mode: 'Markdown' });
  for (const ad of ads) {
    await ctx.reply(formatAd(ad), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancel Ad', `cancel_ad_${ad.id}`)],
      ]),
    });
  }
}

module.exports = {
  handlePostAd,
  handleAdTypeSelect,
  handleAdCryptoSelect,
  handleAdPaymentSelect,
  handleAdPaymentDone,
  handleAds,
  showFilteredAds,
  handleMyAds,
};
