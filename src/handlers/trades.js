const { Markup } = require('telegraf');
const { adQueries, tradeQueries, userQueries, paymentQueries, feedbackQueries, messageQueries } = require('../database');
const { getOrCreateUser, isWhitelisted, isAdmin, formatTrade, formatCrypto, formatETB, formatPaymentInfo, escMd } = require('../helpers');
const { getSession, setSession, clearSession } = require('../sessions');

async function handleInitiateTrade(ctx, adId) {
  const user = getOrCreateUser(ctx);
  if (!isWhitelisted(user)) return ctx.reply('⛔ Not whitelisted.');

  const ad = adQueries.getById.get(adId);
  if (!ad) return ctx.reply('Ad not found or expired.');
  if (ad.status !== 'active') return ctx.reply('This ad is no longer active.');
  if (String(ad.owner_telegram_id) === String(ctx.from.id)) return ctx.reply('❌ You cannot trade with your own ad!');

  const totalEtb = ad.amount * ad.price_per_unit;
  if (totalEtb > user.trade_limit) {
    return ctx.reply(`⚠️ This trade (${formatETB(totalEtb)}) exceeds your trade limit of ${formatETB(user.trade_limit)}.\n\nComplete more trades to increase your limit.`);
  }

  const methods = JSON.parse(ad.payment_methods || '[]');
  setSession(ctx.from.id, 'select_payment', { ad_id: adId, methods });

  await ctx.reply(`💱 *Trade Offer — Ad #${adId}*\n\nCrypto: *${formatCrypto(ad.crypto, ad.amount)}*\nPrice: *${formatETB(ad.price_per_unit)}* per ${ad.crypto}\nTotal: *${formatETB(totalEtb)}*\n\nSelect payment method:`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      methods.map(m => Markup.button.callback(m, `select_pay_${m}`)),
      [Markup.button.callback('❌ Cancel', 'cancel_flow')],
    ]),
  });
}

async function handlePaymentMethodSelect(ctx, method) {
  const sess = getSession(ctx.from.id);
  const ad = adQueries.getById.get(sess.data.ad_id);
  if (!ad) return ctx.reply('Ad no longer available.');

  const buyer = getOrCreateUser(ctx);
  const sellerUser = userQueries.findByTelegramId.get(ad.owner_telegram_id);
  const totalEtb = ad.amount * ad.price_per_unit;

  let buyerId, sellerId;
  if (ad.type === 'sell') {
    buyerId = buyer.id;
    sellerId = sellerUser.id;
  } else {
    buyerId = sellerUser.id;
    sellerId = buyer.id;
  }

  const trade = tradeQueries.create.run(ad.id, buyerId, sellerId, ad.crypto, ad.amount, ad.price_per_unit, totalEtb, method);
  const tradeId = trade.lastInsertRowid;

  const sellerPayInfo = paymentQueries.get.get(sellerId);
  const paymentDetails = formatPaymentInfo(sellerPayInfo);

  clearSession(ctx.from.id);

  const tradeMsg = `🔄 *Trade #${tradeId} Started!*\n\n${formatCrypto(ad.crypto, ad.amount)} @ ${formatETB(ad.price_per_unit)}\n💵 Total: *${formatETB(totalEtb)}*\n💳 Payment: ${method}\n\n💰 *Seller Payment Details:*\n${paymentDetails}\n\n⏱️ Trade expires in 4 hours.`;

  const tradeButtons = Markup.inlineKeyboard([
    [Markup.button.callback('✅ I Confirmed Payment', `confirm_buyer_${tradeId}`), Markup.button.callback('⚠️ Dispute', `dispute_${tradeId}`)],
    [Markup.button.callback('❌ Cancel Trade', `cancel_trade_${tradeId}`)],
  ]);

  const sellerButtons = Markup.inlineKeyboard([
    [Markup.button.callback('✅ I Received Payment', `confirm_seller_${tradeId}`), Markup.button.callback('⚠️ Dispute', `dispute_${tradeId}`)],
    [Markup.button.callback('❌ Cancel Trade', `cancel_trade_${tradeId}`)],
  ]);

  await ctx.reply(tradeMsg, { parse_mode: 'Markdown', ...tradeButtons });

  try {
    await ctx.telegram.sendMessage(sellerUser.telegram_id, `📢 *New Trade Request — #${tradeId}!*\n\nSomeone wants to trade with your ad.\n\n${tradeMsg}`, {
      parse_mode: 'Markdown',
      ...sellerButtons,
    });
  } catch (e) {
    console.error('Could not notify seller:', e.message);
  }
}

async function handleBuyerConfirm(ctx, tradeId) {
  const user = getOrCreateUser(ctx);
  const trade = tradeQueries.getById.get(tradeId);
  if (!trade) return ctx.answerCbQuery('Trade not found.', { show_alert: true });

  const buyer = userQueries.findByTelegramId.get(String(ctx.from.id));
  if (!buyer || buyer.id !== trade.buyer_id) return ctx.answerCbQuery('Only the buyer can do this.', { show_alert: true });
  if (trade.status !== 'pending') return ctx.answerCbQuery(`Trade status is already: ${trade.status}`, { show_alert: true });

  tradeQueries.buyerConfirm.run(tradeId);
  await ctx.answerCbQuery('✅ Payment confirmed! Waiting for seller...');
  await ctx.editMessageReplyMarkup(null);
  await ctx.reply(`✅ You confirmed payment for Trade #${tradeId}. Waiting for seller to confirm receipt.`);

  try {
    await ctx.telegram.sendMessage(trade.seller_telegram_id, `💰 *Trade #${tradeId}* — Buyer has confirmed payment!\n\nPlease check and confirm you received the payment.`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ I Received Payment', `confirm_seller_${tradeId}`), Markup.button.callback('⚠️ Dispute', `dispute_${tradeId}`)],
      ]),
    });
  } catch (e) {}
}

