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
const { getPriceHint, getAllPrices } = require('./market');

const {
  handlePostAd, handleAdTypeSelect, handleAdCryptoSelect,
  handleAdPaymentSelect, handleAdPaymentDone,
  handleAds, showFilteredAds, handleMyAds,
} = require('./handlers/ads');
const {
  handleInitiateTrade, handlePaymentMethodSelect,
  handleBuyerConfirm, handleSellerConfirm,
  handleDispute, handleCancelTrade, handleRating, handleTradeChat,
} = require('./handlers/trades');
const {
  handleAdmin, handleAdminUsers, handleAdminTrades, handleAdminDisputes,
  handleResolveDispute, handleAdminAds,
  handleWhitelistPrompt, handleBroadcastPrompt, sendBroadcast,
} = require('./handlers/admin');
const { handlePayment, handleSetBank, handleSetTelebirr, handleSetMpesa } = require('./handlers/payment');
const { handleStats } = require('./handlers/stats');

// Post ad to channel if CHANNEL_ID is configured
async function postAdToChannel(bot, ad, user) {
  const channelId = process.env.CHANNEL_ID;
  if (!channelId) return;
  try {
    const enriched = {
      ...ad,
      name: user.name, username: user.username,
      owner_telegram_id: user.telegram_id,
      total_trades: user.total_trades,
      positive_trades: user.positive_trades,
      user_created_at: user.created_at,
    };
    const text = `📣 *New Ad on EthioP2P*\n\n${formatAd(enriched)}\n\n_Open @EthioP2PBot to trade_`;
    await bot.telegram.sendMessage(channelId, text, {
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: true,
    });
  } catch (e) {
    console.error('[Channel] Failed to post ad:', e.message);
  }
}

// Finish posting an ad after note step
async function finishPostAd(ctx, bot, data, note) {
  const user = getOrCreateUser(ctx);
  clearSession(ctx.from.id);

  const result = adQueries.create.run(
    user.id, data.type, data.crypto,
    data.amount, data.price_per_unit,
    JSON.stringify(data.payment_methods || []), note || null
  );
  const adId = result.lastInsertRowid;
  if (!adId) {
    return ctx.reply('❌ Failed to create ad\\. Please try again\\.', { parse_mode: 'MarkdownV2' });
  }

  const ad = adQueries.getById.get(adId);
  if (!ad) {
    return ctx.reply('❌ Ad created but could not be fetched\\. Try /myads\\.', { parse_mode: 'MarkdownV2' });
  }

  // Market price hint (plain text → escape for MarkdownV2)
  let marketHint = '';
  try {
    const hint = await getPriceHint(data.crypto, data.price_per_unit);
    if (hint) marketHint = `\n\n${escMd(hint)}`;
  } catch (_) {}

  await ctx.reply(
    `✅ *Ad \\#${adId} Posted Successfully\\!*\n\n${formatAd(ad)}${marketHint}\n\n⏱️ Expires in *24 hours*\\.`,
    {
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: true,
      reply_markup: mainReplyKeyboard(),
    }
  );

  // Post to channel in background
  postAdToChannel(bot, ad, user);
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
    `✅ Rating saved: *${escMd(icon)}*${comment ? `\n_${escMd(comment)}_` : ''}\n\nThank you for the feedback\\!`,
    { parse_mode: 'MarkdownV2' }
  );
}

