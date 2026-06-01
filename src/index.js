require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { initDatabase, userQueries, adQueries, tradeQueries, paymentQueries, feedbackQueries, messageQueries } = require('./database');
const { getOrCreateUser, isWhitelisted, isAdmin, formatUserProfile, formatAd, formatETB, formatPaymentInfo, escMd, mainMenuKeyboard, CRYPTOS, PAYMENT_METHODS } = require('./helpers');
const { getSession, setSession, clearSession } = require('./sessions');
const { startCronJobs } = require('./cron');

const { handlePostAd, handleAdTypeSelect, handleAdCryptoSelect, handleAdPaymentSelect, handleAdPaymentDone, handleAds, showFilteredAds, handleMyAds } = require('./handlers/ads');
const { handleInitiateTrade, handlePaymentMethodSelect, handleBuyerConfirm, handleSellerConfirm, handleDispute, handleCancelTrade, handleRating, handleTradeChat } = require('./handlers/trades');
const { handleAdmin, handleAdminUsers, handleAdminTrades, handleAdminDisputes, handleResolveDispute, handleAdminAds, handleWhitelistPrompt, handleBroadcastPrompt, sendBroadcast } = require('./handlers/admin');
const { handlePayment, handleSetBank, handleSetTelebirr, handleSetMpesa } = require('./handlers/payment');
const { handleStats } = require('./handlers/stats');

