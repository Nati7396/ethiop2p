const { Markup } = require('telegraf');
const { adQueries, tradeQueries, userQueries, paymentQueries, feedbackQueries, messageQueries } = require('../database');
const { getOrCreateUser, isAdmin, formatTrade, formatCrypto, formatETB, formatPaymentInfo, escMd, profileLink } = require('../helpers');
const { getSession, setSession, clearSession } = require('../sessions');

function tradeActionButtons(tradeId, role) {
  if (role === 'buyer') {
    return Markup.inlineKeyboard([
      [Markup.button.callback('✅ I Sent Payment', `confirm_buyer_${tradeId}`), Markup.button.callback('⚠️ Dispute', `dispute_${tradeId}`)],
      [Markup.button.callback('❌ Cancel Trade', `cancel_trade_${tradeId}`)],
    ]);
  }
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ I Received Payment', `confirm_seller_${tradeId}`), Markup.button.callback('⚠️ Dispute', `dispute_${tradeId}`)],
    [Markup.button.callback('❌ Cancel Trade', `cancel_trade_${tradeId}`)],
  ]);
}

async function handleInitiateTrade(ctx, adId) {
  const user = getOrCreateUser(ctx);
  const { isWhitelisted } = require('../helpers');
  if (!isWhitelisted(user)) return ctx.reply('⛔ Not whitelisted.');

  const ad = adQueries.getById.get(adId);
  if (!ad) return ctx.reply('Ad not found or expired.');
  if (ad.status !== 'active') return ctx.reply('This ad is no longer active.');
  if (String(ad.owner_telegram_id) === String(ctx.from.id)) return ctx.reply('❌ You cannot trade with your own ad\\!', { parse_mode: 'MarkdownV2' });

  const totalEtb = ad.amount * ad.price_per_unit;
  if (totalEtb > user.trade_limit) {
    return ctx.reply(
      `⚠️ This trade \\(${escMd(formatETB(totalEtb))}\\) exceeds your trade limit of *${escMd(formatETB(user.trade_limit))}*\\.\n\nComplete more trades to increase your limit\\.`,
      { parse_mode: 'MarkdownV2' }
    );
  }

  const methods = JSON.parse(ad.payment_methods || '[]');
  setSession(ctx.from.id, 'select_payment', { ad_id: adId, methods });

  await ctx.reply(
    `💱 *Trade Offer — Ad \\#${adId}*\n\nCrypto: *${escMd(formatCrypto(ad.crypto, ad.amount))}*\nPrice: *${escMd(formatETB(ad.price_per_unit))}* per ${ad.crypto}\nTotal: *${escMd(formatETB(totalEtb))}*\n\nSelect payment method:`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        methods.map(m => Markup.button.callback(m, `select_pay_${m}`)),
        [Markup.button.callback('❌ Cancel', 'cancel_flow')],
      ]),
    }
  );
}