async function main() {
  await initDatabase();

  const bot = new Telegraf(process.env.BOT_TOKEN);
  startCronJobs(bot);

  // Register bot commands
  try {
    await bot.telegram.setMyCommands([
      { command: 'start',     description: '🏠 Open main menu' },
      { command: 'post',      description: '📢 Post a buy/sell ad' },
      { command: 'ads',       description: '📋 Browse active ads' },
      { command: 'myads',     description: '📁 Manage your ads' },
      { command: 'profile',   description: '👤 View your profile' },
      { command: 'payment',   description: '💳 Set payment details' },
      { command: 'prices',    description: '💹 Live crypto prices in ETB' },
      { command: 'stats',     description: '📊 Global trading stats' },
      { command: 'admin',     description: '🔐 Admin panel' },
    ]);
  } catch (e) { console.error('setMyCommands:', e.message); }

  // ─── /start ─────────────────────────────────────────────────────────────────
  bot.command('start', async (ctx) => {
    const user = getOrCreateUser(ctx);
    clearSession(ctx.from.id);

    if (!isWhitelisted(user)) {
      return ctx.reply(
        `👋 Welcome to *EthioP2P — Crypto Ad Center\\!*\n\n` +
        `This is an invite\\-only P2P trading platform for Ethiopian users\\.\n\n` +
        `⛔ You are *not whitelisted* yet\\. Contact an admin to get access\\.\n\n` +
        `📋 Your Telegram ID: \`${ctx.from.id}\`\n_Share this ID with the admin_`,
        { parse_mode: 'MarkdownV2' }
      );
    }

    // Ask new whitelisted users to share phone number if not set
    if (!user.phone_number) {
      await ctx.reply(
        `🇪🇹 *Welcome to EthioP2P\\!*\n\nTo get started and build trust, please share your phone number\\.\nThis will automatically be set as your *Telebirr number*\\.`,
        {
          parse_mode: 'MarkdownV2',
          reply_markup: {
            keyboard: [[{ text: '📱 Share My Phone Number', request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        }
      );
      return;
    }

    await ctx.reply(
      `🇪🇹 *Welcome back to EthioP2P\\!*\n\nAll prices in *Ethiopian Birr \\(ETB\\)*\\.`,
      { parse_mode: 'MarkdownV2', reply_markup: mainReplyKeyboard() }
    );
  });

  // ─── Handle phone number sharing ───────────────────────────────────────────
  bot.on('contact', async (ctx) => {
    const contact = ctx.message.contact;
    if (String(contact.user_id) !== String(ctx.from.id)) {
      return ctx.reply('Please share *your own* phone number\\.', { parse_mode: 'MarkdownV2' });
    }

    const phone = contact.phone_number.replace(/\D/g, '');
    const user = getOrCreateUser(ctx);

    // Save phone to user record
    userQueries.setPhone.run(phone, String(ctx.from.id));

    // Auto-set as Telebirr number
    paymentQueries.upsertField.telebirr(user.id, phone);

    await ctx.reply(
      `✅ *Phone number saved\\!*\n\n📱 \`${escMd(phone)}\` has been set as your *Telebirr number* automatically\\.\n\nYou can change it anytime via 💳 Payment Info\\.`,
      { parse_mode: 'MarkdownV2', reply_markup: mainReplyKeyboard() }
    );
  });

  // ─── Commands ───────────────────────────────────────────────────────────────
  bot.command('post',    handlePostAd);
  bot.command('ads',     handleAds);
  bot.command('myads',   handleMyAds);
  bot.command('payment', handlePayment);
  bot.command('stats',   handleStats);
  bot.command('admin',   handleAdmin);

  bot.command('profile', async (ctx) => {
    const user = getOrCreateUser(ctx);
    if (!isWhitelisted(user)) return ctx.reply('⛔ Not whitelisted\\.');
    await ctx.reply(formatUserProfile(user), { parse_mode: 'MarkdownV2', disable_web_page_preview: true });
  });

  bot.command('prices', async (ctx) => {
    try {
      const { prices, etbRate } = await getAllPrices();
      const fmt = (v) => v ? Number(v).toLocaleString('en-ET', { maximumFractionDigits: 0 }) : 'N/A';
      await ctx.reply(
        `💹 *Live Crypto Prices \\(ETB\\)*\n\n` +
        `₿ *BTC:* ${escMd(fmt(prices.BTC))} ETB\n` +
        `Ξ *ETH:* ${escMd(fmt(prices.ETH))} ETB\n` +
        `💵 *USDT:* ${escMd(fmt(prices.USDT))} ETB\n\n` +
        `_1 USD ≈ ${escMd(fmt(etbRate))} ETB_\n` +
        `_Source: Binance \\+ ExchangeRate API_`,
        { parse_mode: 'MarkdownV2' }
      );
    } catch (e) {
      await ctx.reply('❌ Could not fetch prices right now\\. Try again later\\.', { parse_mode: 'MarkdownV2' });
    }
  });

  bot.command('tradechat', async (ctx) => {
    const args = ctx.message.text.split(' ');
    const tradeId = parseInt(args[1]);
    if (!tradeId) return ctx.reply('Usage: /tradechat <trade\\_id>', { parse_mode: 'MarkdownV2' });
    await handleTradeChat(ctx, tradeId);
  });

  // ─── Callback Queries ────────────────────────────────────────────────────────
  bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;

    try {
      if (data === 'cancel_flow') {
        clearSession(ctx.from.id);
        try { await ctx.editMessageText('❌ Cancelled\\.', { parse_mode: 'MarkdownV2' }); } catch (_) {}
        return ctx.answerCbQuery('Cancelled');
      }

      // Main menu
      if (data === 'browse_ads')   { await ctx.answerCbQuery(); return handleAds(ctx); }
      if (data === 'post_ad')      { await ctx.answerCbQuery(); return handlePostAd(ctx); }
      if (data === 'my_ads')       { await ctx.answerCbQuery(); return handleMyAds(ctx); }
      if (data === 'payment_info') { await ctx.answerCbQuery(); return handlePayment(ctx); }
      if (data === 'stats')        { await ctx.answerCbQuery(); return handleStats(ctx); }
      if (data === 'my_profile') {
        await ctx.answerCbQuery();
        const user = getOrCreateUser(ctx);
        return ctx.reply(formatUserProfile(user), { parse_mode: 'MarkdownV2', disable_web_page_preview: true });
      }

      // Ad creation flow
      if (data === 'ad_type_buy')  return handleAdTypeSelect(ctx, 'buy');
      if (data === 'ad_type_sell') return handleAdTypeSelect(ctx, 'sell');

      for (const c of CRYPTOS) {
        if (data === `ad_crypto_${c}`) return handleAdCryptoSelect(ctx, c);
      }
      for (const m of PAYMENT_METHODS) {
        if (data === `ad_pay_${m}`) return handleAdPaymentSelect(ctx, m);
      }
      if (data === 'ad_pay_done') return handleAdPaymentDone(ctx);

      if (data === 'ad_note_skip') {
        await ctx.answerCbQuery();
        const sess = getSession(ctx.from.id);
        try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch (_) {}
        return finishPostAd(ctx, bot, sess.data, null);
      }

      // Ad filters
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

      // Cancel own ad
      if (data.startsWith('cancel_ad_')) {
        const adId = parseInt(data.replace('cancel_ad_', ''));
        const user = getOrCreateUser(ctx);
        adQueries.cancel.run(adId, user.id);
        await ctx.answerCbQuery('Ad cancelled.');
        try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch (_) {}
        return ctx.reply(`✅ Ad \\#${adId} cancelled\\.`, { parse_mode: 'MarkdownV2' });
      }

      // Initiate trade
      if (data.startsWith('trade_ad_')) {
        await ctx.answerCbQuery();
        return handleInitiateTrade(ctx, parseInt(data.replace('trade_ad_', '')));
      }

      // Payment method for trade
      for (const m of PAYMENT_METHODS) {
        if (data === `select_pay_${m}`) {
          await ctx.answerCbQuery();
          return handlePaymentMethodSelect(ctx, m);
        }
      }

      // Trade actions
      if (data.startsWith('confirm_buyer_'))  return handleBuyerConfirm(ctx, parseInt(data.replace('confirm_buyer_', '')));
      if (data.startsWith('confirm_seller_')) return handleSellerConfirm(ctx, parseInt(data.replace('confirm_seller_', '')));
      if (data.startsWith('dispute_'))        return handleDispute(ctx, parseInt(data.replace('dispute_', '')));
      if (data.startsWith('cancel_trade_'))   return handleCancelTrade(ctx, parseInt(data.replace('cancel_trade_', '')));

      // Ratings: rate_<tradeId>_<toUserId>_<rating>
      if (data.startsWith('rate_')) {
        const parts = data.split('_');
        return handleRating(ctx, parseInt(parts[1]), parseInt(parts[2]), parseInt(parts[3]));
      }
      if (data === 'skip_comment') {
        await ctx.answerCbQuery();
        const sess = getSession(ctx.from.id);
        if (sess.state === 'rating_comment') return saveRating(ctx, sess.data, null);
        return;
      }

      // Payment setup
      if (data === 'pay_set_bank')     return handleSetBank(ctx);
      if (data === 'pay_set_telebirr') return handleSetTelebirr(ctx);
      if (data === 'pay_set_mpesa')    return handleSetMpesa(ctx);

      // Admin
      if (data === 'admin_users')       return handleAdminUsers(ctx);
      if (data === 'admin_ads')         return handleAdminAds(ctx);
      if (data === 'admin_trades')      return handleAdminTrades(ctx);
      if (data === 'admin_disputes')    return handleAdminDisputes(ctx);
      if (data === 'admin_whitelist')   return handleWhitelistPrompt(ctx, 'add');
      if (data === 'admin_unwhitelist') return handleWhitelistPrompt(ctx, 'remove');
      if (data === 'admin_broadcast')   return handleBroadcastPrompt(ctx);
      if (data === 'admin_back')        { await ctx.answerCbQuery(); return handleAdmin(ctx); }
      if (data.startsWith('resolve_dispute_')) {
        return handleResolveDispute(ctx, parseInt(data.replace('resolve_dispute_', '')));
      }

      await ctx.answerCbQuery();
    } catch (err) {
      console.error('Callback error:', err.message);
      try { await ctx.answerCbQuery('Something went wrong.', { show_alert: true }); } catch (_) {}
    }
  });

  // ─── Text Message Handler (Reply Keyboard + State Machine) ──────────────────
  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;

    const user = getOrCreateUser(ctx);
    const sess = getSession(ctx.from.id);

    // ── Reply keyboard shortcuts ──
    const shortcuts = {
      '📢 Post Ad':      () => handlePostAd(ctx),
      '📋 Browse Ads':   () => handleAds(ctx),
      '📁 My Ads':       () => handleMyAds(ctx),
      '👤 My Profile':   () => ctx.reply(formatUserProfile(user), { parse_mode: 'MarkdownV2', disable_web_page_preview: true }),
      '💳 Payment Info': () => handlePayment(ctx),
      '📊 Stats':        () => handleStats(ctx),
    };

    if (shortcuts[text]) {
      if (!isWhitelisted(user)) {
        return ctx.reply('⛔ You are not whitelisted\\. Contact admin\\.', { parse_mode: 'MarkdownV2' });
      }
      return shortcuts[text]();
    }

    // ── State machine ────────────────────────────────────────────────────────
    switch (sess.state) {

      // ── Post Ad flow ──
      case 'post_ad_amount': {
        const amount = parseFloat(text);
        if (isNaN(amount) || amount <= 0) {
          return ctx.reply('❌ Enter a valid positive number for the amount:', { parse_mode: 'MarkdownV2' });
        }
        setSession(ctx.from.id, 'post_ad_price', { ...sess.data, amount });
        return ctx.reply(
          `✅ Amount: *${escMd(String(amount))} ${sess.data.crypto}*\n\nEnter the *price per ${sess.data.crypto}* in ETB:`,
          {
            parse_mode: 'MarkdownV2',
            ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'cancel_flow')]]),
          }
        );
      }

      case 'post_ad_price': {
        const price = parseFloat(text);
        if (isNaN(price) || price <= 0) {
          return ctx.reply('❌ Enter a valid ETB price:', { parse_mode: 'MarkdownV2' });
        }
        const total = sess.data.amount * price;
        if (total > user.trade_limit) {
          return ctx.reply(
            `⚠️ Total *${escMd(formatETB(total))}* exceeds your limit of *${escMd(formatETB(user.trade_limit))}*\\.\nLower the amount or price\\.`,
            { parse_mode: 'MarkdownV2' }
          );
        }
        setSession(ctx.from.id, 'post_ad_payment', { ...sess.data, price_per_unit: price });
        const btns = PAYMENT_METHODS.map(m => Markup.button.callback(m, `ad_pay_${m}`));
        return ctx.reply(
          `✅ Price: *${escMd(formatETB(price))}* per ${sess.data.crypto}\nTotal: *${escMd(formatETB(total))}*\n\n💳 Select payment methods \\(tap to toggle\\):`,
          {
            parse_mode: 'MarkdownV2',
            ...Markup.inlineKeyboard([
              btns,
              [Markup.button.callback('✅ Confirm', 'ad_pay_done'), Markup.button.callback('❌ Cancel', 'cancel_flow')],
            ]),
          }
        );
      }

      case 'post_ad_note':
        return finishPostAd(ctx, bot, sess.data, text.substring(0, 100));

      // ── Payment setup ──
      case 'set_bank_name':
        setSession(ctx.from.id, 'set_bank_account', { ...sess.data, bank_name: text });
        return ctx.reply('Enter your bank *account number*:', { parse_mode: 'MarkdownV2' });

      case 'set_bank_account':
        setSession(ctx.from.id, 'set_bank_account_name', { ...sess.data, bank_account: text });
        return ctx.reply('Enter the *account holder name*:', { parse_mode: 'MarkdownV2' });

      case 'set_bank_account_name': {
        paymentQueries.upsertField.bank(user.id, sess.data.bank_name, sess.data.bank_account, text);
        clearSession(ctx.from.id);
        return ctx.reply(
          `✅ *Bank details saved\\!*\n\n🏦 ${escMd(sess.data.bank_name)}\nAccount: \`${escMd(sess.data.bank_account)}\`\nName: ${escMd(text)}`,
          { parse_mode: 'MarkdownV2' }
        );
      }

      case 'set_telebirr': {
        const phone = text.replace(/\D/g, '');
        paymentQueries.upsertField.telebirr(user.id, phone);
        userQueries.setPhone.run(phone, String(ctx.from.id));
        clearSession(ctx.from.id);
        return ctx.reply(`✅ Telebirr number saved: \`${escMd(phone)}\``, { parse_mode: 'MarkdownV2' });
      }

      case 'set_mpesa': {
        const phone = text.replace(/\D/g, '');
        paymentQueries.upsertField.mpesa(user.id, phone);
        clearSession(ctx.from.id);
        return ctx.reply(`✅ M\\-Pesa number saved: \`${escMd(phone)}\``, { parse_mode: 'MarkdownV2' });
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
        messageQueries.create.run(tradeId, user.id, text);
        const partnerId = user.id === trade.buyer_id ? trade.seller_telegram_id : trade.buyer_telegram_id;
        try {
          await ctx.telegram.sendMessage(partnerId,
            `💬 *Message — Trade \\#${tradeId}:*\n\n${escMd(text)}\n\n_Reply: /tradechat ${tradeId}_`,
            { parse_mode: 'MarkdownV2' }
          );
        } catch (e) {}
        return ctx.reply('✅ Message sent\\.', { parse_mode: 'MarkdownV2' });
      }

      // ── Dispute reason ──
      case 'dispute_reason': {
        const tradeId = sess.data.trade_id;
        tradeQueries.dispute.run(text.substring(0, 200), tradeId);
        clearSession(ctx.from.id);
        const adminId = process.env.ADMIN_TELEGRAM_ID;
        try {
          await ctx.telegram.sendMessage(adminId,
            `⚠️ *Dispute Filed — Trade \\#${tradeId}*\n\nBy: ${escMd(user.name)}${user.username ? ` @${user.username}` : ''}\nReason: ${escMd(text)}`,
            { parse_mode: 'MarkdownV2' }
          );
        } catch (e) {}
        return ctx.reply(`⚠️ Dispute filed for Trade \\#${tradeId}\\. Admin notified\\.`, { parse_mode: 'MarkdownV2' });
      }

      // ── Rating comment ──
      case 'rating_comment':
        return saveRating(ctx, sess.data, text.substring(0, 100));

      // ── Admin flows ──
      case 'admin_whitelist_id': {
        if (!isAdmin(user)) { clearSession(ctx.from.id); return; }
        const tid = text.trim();
        userQueries.whitelist.run(tid);
        clearSession(ctx.from.id);
        try {
          await ctx.telegram.sendMessage(tid,
            `✅ You have been *whitelisted* on EthioP2P\\!\n\nType /start to begin trading\\.`,
            { parse_mode: 'MarkdownV2' }
          );
        } catch (e) {}
        return ctx.reply(`✅ User \`${escMd(tid)}\` whitelisted\\.`, { parse_mode: 'MarkdownV2' });
      }

      case 'admin_unwhitelist_id': {
        if (!isAdmin(user)) { clearSession(ctx.from.id); return; }
        userQueries.unwhitelist.run(text.trim());
        clearSession(ctx.from.id);
        return ctx.reply(`✅ User \`${escMd(text.trim())}\` removed from whitelist\\.`, { parse_mode: 'MarkdownV2' });
      }

      case 'admin_broadcast': {
        if (!isAdmin(user)) { clearSession(ctx.from.id); return; }
        clearSession(ctx.from.id);
        return sendBroadcast(ctx, text);
      }

      default:
        return ctx.reply(
          '👋 Use the buttons below or /start to open the menu\\.',
          { parse_mode: 'MarkdownV2', reply_markup: mainReplyKeyboard() }
        );
    }
  });

  // ─── Error handler ───────────────────────────────────────────────────────────
  bot.catch((err, ctx) => {
    console.error(`[ERROR] ${ctx?.updateType}:`, err.message);
  });

  // ─── Launch ──────────────────────────────────────────────────────────────────
  await bot.launch({ dropPendingUpdates: true });
  console.log('🤖 EthioP2P Bot is running...');

  process.once('SIGINT',  () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main().catch(console.error);
