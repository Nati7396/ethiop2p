const { Markup } = require('telegraf');
const { adQueries, paymentQueries } = require('../database');
const { getSession, setSession, clearSession } = require('../sessions');
const { getOrCreateUser, isWhitelisted, formatAd, formatETB, escMd, CRYPTOS, PAYMENT_METHODS } = require('../helpers');

async function handlePostAd(ctx) {
  const user = getOrCreateUser(ctx);
  if (!isWhitelisted(user)) return ctx.reply('⛔ You are not whitelisted\\. Contact admin to get access\\.', { parse_mode: 'MarkdownV2' });

  const payInfo = paymentQueries.get.get(user.id);
  if (!payInfo || (!payInfo.bank_name && !payInfo.telebirr_number && !payInfo.mpesa_number)) {
    return ctx.reply(
      '⚠️ Please set your payment info first\\.\n\nTap *💳 Payment Info* in the menu below\\.', {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard([[Markup.button.callback('💳 Set Payment Info', 'payment_info')]]),
      }
    );
  }

  setSession(ctx.from.id, 'post_ad_type', {});
  await ctx.reply(
    '📢 *Create a New Ad*\n\nAre you looking to buy or sell crypto\\?',
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🟢 BUY Crypto', 'ad_type_buy'), Markup.button.callback('🔴 SELL Crypto', 'ad_type_sell')],
        [Markup.button.callback('❌ Cancel', 'cancel_flow')],
      ]),
    }
  );
}

async function handleAdTypeSelect(ctx, type) {
  const sess = getSession(ctx.from.id);
  setSession(ctx.from.id, 'post_ad_crypto', { ...sess.data, type });
  await ctx.editMessageText(
    `✅ Type: *${type === 'buy' ? '🟢 BUY' : '🔴 SELL'}*\n\nSelect cryptocurrency:`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        CRYPTOS.map(c => Markup.button.callback(c, `ad_crypto_${c}`)),
        [Markup.button.callback('❌ Cancel', 'cancel_flow')],
      ]),
    }
  );
}

async function handleAdCryptoSelect(ctx, crypto) {
  const sess = getSession(ctx.from.id);
  setSession(ctx.from.id, 'post_ad_amount', { ...sess.data, crypto });
  await ctx.editMessageText(
    `✅ Crypto: *${crypto}*\n\nEnter the *amount* of ${crypto} to trade:`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'cancel_flow')]]),
    }
  );
}

async function handleAdPaymentSelect(ctx, method) {
  const sess = getSession(ctx.from.id);
  if (sess.state !== 'post_ad_payment' && sess.state !== 'post_ad_price') return ctx.answerCbQuery();
  const selected = sess.data.payment_methods || [];
  const idx = selected.indexOf(method);
  if (idx === -1) selected.push(method); else selected.splice(idx, 1);

  setSession(ctx.from.id, 'post_ad_payment', { ...sess.data, payment_methods: selected });

  const buttons = PAYMENT_METHODS.map(m => {
    const checked = selected.includes(m) ? '✅ ' : '';
    return Markup.button.callback(`${checked}${m}`, `ad_pay_${m}`);
  });

  await ctx.editMessageText(
    `💳 Select payment methods \\(tap to toggle\\):\n\nSelected: *${selected.length ? escMd(selected.join(', ')) : 'None'}*`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        buttons,
        [Markup.button.callback('✅ Confirm Selection', 'ad_pay_done'), Markup.button.callback('❌ Cancel', 'cancel_flow')],
      ]),
    }
  );
}

async function handleAdPaymentDone(ctx) {
  const sess = getSession(ctx.from.id);
  if (!sess.data.payment_methods || sess.data.payment_methods.length === 0) {
    return ctx.answerCbQuery('Please select at least one payment method!', { show_alert: true });
  }
  setSession(ctx.from.id, 'post_ad_note', sess.data);
  await ctx.editMessageText(
    '📝 Add an optional note \\(e\\.g\\. "CBE only", "Morning trades"\\) or skip:',
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('⏭️ Skip Note', 'ad_note_skip'), Markup.button.callback('❌ Cancel', 'cancel_flow')],
      ]),
    }
  );
}

async function handleAds(ctx) {
  const user = getOrCreateUser(ctx);
  if (!isWhitelisted(user)) return ctx.reply('⛔ You are not whitelisted\\.', { parse_mode: 'MarkdownV2' });

  await ctx.reply(
    '🔍 *Browse Ads*\n\nFilter by:',
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📋 All', 'filter_all'), Markup.button.callback('🟢 Buying', 'filter_buy'), Markup.button.callback('🔴 Selling', 'filter_sell')],
        CRYPTOS.map(c => Markup.button.callback(c, `filter_crypto_${c}`)),
      ]),
    }
  );
}

async function showFilteredAds(ctx, ads, label) {
  if (ads.length === 0) {
    return ctx.editMessageText(`No *${escMd(label)}* ads right now\\. Check back later\\!`, { parse_mode: 'MarkdownV2' });
  }

  await ctx.editMessageText(`📋 *${escMd(label)}* — ${ads.length} ad\\(s\\) found:`, { parse_mode: 'MarkdownV2' });

  const limit = Math.min(ads.length, 10);
  for (let i = 0; i < limit; i++) {
    const ad = ads[i];
    await ctx.reply(formatAd(ad), {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback(`💬 Start Trade with Ad #${ad.id}`, `trade_ad_${ad.id}`)],
      ]),
    });
  }
}

async function handleMyAds(ctx) {
  const user = getOrCreateUser(ctx);
  if (!isWhitelisted(user)) return ctx.reply('⛔ You are not whitelisted\\.', { parse_mode: 'MarkdownV2' });

  const ads = adQueries.getByUser.all(user.id);
  if (ads.length === 0) {
    return ctx.reply(
      '📁 You have no active ads\\.',
      {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard([[Markup.button.callback('📢 Post New Ad', 'post_ad')]]),
      }
    );
  }

  await ctx.reply(`📁 *Your Active Ads* \\(${ads.length}\\):`, { parse_mode: 'MarkdownV2' });
  for (const ad of ads) {
    await ctx.reply(
      formatAd({ ...ad, name: user.name, username: user.username, owner_telegram_id: user.telegram_id, total_trades: user.total_trades, positive_trades: user.positive_trades }),
      {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`❌ Cancel Ad #${ad.id}`, `cancel_ad_${ad.id}`)],
        ]),
      }
    );
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