async function handlePaymentMethodSelect(ctx, method) {
  const sess = getSession(ctx.from.id);
  const ad = adQueries.getById.get(sess.data.ad_id);
  if (!ad) return ctx.reply('Ad no longer available.');

  const initiator = getOrCreateUser(ctx);
  const ownerUser = userQueries.findByTelegramId.get(ad.owner_telegram_id);
  const totalEtb = ad.amount * ad.price_per_unit;

  let buyerId, sellerId, buyerUser, sellerUser;
  if (ad.type === 'sell') {
    buyerUser = initiator; sellerId = ownerUser.id;
    buyerId = initiator.id; sellerUser = ownerUser;
  } else {
    sellerUser = initiator; buyerId = ownerUser.id;
    sellerId = initiator.id; buyerUser = ownerUser;
  }

  const trade = tradeQueries.create.run(ad.id, buyerId, sellerId, ad.crypto, ad.amount, ad.price_per_unit, totalEtb, method);
  const tradeId = trade.lastInsertRowid;

  const sellerPayInfo = paymentQueries.get.get(sellerId);
  const paymentDetails = formatPaymentInfo(sellerPayInfo);

  clearSession(ctx.from.id);

  // Build profile links
  const buyerLink = buyerUser.username
    ? `[${escMd(buyerUser.name)}](https://t.me/${buyerUser.username})`
    : `[${escMd(buyerUser.name)}](tg://user?id=${buyerUser.telegram_id})`;
  const sellerLink = sellerUser.username
    ? `[${escMd(sellerUser.name)}](https://t.me/${sellerUser.username})`
    : `[${escMd(sellerUser.name)}](tg://user?id=${sellerUser.telegram_id})`;

  const tradeInfo = `🔄 *Trade \\#${tradeId} Started\\!*

💰 *${escMd(formatCrypto(ad.crypto, ad.amount))}* @ *${escMd(formatETB(ad.price_per_unit))}* per ${ad.crypto}
💵 Total: *${escMd(formatETB(totalEtb))}*
💳 Payment: *${escMd(method)}*

🛒 Buyer: ${buyerLink}
💰 Seller: ${sellerLink}

⏱️ Trade expires in *4 hours*\\.`;

  const sellerPaySection = `\n\n💳 *Seller Payment Details:*\n${paymentDetails}`;

  // Send to initiator (buyer of sell ad, or seller of buy ad)
  const forInitiator = tradeInfo + sellerPaySection;
  await ctx.reply(forInitiator, {
    parse_mode: 'MarkdownV2',
    ...tradeActionButtons(tradeId, initiator.id === buyerId ? 'buyer' : 'seller'),
  });

  // Notify the ad owner
  const forOwner = tradeInfo + `\n\n👤 *Your trade partner profile:*\n${initiator.id === buyerId ? buyerLink : sellerLink}`;
  try {
    await ctx.telegram.sendMessage(ownerUser.telegram_id, forOwner, {
      parse_mode: 'MarkdownV2',
      ...tradeActionButtons(tradeId, ownerUser.id === sellerId ? 'seller' : 'buyer'),
    });
  } catch (e) {
    console.error('Could not notify ad owner:', e.message);
  }
}

async function handleBuyerConfirm(ctx, tradeId) {
  const trade = tradeQueries.getById.get(tradeId);
  if (!trade) return ctx.answerCbQuery('Trade not found.', { show_alert: true });

  const u = userQueries.findByTelegramId.get(String(ctx.from.id));
  if (!u || u.id !== trade.buyer_id) return ctx.answerCbQuery('Only the buyer can confirm payment.', { show_alert: true });
  if (trade.status !== 'pending') return ctx.answerCbQuery(`Trade is already: ${trade.status}`, { show_alert: true });

  tradeQueries.buyerConfirm.run(tradeId);
  await ctx.answerCbQuery('✅ Payment confirmed!');
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  await ctx.reply(`✅ You confirmed payment for Trade \\#${tradeId}\\.\nWaiting for seller to confirm receipt\\.`, { parse_mode: 'MarkdownV2' });

  const sellerLink = trade.seller_telegram_id;
  const buyerDisplayLink = trade.buyer_username
    ? `[${escMd(trade.buyer_name)}](https://t.me/${trade.buyer_username})`
    : `[${escMd(trade.buyer_name)}](tg://user?id=${trade.buyer_telegram_id})`;

  try {
    await ctx.telegram.sendMessage(sellerLink,
      `💰 *Trade \\#${tradeId}* — Buyer ${buyerDisplayLink} has confirmed payment\\!\n\nPlease check and confirm you received it\\.`,
      {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ I Received Payment', `confirm_seller_${tradeId}`), Markup.button.callback('⚠️ Dispute', `dispute_${tradeId}`)],
        ]),
      }
    );
  } catch (e) {}
}

async function handleSellerConfirm(ctx, tradeId) {
  const trade = tradeQueries.getById.get(tradeId);
  if (!trade) return ctx.answerCbQuery('Trade not found.', { show_alert: true });

  const u = userQueries.findByTelegramId.get(String(ctx.from.id));
  if (!u || u.id !== trade.seller_id) return ctx.answerCbQuery('Only the seller can confirm receipt.', { show_alert: true });
  if (trade.status !== 'buyer_confirmed') return ctx.answerCbQuery('Buyer must confirm payment first.', { show_alert: true });

  tradeQueries.sellerConfirm.run(tradeId);
  tradeQueries.complete.run(tradeId);
  adQueries.complete.run(trade.ad_id);

  await ctx.answerCbQuery('🎉 Trade completed!');
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

  const completeMsg = `🎉 *Trade \\#${tradeId} Completed\\!*\n\nPlease rate your trading partner:`;

  const ratingButtons = (partnerId) => Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Positive', `rate_${tradeId}_${partnerId}_1`),
      Markup.button.callback('⚪ Neutral', `rate_${tradeId}_${partnerId}_0`),
      Markup.button.callback('❌ Negative', `rate_${tradeId}_${partnerId}_-1`),
    ],
  ]);

  try {
    await ctx.telegram.sendMessage(trade.buyer_telegram_id, completeMsg, {
      parse_mode: 'MarkdownV2',
      ...ratingButtons(trade.seller_id),
    });
  } catch (e) {}

  await ctx.reply(completeMsg, { parse_mode: 'MarkdownV2', ...ratingButtons(trade.buyer_id) });
}