async function main() {
  await initDatabase();

  const bot = new Telegraf(process.env.BOT_TOKEN);

  startCronJobs(bot);

  // ─── /start ─────────────────────────────────────────────────────────────────
  bot.command('start', async (ctx) => {
    const user = getOrCreateUser(ctx);

    if (!isWhitelisted(user)) {
      return ctx.reply(
        `👋 Welcome to *EthioP2P — Crypto Ad Center!*\n\n` +
        `This is an invite-only P2P trading platform for Ethiopian users.\n\n` +
        `⛔ You are not yet whitelisted. Please contact an admin to get access.\n\n` +
        `Your Telegram ID: \`${ctx.from.id}\``,
        { parse_mode: 'Markdown' }
      );
    }

    await ctx.reply(
      `🇪🇹 *Welcome to EthioP2P — Crypto Ad Center!*\n\n` +
      `Your P2P marketplace for crypto trading in Ethiopia.\n` +
      `All prices in Ethiopian Birr (ETB).\n\n` +
      `Payment methods: 🏦 Bank · 📱 Telebirr · 📱 M-Pesa`,
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }
    );
  });

  // ─── Commands ───────────────────────────────────────────────────────────────
  bot.command('post', handlePostAd);
  bot.command('ads', handleAds);
  bot.command('myads', handleMyAds);
  bot.command('payment', handlePayment);
  bot.command('stats', handleStats);
  bot.command('admin', handleAdmin);

  bot.command('profile', async (ctx) => {
    const user = getOrCreateUser(ctx);
    if (!isWhitelisted(user)) return ctx.reply('⛔ Not whitelisted.');
    await ctx.reply(formatUserProfile(user), { parse_mode: 'Markdown' });
  });

  bot.command('tradechat', async (ctx) => {
    const args = ctx.message.text.split(' ');
    const tradeId = parseInt(args[1]);
    if (!tradeId) return ctx.reply('Usage: /tradechat <trade_id>');
    await handleTradeChat(ctx, tradeId);
  });

  // ─── Callback Queries ────────────────────────────────────────────────────────
  bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;

    try {
      if (data === 'cancel_flow') {
        clearSession(ctx.from.id);
        await ctx.editMessageText('❌ Cancelled.');
        return ctx.answerCbQuery();
      }

      if (data === 'browse_ads') { await ctx.answerCbQuery(); return handleAds(ctx); }
      if (data === 'post_ad') { await ctx.answerCbQuery(); return handlePostAd(ctx); }
      if (data === 'my_ads') { await ctx.answerCbQuery(); return handleMyAds(ctx); }
      if (data === 'payment_info') { await ctx.answerCbQuery(); return handlePayment(ctx); }
      if (data === 'stats') { await ctx.answerCbQuery(); return handleStats(ctx); }
      if (data === 'my_profile') {
        const user = getOrCreateUser(ctx);
        await ctx.answerCbQuery();
        return ctx.reply(formatUserProfile(user), { parse_mode: 'Markdown' });
      }

      if (data === 'ad_type_buy') return handleAdTypeSelect(ctx, 'buy');
      if (data === 'ad_type_sell') return handleAdTypeSelect(ctx, 'sell');

      for (const c of CRYPTOS) {
        if (data === `ad_crypto_${c}`) return handleAdCryptoSelect(ctx, c);
      }

      for (const m of PAYMENT_METHODS) {
        if (data === `ad_pay_${m}`) return handleAdPaymentSelect(ctx, m);
      }
      if (data === 'ad_pay_done') return handleAdPaymentDone(ctx);
      if (data === 'ad_note_skip') {
        const sess = getSession(ctx.from.id);
        return finishPostAd(ctx, sess.data, null);
      }

      if (data === 'filter_all') {
        const ads = adQueries.getActive.all();
        return showFilteredAds(ctx, ads, 'All Active');
      }
      if (data === 'filter_buy') {
        const ads = adQueries.getActiveByType.all('buy');
        return showFilteredAds(ctx, ads, 'Buy');
      }
      if (data === 'filter_sell') {
        const ads = adQueries.getActiveByType.all('sell');
        return showFilteredAds(ctx, ads, 'Sell');
      }
      for (const c of CRYPTOS) {
        if (data === `filter_crypto_${c}`) {
          const ads = adQueries.getActiveByCrypto.all(c);
          return showFilteredAds(ctx, ads, c);
        }
      }

      if (data.startsWith('cancel_ad_')) {
        const adId = parseInt(data.replace('cancel_ad_', ''));
        const user = getOrCreateUser(ctx);
        adQueries.cancel.run(adId, user.id);
        await ctx.answerCbQuery('Ad cancelled.');
        await ctx.editMessageReplyMarkup(null);
        return ctx.reply(`✅ Ad #${adId} cancelled.`);
      }

      if (data.startsWith('trade_ad_')) {
        await ctx.answerCbQuery();
        return handleInitiateTrade(ctx, parseInt(data.replace('trade_ad_', '')));
      }

      for (const m of PAYMENT_METHODS) {
        if (data === `select_pay_${m}`) {
          await ctx.answerCbQuery();
          return handlePaymentMethodSelect(ctx, m);
        }
      }

      if (data.startsWith('confirm_buyer_')) return handleBuyerConfirm(ctx, parseInt(data.replace('confirm_buyer_', '')));
      if (data.startsWith('confirm_seller_')) return handleSellerConfirm(ctx, parseInt(data.replace('confirm_seller_', '')));
      if (data.startsWith('dispute_')) return handleDispute(ctx, parseInt(data.replace('dispute_', '')));
      if (data.startsWith('cancel_trade_')) return handleCancelTrade(ctx, parseInt(data.replace('cancel_trade_', '')));

      if (data.startsWith('rate_')) {
        const parts = data.split('_');
        return handleRating(ctx, parseInt(parts[1]), parseInt(parts[2]), parseInt(parts[3]));
      }
      if (data === 'skip_comment') {
        const sess = getSession(ctx.from.id);
        if (sess.state === 'rating_comment') await saveRating(ctx, sess.data, null);
        return;
      }

      if (data === 'pay_set_bank') return handleSetBank(ctx);
      if (data === 'pay_set_telebirr') return handleSetTelebirr(ctx);
      if (data === 'pay_set_mpesa') return handleSetMpesa(ctx);

      if (data === 'admin_users') return handleAdminUsers(ctx);
      if (data === 'admin_ads') return handleAdminAds(ctx);
      if (data === 'admin_trades') return handleAdminTrades(ctx);
      if (data === 'admin_disputes') return handleAdminDisputes(ctx);
      if (data === 'admin_whitelist') return handleWhitelistPrompt(ctx, 'add');
      if (data === 'admin_unwhitelist') return handleWhitelistPrompt(ctx, 'remove');
      if (data === 'admin_broadcast') return handleBroadcastPrompt(ctx);
      if (data === 'admin_back') return handleAdmin(ctx);
      if (data.startsWith('resolve_dispute_')) return handleResolveDispute(ctx, parseInt(data.replace('resolve_dispute_', '')));

      await ctx.answerCbQuery();
    } catch (err) {
      console.error('Callback error:', err.message);
      try { await ctx.answerCbQuery('Something went wrong.', { show_alert: true }); } catch (_) {}
    }
  });

  // ─── Text Message Handler ────────────────────────────────────────────────────
  bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return;

    const sess = getSession(ctx.from.id);
    const text = ctx.message.text.trim();

    switch (sess.state) {
      case 'post_ad_amount': {
        const amount = parseFloat(text);
        if (isNaN(amount) || amount <= 0) return ctx.reply('❌ Invalid amount. Enter a positive number:');
        setSession(ctx.from.id, 'post_ad_price', { ...sess.data, amount });
        return ctx.reply(`✅ Amount: *${amount} ${sess.data.crypto}*\n\nEnter the price per ${sess.data.crypto} in ETB:`, { parse_mode: 'Markdown' });
      }

      case 'post_ad_price': {
        const price = parseFloat(text);
        if (isNaN(price) || price <= 0) return ctx.reply('❌ Invalid price. Enter a positive number in ETB:');
        const total = sess.data.amount * price;
        const user = getOrCreateUser(ctx);
        if (total > user.trade_limit) {
          return ctx.reply(`⚠️ Total (${formatETB(total)}) exceeds your trade limit of ${formatETB(user.trade_limit)}. Please lower the amount or price.`);
        }
        setSession(ctx.from.id, 'post_ad_payment', { ...sess.data, price_per_unit: price });
        const buttons = PAYMENT_METHODS.map(m => Markup.button.callback(m, `ad_pay_${m}`));
        return ctx.reply(`✅ Price: *${formatETB(price)}* per ${sess.data.crypto}\nTotal: *${formatETB(total)}*\n\nSelect payment methods:`, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([buttons, [Markup.button.callback('✅ Done', 'ad_pay_done'), Markup.button.callback('❌ Cancel', 'cancel_flow')]]),
        });
      }

      case 'post_ad_note':
        return finishPostAd(ctx, sess.data, text.substring(0, 100));

      case 'set_bank_name':
        setSession(ctx.from.id, 'set_bank_account', { ...sess.data, bank_name: text });
        return ctx.reply('Enter your bank *account number*:', { parse_mode: 'Markdown' });

      case 'set_bank_account':
        setSession(ctx.from.id, 'set_bank_account_name', { ...sess.data, bank_account: text });
        return ctx.reply('Enter the *account holder name*:', { parse_mode: 'Markdown' });

      case 'set_bank_account_name': {
        const u = getOrCreateUser(ctx);
        const existing = paymentQueries.get.get(u.id) || {};
        paymentQueries.upsert.run(u.id, sess.data.bank_name, sess.data.bank_account, text, existing.telebirr_number || null, existing.mpesa_number || null);
        clearSession(ctx.from.id);
        return ctx.reply(`✅ Bank details saved!\n\n🏦 ${sess.data.bank_name}\nAccount: ${sess.data.bank_account}\nName: ${text}`);
      }

      case 'set_telebirr': {
        const u = getOrCreateUser(ctx);
        const existing = paymentQueries.get.get(u.id) || {};
        paymentQueries.upsert.run(u.id, existing.bank_name || null, existing.bank_account || null, existing.bank_account_name || null, text, existing.mpesa_number || null);
        clearSession(ctx.from.id);
        return ctx.reply(`✅ Telebirr number saved: ${text}`);
      }

      case 'set_mpesa': {
        const u = getOrCreateUser(ctx);
        const existing = paymentQueries.get.get(u.id) || {};
        paymentQueries.upsert.run(u.id, existing.bank_name || null, existing.bank_account || null, existing.bank_account_name || null, existing.telebirr_number || null, text);
        clearSession(ctx.from.id);
        return ctx.reply(`✅ M-Pesa number saved: ${text}`);
      }

      case 'trade_chat': {
        const tradeId = sess.data.trade_id;
        const trade = tradeQueries.getById.get(tradeId);
        if (!trade) { clearSession(ctx.from.id); return ctx.reply('Trade not found.'); }
        if (!['pending', 'buyer_confirmed', 'seller_confirmed'].includes(trade.status)) {
          clearSession(ctx.from.id);
          return ctx.reply('This trade is no longer active.');
        }
        const fromUser = getOrCreateUser(ctx);
        messageQueries.create.run(tradeId, fromUser.id, text);
        const partnerId = fromUser.id === trade.buyer_id ? trade.seller_telegram_id : trade.buyer_telegram_id;
        try {
          await ctx.telegram.sendMessage(partnerId, `💬 *Message from trade partner (Trade #${tradeId}):*\n\n${escMd(text)}\n\nReply via /tradechat ${tradeId}`, { parse_mode: 'Markdown' });
        } catch (e) {}
        return ctx.reply('✅ Message sent to your trade partner.');
      }

      case 'dispute_reason': {
        const tradeId = sess.data.trade_id;
        tradeQueries.dispute.run(text.substring(0, 200), tradeId);
        clearSession(ctx.from.id);
        const adminId = process.env.ADMIN_TELEGRAM_ID;
        const u = getOrCreateUser(ctx);
        try {
          await ctx.telegram.sendMessage(adminId, `⚠️ *Dispute Filed — Trade #${tradeId}*\n\nBy: ${escMd(u.name)} (@${u.username || 'N/A'})\nReason: ${escMd(text)}`, { parse_mode: 'Markdown' });
        } catch (e) {}
        return ctx.reply(`⚠️ Dispute filed for Trade #${tradeId}. Admin has been notified.\n\nReason: ${text}`);
      }

      case 'rating_comment':
        return saveRating(ctx, sess.data, text.substring(0, 100));

      case 'admin_whitelist_id': {
        if (!isAdmin(getOrCreateUser(ctx))) { clearSession(ctx.from.id); return; }
        userQueries.whitelist.run(text.trim());
        clearSession(ctx.from.id);
        try { await ctx.telegram.sendMessage(text.trim(), '✅ You have been whitelisted on EthioP2P! Type /start to begin.'); } catch (e) {}
        return ctx.reply(`✅ User ${text.trim()} whitelisted.`);
      }

      case 'admin_unwhitelist_id': {
        if (!isAdmin(getOrCreateUser(ctx))) { clearSession(ctx.from.id); return; }
        userQueries.unwhitelist.run(text.trim());
        clearSession(ctx.from.id);
        return ctx.reply(`✅ User ${text.trim()} removed from whitelist.`);
      }

      case 'admin_broadcast': {
        if (!isAdmin(getOrCreateUser(ctx))) { clearSession(ctx.from.id); return; }
        clearSession(ctx.from.id);
        return sendBroadcast(ctx, text);
      }

      default:
        return ctx.reply('Use /start to see the main menu.', { reply_markup: mainMenuKeyboard() });
    }
  });

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  async function finishPostAd(ctx, data, note) {
    const user = getOrCreateUser(ctx);
    clearSession(ctx.from.id);
    const result = adQueries.create.run(user.id, data.type, data.crypto, data.amount, data.price_per_unit, JSON.stringify(data.payment_methods), note);
    const adId = result.lastInsertRowid;
    const ad = adQueries.getById.get(adId);
    await ctx.reply(
      `✅ *Ad #${adId} Posted Successfully!*\n\n${formatAd({ ...ad, name: user.name, total_trades: user.total_trades, reputation: user.reputation })}\n\n⏱️ Expires in 24 hours.`,
      { parse_mode: 'Markdown' }
    );
  }

  async function saveRating(ctx, data, comment) {
    const fromUser = getOrCreateUser(ctx);
    clearSession(ctx.from.id);
    try {
      feedbackQueries.create.run(data.trade_id, fromUser.id, data.to_user_id, data.rating, comment || null);
    } catch (e) {
      return ctx.reply('Already rated this trade.');
    }
    const positiveDelta = data.rating === 1 ? 1 : 0;
    userQueries.updateReputation.run(positiveDelta, data.rating, positiveDelta, positiveDelta, data.to_user_id);
    const icon = data.rating === 1 ? '✅ Positive' : data.rating === -1 ? '❌ Negative' : '⚪ Neutral';
    await ctx.reply(`✅ Rating saved: ${icon}${comment ? `\nComment: ${comment}` : ''}\n\nThank you for the feedback!`);
  }

  bot.catch((err, ctx) => {
    console.error(`Error for ${ctx.updateType}:`, err.message);
  });

  bot.launch({ dropPendingUpdates: true });
  console.log('🤖 EthioP2P Bot is running...');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main().catch(console.error);