async function handleSellerConfirm(ctx, tradeId) {
  const trade = tradeQueries.getById.get(tradeId);
  if (!trade) return ctx.answerCbQuery('Trade not found.', { show_alert: true });

  const seller = userQueries.findByTelegramId.get(String(ctx.from.id));
  if (!seller || seller.id !== trade.seller_id) return ctx.answerCbQuery('Only the seller can do this.', { show_alert: true });
  if (trade.status !== 'buyer_confirmed') return ctx.answerCbQuery('Buyer must confirm first.', { show_alert: true });

  tradeQueries.sellerConfirm.run(tradeId);
  tradeQueries.complete.run(tradeId);
  adQueries.complete.run(trade.ad_id);

  await ctx.answerCbQuery('🎉 Trade completed!');
  await ctx.editMessageReplyMarkup(null);

  const completeMsg = `🎉 *Trade #${tradeId} Completed!*\n\nPlease rate your trading partner.`;
  const ratingButtons = (partnerId) => Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Positive', `rate_${tradeId}_${partnerId}_1`),
      Markup.button.callback('⚪ Neutral', `rate_${tradeId}_${partnerId}_0`),
      Markup.button.callback('❌ Negative', `rate_${tradeId}_${partnerId}_-1`),
    ],
  ]);

  try {
    await ctx.telegram.sendMessage(trade.buyer_telegram_id, completeMsg, {
      parse_mode: 'Markdown',
      ...ratingButtons(trade.seller_id),
    });
  } catch (e) {}

  await ctx.reply(completeMsg, { parse_mode: 'Markdown', ...ratingButtons(trade.buyer_id) });
}

async function handleDispute(ctx, tradeId) {
  const user = getOrCreateUser(ctx);
  const trade = tradeQueries.getById.get(tradeId);
  if (!trade) return ctx.answerCbQuery('Trade not found.', { show_alert: true });

  const u = userQueries.findByTelegramId.get(String(ctx.from.id));
  if (!u || (u.id !== trade.buyer_id && u.id !== trade.seller_id)) {
    return ctx.answerCbQuery('Not your trade.', { show_alert: true });
  }

  setSession(ctx.from.id, 'dispute_reason', { trade_id: tradeId });
  await ctx.reply(`⚠️ *Dispute Trade #${tradeId}*\n\nPlease describe the issue briefly:`, { parse_mode: 'Markdown' });
  await ctx.answerCbQuery();
}

async function handleCancelTrade(ctx, tradeId) {
  const trade = tradeQueries.getById.get(tradeId);
  if (!trade) return ctx.answerCbQuery('Trade not found.', { show_alert: true });
  if (!['pending'].includes(trade.status)) return ctx.answerCbQuery('Trade cannot be cancelled now.', { show_alert: true });

  const u = userQueries.findByTelegramId.get(String(ctx.from.id));
  if (!u || (u.id !== trade.buyer_id && u.id !== trade.seller_id)) {
    return ctx.answerCbQuery('Not your trade.', { show_alert: true });
  }

  tradeQueries.cancel.run(tradeId);
  await ctx.answerCbQuery('Trade cancelled.');
  await ctx.editMessageReplyMarkup(null);
  await ctx.reply(`❌ Trade #${tradeId} has been cancelled.`);

  const otherId = u.id === trade.buyer_id ? trade.seller_telegram_id : trade.buyer_telegram_id;
  try {
    await ctx.telegram.sendMessage(otherId, `❌ Trade #${tradeId} was cancelled by the other party.`);
  } catch (e) {}
}

async function handleRating(ctx, tradeId, toUserId, rating) {
  const fromUser = userQueries.findByTelegramId.get(String(ctx.from.id));
  if (!fromUser) return ctx.answerCbQuery('User not found.', { show_alert: true });

  const already = feedbackQueries.exists.get(tradeId, fromUser.id);
  if (already) return ctx.answerCbQuery('You already rated this trade!', { show_alert: true });

  setSession(ctx.from.id, 'rating_comment', { trade_id: tradeId, to_user_id: toUserId, rating });
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(null);
  await ctx.reply(`You selected: ${rating === 1 ? '✅ Positive' : rating === -1 ? '❌ Negative' : '⚪ Neutral'}\n\nAdd a comment (max 100 chars) or tap Skip:`, {
    ...Markup.inlineKeyboard([[Markup.button.callback('⏭️ Skip', 'skip_comment')]]),
  });
}

async function handleTradeChat(ctx, tradeId) {
  const user = getOrCreateUser(ctx);
  const trade = tradeQueries.getById.get(tradeId);
  if (!trade) return ctx.reply('Trade not found.');

  const u = userQueries.findByTelegramId.get(String(ctx.from.id));
  if (!u || (u.id !== trade.buyer_id && u.id !== trade.seller_id)) {
    return ctx.reply('This is not your trade.');
  }

  const messages = messageQueries.getByTrade.all(tradeId);
  if (messages.length === 0) {
    await ctx.reply(`💬 *Trade #${tradeId} Chat* — No messages yet.\n\nSend a message now (it will be forwarded to your trade partner):`, { parse_mode: 'Markdown' });
  } else {
    const chatLog = messages.map(m => `[${m.name}]: ${escMd(m.message)}`).join('\n');
    await ctx.reply(`💬 *Trade #${tradeId} Chat:*\n\n${chatLog}\n\nSend a message to forward to your partner:`, { parse_mode: 'Markdown' });
  }

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