async function handleDispute(ctx, tradeId) {
  const trade = tradeQueries.getById.get(tradeId);
  if (!trade) return ctx.answerCbQuery('Trade not found.', { show_alert: true });

  const u = userQueries.findByTelegramId.get(String(ctx.from.id));
  if (!u || (u.id !== trade.buyer_id && u.id !== trade.seller_id)) {
    return ctx.answerCbQuery('Not your trade.', { show_alert: true });
  }

  setSession(ctx.from.id, 'dispute_reason', { trade_id: tradeId });
  await ctx.answerCbQuery();
  await ctx.reply(`⚠️ *Dispute Trade \\#${tradeId}*\n\nBriefly describe the issue:`, { parse_mode: 'MarkdownV2' });
}

async function handleCancelTrade(ctx, tradeId) {
  const trade = tradeQueries.getById.get(tradeId);
  if (!trade) return ctx.answerCbQuery('Trade not found.', { show_alert: true });
  if (trade.status !== 'pending') return ctx.answerCbQuery('Trade can only be cancelled while pending.', { show_alert: true });

  const u = userQueries.findByTelegramId.get(String(ctx.from.id));
  if (!u || (u.id !== trade.buyer_id && u.id !== trade.seller_id)) {
    return ctx.answerCbQuery('Not your trade.', { show_alert: true });
  }

  tradeQueries.cancel.run(tradeId);
  await ctx.answerCbQuery('Trade cancelled.');
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  await ctx.reply(`❌ Trade \\#${tradeId} has been cancelled\\.`, { parse_mode: 'MarkdownV2' });

  const otherId = u.id === trade.buyer_id ? trade.seller_telegram_id : trade.buyer_telegram_id;
  try {
    await ctx.telegram.sendMessage(otherId, `❌ Trade \\#${tradeId} was cancelled by your trade partner\\.`, { parse_mode: 'MarkdownV2' });
  } catch (e) {}
}

async function handleRating(ctx, tradeId, toUserId, rating) {
  const fromUser = userQueries.findByTelegramId.get(String(ctx.from.id));
  if (!fromUser) return ctx.answerCbQuery('User not found.', { show_alert: true });

  const already = feedbackQueries.exists.get(tradeId, fromUser.id);
  if (already) return ctx.answerCbQuery('You already rated this trade!', { show_alert: true });

  setSession(ctx.from.id, 'rating_comment', { trade_id: tradeId, to_user_id: toUserId, rating });
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

  const icon = rating === 1 ? '✅ Positive' : rating === -1 ? '❌ Negative' : '⚪ Neutral';
  await ctx.reply(
    `You selected: *${escMd(icon)}*\n\nAdd a short comment \\(max 100 chars\\) or skip:`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([[Markup.button.callback('⏭️ Skip comment', 'skip_comment')]]),
    }
  );
}

async function handleTradeChat(ctx, tradeId) {
  const u = userQueries.findByTelegramId.get(String(ctx.from.id));
  const trade = tradeQueries.getById.get(tradeId);
  if (!trade) return ctx.reply('Trade not found.');
  if (!u || (u.id !== trade.buyer_id && u.id !== trade.seller_id)) {
    return ctx.reply('This is not your trade.');
  }

  const messages = messageQueries.getByTrade.all(tradeId);
  const chatLog = messages.length === 0
    ? '_No messages yet\\._'
    : messages.map(m => `*${escMd(m.name)}:* ${escMd(m.message)}`).join('\n');

  await ctx.reply(
    `💬 *Trade \\#${tradeId} Chat:*\n\n${chatLog}\n\nType your message \\(forwarded to your partner\\):`,
    { parse_mode: 'MarkdownV2' }
  );
  setSession(ctx.from.id, 'trade_chat', { trade_id: tradeId });
}

module.exports = {
  handleInitiateTrade,
  handlePaymentMethodSelect,
  handleBuyerConfirm,
  handleSellerConfirm,
  handleDispute,
  handleCancelTrade,
  handleRating,
  handleTradeChat,
};
