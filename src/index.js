require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const {
  initDatabase, userQueries, adQueries, tradeQueries,
  paymentQueries, feedbackQueries, messageQueries,
} = require('./database');
const {
  getOrCreateUser, isWhitelisted, isAdmin,
  formatUserProfile, formatAd, formatETB,
  escMd, mainReplyKeyboard, mainMenuKeyboard,
  CRYPTOS, PAYMENT_METHODS,
} = require('./helpers');
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

  // Register bot commands with Telegram
  await bot.telegram.setMyCommands([
    { command: 'start',     description: '🏠 Home menu' },
    { command: 'post',      description: '📢 Post a buy/sell ad' },
    { command: 'ads',       description: '📋 Browse active ads' },
    { command: 'myads',     description: '📁 Manage your ads' },
    { command: 'profile',   description: '👤 View your profile' },
    { command: 'payment',   description: '💳 Set payment details' },
    { command: 'stats',     description: '📊 Global trading stats' },
    { command: 'admin',     description: '🔐 Admin panel' },
  ]);

  // ─── /start ─────────────────────────────────────────────────────────────────
  bot.command('start', async (ctx) => {
    const user = getOrCreateUser(ctx);
    clearSession(ctx.from.id);

    if (!isWhitelisted(user)) {
      return ctx.reply(
        `👋 Welcome to *EthioP2P — Crypto Ad Center\\!*\n\n` +
        `This is an invite\\-only P2P trading platform for Ethiopian users\\.\n\n` +
        `⛔ You are *not whitelisted* yet\\. Contact an admin to get access\\.\n\n` +
        `Your Telegram ID: \`${ctx.from.id}\``,
        { parse_mode: 'MarkdownV2' }
      );
    }

    await ctx.reply(
      `🇪🇹 *Welcome to EthioP2P\\!*\n\n` +
      `Your P2P crypto marketplace in Ethiopia\\.\n` +
      `All prices in *Ethiopian Birr \\(ETB\\)*\\.\n\n` +
      `Use the buttons below to navigate:`,
      { parse_mode: 'MarkdownV2', reply_markup: mainReplyKeyboard() }
    );
  });

  // ─── Slash Commands ──────────────────────────────────────────────────────────
  bot.command('post',    handlePostAd);
  bot.command('ads',     handleAds);
  bot.command('myads',   handleMyAds);
  bot.command('payment', handlePayment);
  bot.command('stats',   handleStats);
  bot.command('admin',   handleAdmin);

  bot.command('profile', async (ctx) => {
    const user = getOrCreateUser(ctx);
    if (!isWhitelisted(user)) return ctx.reply('⛔ Not whitelisted\\.');
    await ctx.reply(formatUserProfile(user), { parse_mode: 'MarkdownV2' });
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
      // Cancel any active flow
      if (data === 'cancel_flow') {
        clearSession(ctx.from.id);
        try { await ctx.editMessageText('❌ Cancelled\\.', { parse_mode: 'MarkdownV2' }); } catch (_) {}
        return ctx.answerCbQuery('Cancelled');
      }

      // ── Main menu ──
      if (data === 'browse_ads')  { await ctx.answerCbQuery(); return handleAds(ctx); }
      if (data === 'post_ad')     { await ctx.answerCbQuery(); return handlePostAd(ctx); }
      if (data === 'my_ads')      { await ctx.answerCbQuery(); return handleMyAds(ctx); }
      if (data === 'payment_info'){ await ctx.answerCbQuery(); return handlePayment(ctx); }
      if (data === 'stats')       { await ctx.answerCbQuery(); return handleStats(ctx); }
      if (data === 'my_profile') {
        const user = getOrCreateUser(ctx);
        await ctx.answerCbQuery();
        return ctx.reply(formatUserProfile(user), { parse_mode: 'MarkdownV2' });
      }

      // ── Post Ad flow ──
      if (data === 'ad_type_buy')  return handleAdTypeSelect(ctx, 'buy');
      if (data === 'ad_type_sell') return handleAdTypeSelect(ctx, 'sell');

      for (const c of CRYPTOS) {
        if (data === `ad_crypto_${c}`) return handleAdCryptoSelect(ctx, c);
      }
      for (const m of PAYMENT_METHODS) {
        if (data === `ad_pay_${m}`) return handleAdPaymentSelect(ctx, m);
      }
      if (data === 'ad_pay_done')   return handleAdPaymentDone(ctx);
      if (data === 'ad_note_skip') {
        const sess = getSession(ctx.from.id);
        return finishPostAd(ctx, sess.data, null);
      }

      // ── Ad filters ──
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

      // ── Cancel own ad ──
      if (data.startsWith('cancel_ad_')) {
        const adId = parseInt(data.replace('cancel_ad_', ''));
        const user = getOrCreateUser(ctx);
        adQueries.cancel.run(adId, user.id);
        await ctx.answerCbQuery('Ad cancelled.');
        try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch (_) {}
        return ctx.reply(`✅ Ad \\#${adId} cancelled\\.`, { parse_mode: 'MarkdownV2' });
      }

      // ── Initiate trade ──
      if (data.startsWith('trade_ad_')) {
        await ctx.answerCbQuery();
        return handleInitiateTrade(ctx, parseInt(data.replace('trade_ad_', '')));
      }

      // ── Select payment method for trade ──
      for (const m of PAYMENT_METHODS) {
        if (data === `select_pay_${m}`) {
          await ctx.answerCbQuery();
          return handlePaymentMethodSelect(ctx, m);
        }
      }

      // ── Trade actions ──
      if (data.startsWith('confirm_buyer_'))  return handleBuyerConfirm(ctx, parseInt(data.replace('confirm_buyer_', '')));
      if (data.startsWith('confirm_seller_')) return handleSellerConfirm(ctx, parseInt(data.replace('confirm_seller_', '')));
      if (data.startsWith('dispute_'))        return handleDispute(ctx, parseInt(data.replace('dispute_', '')));
      if (data.startsWith('cancel_trade_'))   return handleCancelTrade(ctx, parseInt(data.replace('cancel_trade_', '')));

      // ── Ratings: rate_<tradeId>_<toUserId>_<rating> ──
      if (data.startsWith('rate_')) {
        const parts = data.split('_');
        return handleRating(ctx, parseInt(parts[1]), parseInt(parts[2]), parseInt(parts[3]));
      }
      if (data === 'skip_comment') {
        const sess = getSession(ctx.from.id);
        if (sess.state === 'rating_comment') await saveRating(ctx, sess.data, null);
        return ctx.answerCbQuery();
      }

      // ── Payment setup ──
      if (data === 'pay_set_bank')     return handleSetBank(ctx);
      if (data === 'pay_set_telebirr') return handleSetTelebirr(ctx);
      if (data === 'pay_set_mpesa')    return handleSetMpesa(ctx);

      // ── Admin ──
      if (data === 'admin_users')       return handleAdminUsers(ctx);
      if (data === 'admin_ads')         return handleAdminAds(ctx);
      if (data === 'admin_trades')      return handleAdminTrades(ctx);
      if (data === 'admin_disputes')    return handleAdminDisputes(ctx);
      if (data === 'admin_whitelist')   return handleWhitelistPrompt(ctx, 'add');
      if (data === 'admin_unwhitelist') return handleWhitelistPrompt(ctx, 'remove');
      if (data === 'admin_broadcast')   return handleBroadcastPrompt(ctx);
      if (data === 'admin_back')        return handleAdmin(ctx);
      if (data.startsWith('resolve_dispute_')) {
        return handleResolveDispute(ctx, parseInt(data.replace('resolve_dispute_', '')));
      }

      await ctx.answerCbQuery();
    } catch (err) {
      console.error('Callback error:', err.message);
      try { await ctx.answerCbQuery('Something went wrong.', { show_alert: true }); } catch (_) {}
    }
  });

  // ─── Text Handler (Reply Keyboard + State Machine) ───────────────────────────
  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();

    // Handle persistent reply keyboard buttons
    if (!text.startsWith('/')) {
      const user = getOrCreateUser(ctx);
      const sess = getSession(ctx.from.id);

      // Reply keyboard shortcuts
      const shortcuts = {
        '📢 Post Ad':       () => handlePostAd(ctx),
        '📋 Browse Ads':    () => handleAds(ctx),
        '📁 My Ads':        () => handleMyAds(ctx),
        '👤 My Profile':    () => ctx.reply(formatUserProfile(user), { parse_mode: 'MarkdownV2' }),
        '💳 Payment Info':  () => handlePayment(ctx),
        '📊 Stats':         () => handleStats(ctx),
      };

      if (shortcuts[text]) {
        if (!isWhitelisted(user)) return ctx.reply('⛔ You are not whitelisted\\. Contact admin to get access\\.', { parse_mode: 'MarkdownV2' });
        return shortcuts[text]();
      }

      // ── State machine ──
      switch (sess.state) {

        case 'post_ad_amount': {
          const amount = parseFloat(text);
          if (isNaN(amount) || amount <= 0) return ctx.reply('❌ Invalid amount\\. Enter a positive number:', { parse_mode: 'MarkdownV2' });
          setSession(ctx.from.id, 'post_ad_price', { ...sess.data, amount });
          return ctx.reply(
            `✅ Amount: *${escMd(String(amount))} ${sess.data.crypto}*\n\nNow enter the *price per ${sess.data.crypto}* in ETB:`,
            { parse_mode: 'MarkdownV2', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'cancel_flow')]]) }
          );
        }

        case 'post_ad_price': {
          const price = parseFloat(text);
          if (isNaN(price) || price <= 0) return ctx.reply('❌ Invalid price\\. Enter a positive ETB amount:', { parse_mode: 'MarkdownV2' });
          const total = sess.data.amount * price;
          const user2 = getOrCreateUser(ctx);
          if (total > user2.trade_limit) {
            return ctx.reply(
              `⚠️ Total \\(${escMd(formatETB(total))}\\) exceeds your trade limit of *${escMd(formatETB(user2.trade_limit))}*\\.\n\nLower the amount or price\\.`,
              { parse_mode: 'MarkdownV2' }
            );
          }
          setSession(ctx.from.id, 'post_ad_payment', { ...sess.data, price_per_unit: price });
          const buttons = PAYMENT_METHODS.map(m => Markup.button.callback(m, `ad_pay_${m}`));
          return ctx.reply(
            `✅ Price: *${escMd(formatETB(price))}* per ${sess.data.crypto}\nTotal: *${escMd(formatETB(total))}*\n\n💳 Select payment methods \\(tap to toggle\\):`,
            {
              parse_mode: 'MarkdownV2',
              ...Markup.inlineKeyboard([
                buttons,
                [Markup.button.callback('✅ Confirm', 'ad_pay_done'), Markup.button.callback('❌ Cancel', 'cancel_flow')],
              ]),
            }
          );
        }

        case 'post_ad_note':
          return finishPostAd(ctx, sess.data, text.substring(0, 100));

        // ── Payment setup flow ──
        case 'set_bank_name':
          setSession(ctx.from.id, 'set_bank_account', { ...sess.data, bank_name: text });
          return ctx.reply('Enter your bank *account number*:', { parse_mode: 'MarkdownV2' });

        case 'set_bank_account':
          setSession(ctx.from.id, 'set_bank_account_name', { ...sess.data, bank_account: text });
          return ctx.reply('Enter the *account holder name*:', { parse_mode: 'MarkdownV2' });

        case 'set_bank_account_name': {
          const u = getOrCreateUser(ctx);
          const ex = paymentQueries.get.get(u.id) || {};
          paymentQueries.upsert.run(u.id, sess.data.bank_name, sess.data.bank_account, text, ex.telebirr_number || null, ex.mpesa_number || null);
          clearSession(ctx.from.id);
          return ctx.reply(
            `✅ *Bank details saved\\!*\n\n🏦 ${escMd(sess.data.bank_name)}\nAccount: \`${escMd(sess.data.bank_account)}\`\nName: ${escMd(text)}`,
            { parse_mode: 'MarkdownV2' }
          );
        }

        case 'set_telebirr': {
          const u = getOrCreateUser(ctx);
          const ex = paymentQueries.get.get(u.id) || {};
          paymentQueries.upsert.run(u.id, ex.bank_name || null, ex.bank_account || null, ex.bank_account_name || null, text, ex.mpesa_number || null);
          clearSession(ctx.from.id);
          return ctx.reply(`✅ Telebirr number saved: \`${escMd(text)}\``, { parse_mode: 'MarkdownV2' });
        }

        case 'set_mpesa': {
          const u = getOrCreateUser(ctx);
          const ex = paymentQueries.get.get(u.id) || {};
          paymentQueries.upsert.run(u.id, ex.bank_name || null, ex.bank_account || null, ex.bank_account_name || null, ex.telebirr_number || null, text);
          clearSession(ctx.from.id);
          return ctx.reply(`✅ M\\-Pesa number saved: \`${escMd(text)}\``, { parse_mode: 'MarkdownV2' });
        }

        // ── Trade chat ──
        case 'trade_chat': {
          const tradeId = sess.data.trade_id;
          const trade = tradeQueries.getById.get(tradeId);
          if (!trade) { clearSession(ctx.from.id); return ctx.reply('Trade not found\\.', { parse_mode: 'MarkdownV2' }); }
          if (!['pending', 'buyer_confirmed', 'seller_confirmed'].includes(trade.status)) {
            clearSession(ctx.from.id);
            return ctx.reply('This trade is no longer active\\.', { parse_mode: 'MarkdownV2' });
          }
          const fromUser = getOrCreateUser(ctx);
          messageQueries.create.run(tradeId, fromUser.id, text);
          const partnerId = fromUser.id === trade.buyer_id ? trade.seller_telegram_id : trade.buyer_telegram_id;
          try {
            await ctx.telegram.sendMessage(
              partnerId,
              `💬 *Message — Trade \\#${tradeId}:*\n\n${escMd(text)}\n\nReply: /tradechat ${tradeId}`,
              { parse_mode: 'MarkdownV2' }
            );
          } catch (e) {}
          return ctx.reply('✅ Message sent to your trade partner\\.', { parse_mode: 'MarkdownV2' });
        }

        // ── Dispute reason ──
        case 'dispute_reason': {
          const tradeId = sess.data.trade_id;
          tradeQueries.dispute.run(text.substring(0, 200), tradeId);
          clearSession(ctx.from.id);
          const u = getOrCreateUser(ctx);
          const adminId = process.env.ADMIN_TELEGRAM_ID;
          try {
            await ctx.telegram.sendMessage(
              adminId,
              `⚠️ *Dispute Filed — Trade \\#${tradeId}*\n\nBy: ${escMd(u.name)}${u.username ? ` @${u.username}` : ''}\nReason: ${escMd(text)}`,
              { parse_mode: 'MarkdownV2' }
            );
          } catch (e) {}
          return ctx.reply(`⚠️ Dispute filed for Trade \\#${tradeId}\\.\nAdmin has been notified\\.`, { parse_mode: 'MarkdownV2' });
        }

        // ── Rating comment ──
        case 'rating_comment':
          return saveRating(ctx, sess.data, text.substring(0, 100));

        // ── Admin flows ──
        case 'admin_whitelist_id': {
          if (!isAdmin(getOrCreateUser(ctx))) { clearSession(ctx.from.id); return; }
          userQueries.whitelist.run(text.trim());
          clearSession(ctx.from.id);
          try {
            await ctx.telegram.sendMessage(
              text.trim(),
              `✅ You have been *whitelisted* on EthioP2P\\!\n\nType /start to begin trading\\.`,
              { parse_mode: 'MarkdownV2' }
            );
          } catch (e) {}
          return ctx.reply(`✅ User \`${text.trim()}\` whitelisted\\.`, { parse_mode: 'MarkdownV2' });
        }

        case 'admin_unwhitelist_id': {
          if (!isAdmin(getOrCreateUser(ctx))) { clearSession(ctx.from.id); return; }
          userQueries.unwhitelist.run(text.trim());
          clearSession(ctx.from.id);
          return ctx.reply(`✅ User \`${text.trim()}\` removed from whitelist\\.`, { parse_mode: 'MarkdownV2' });
        }

        case 'admin_broadcast': {
          if (!isAdmin(getOrCreateUser(ctx))) { clearSession(ctx.from.id); return; }
          clearSession(ctx.from.id);
          return sendBroadcast(ctx, text);
        }

        default:
          return ctx.reply(
            '👋 Use the buttons below or type /start to open the menu\\.',
            { parse_mode: 'MarkdownV2', reply_markup: mainReplyKeyboard() }
          );
      }
    }
  });

  // ─── Shared helpers ──────────────────────────────────────────────────────────
  async function finishPostAd(ctx, data, note) {
    const user = getOrCreateUser(ctx);
    clearSession(ctx.from.id);

    const result = adQueries.create.run(
      user.id, data.type, data.crypto, data.amount,
      data.price_per_unit, JSON.stringify(data.payment_methods), note
    );
    const adId = result.lastInsertRowid;
    const ad = adQueries.getById.get(adId);

    await ctx.reply(
      `✅ *Ad \\#${adId} Posted\\!*\n\n` +
      formatAd({ ...ad, name: user.name, username: user.username, owner_telegram_id: user.telegram_id, total_trades: user.total_trades, positive_trades: user.positive_trades }) +
      `\n\n⏱️ Expires in *24 hours*\\.`,
      {
        parse_mode: 'MarkdownV2',
        reply_markup: mainReplyKeyboard(),
      }
    );
  }

  async function saveRating(ctx, data, comment) {
    const fromUser = getOrCreateUser(ctx);
    clearSession(ctx.from.id);

    try {
      feedbackQueries.create.run(data.trade_id, fromUser.id, data.to_user_id, data.rating, comment || null);
    } catch (e) {
      return ctx.reply('You already rated this trade\\.', { parse_mode: 'MarkdownV2' });
    }

    const positiveDelta = data.rating === 1 ? 1 : 0;
    userQueries.updateReputation.run(positiveDelta, data.rating, positiveDelta, positiveDelta, data.to_user_id);

    const icon = data.rating === 1 ? '✅ Positive' : data.rating === -1 ? '❌ Negative' : '⚪ Neutral';
    await ctx.reply(
      `✅ Rating saved: *${escMd(icon)}*${comment ? `\nComment: _${escMd(comment)}_` : ''}\n\nThank you for the feedback\\!`,
      { parse_mode: 'MarkdownV2' }
    );
  }

  // ─── Error Handler ───────────────────────────────────────────────────────────
  bot.catch((err, ctx) => {
    console.error(`[ERROR] ${ctx.updateType}:`, err.message);
  });

  // ─── Launch ──────────────────────────────────────────────────────────────────
  await bot.launch({ dropPendingUpdates: true });
  console.log('🤖 EthioP2P Bot is running...');

  process.once('SIGINT',  () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main().catch(console.error);
