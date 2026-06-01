const { Markup } = require('telegraf');
const { userQueries, adQueries, tradeQueries, feedbackQueries } = require('../database');
const { getOrCreateUser, isAdmin, formatTrade, formatAd, formatETB, escMd } = require('../helpers');

async function handleAdmin(ctx) {
  const user = getOrCreateUser(ctx);
  if (!isAdmin(user)) return ctx.reply('⛔ Access denied.');

  await ctx.reply('🔐 *Admin Panel*', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('👥 Users', 'admin_users'), Markup.button.callback('📋 All Ads', 'admin_ads')],
      [Markup.button.callback('🔄 All Trades', 'admin_trades'), Markup.button.callback('⚠️ Disputes', 'admin_disputes')],
      [Markup.button.callback('📢 Broadcast', 'admin_broadcast'), Markup.button.callback('📊 Stats', 'stats')],
    ]),
  });
}

async function handleAdminUsers(ctx) {
  const user = getOrCreateUser(ctx);
  if (!isAdmin(user)) return ctx.answerCbQuery('Access denied.', { show_alert: true });

  const users = userQueries.getAll.all();
  if (users.length === 0) return ctx.editMessageText('No users yet.');

  let text = '👥 *All Users:*\n\n';
  for (const u of users.slice(0, 20)) {
    const status = u.is_admin ? '👑 Admin' : u.is_whitelisted ? '✅ Whitelisted' : '🔒 Blocked';
    text += `• ${escMd(u.name)} (@${escMd(u.username || 'N/A')}) — ${status}\n  ID: \`${u.telegram_id}\` | Trades: ${u.total_trades}\n`;
  }

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('➕ Whitelist User', 'admin_whitelist'), Markup.button.callback('➖ Remove User', 'admin_unwhitelist')],
      [Markup.button.callback('🔙 Back', 'admin_back')],
    ]),
  });
}

async function handleAdminTrades(ctx) {
  const user = getOrCreateUser(ctx);
  if (!isAdmin(user)) return;

  const trades = tradeQueries.getAll.all();
  if (trades.length === 0) return ctx.editMessageText('No trades yet.');

  let text = '🔄 *Recent Trades (last 50):*\n\n';
  for (const t of trades.slice(0, 15)) {
    text += `#${t.id} — ${t.buyer_name} → ${t.seller_name} | ${formatETB(t.total_etb)} | ${t.status}\n`;
  }

  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'admin_back')]]) });
}

async function handleAdminDisputes(ctx) {
  const user = getOrCreateUser(ctx);
  if (!isAdmin(user)) return;

  const disputes = tradeQueries.getDisputed.all();
  if (disputes.length === 0) return ctx.editMessageText('✅ No active disputes.');

  let text = '⚠️ *Active Disputes:*\n\n';
  for (const t of disputes) {
    text += `*Trade #${t.id}*\nBuyer: ${escMd(t.buyer_name)} | Seller: ${escMd(t.seller_name)}\nAmount: ${formatETB(t.total_etb)}\nReason: ${escMd(t.dispute_reason || 'Not specified')}\n\n`;
  }

  const buttons = disputes.slice(0, 5).map(t => [
    Markup.button.callback(`✅ Resolve #${t.id}`, `resolve_dispute_${t.id}`),
    Markup.button.callback(`❌ Cancel #${t.id}`, `cancel_trade_${t.id}`),
  ]);
  buttons.push([Markup.button.callback('🔙 Back', 'admin_back')]);

  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

async function handleResolveDispute(ctx, tradeId) {
  const user = getOrCreateUser(ctx);
  if (!isAdmin(user)) return ctx.answerCbQuery('Access denied.', { show_alert: true });

  const trade = tradeQueries.getById.get(tradeId);
  if (!trade) return ctx.answerCbQuery('Trade not found.', { show_alert: true });

  tradeQueries.complete.run(tradeId);
  await ctx.answerCbQuery('Trade resolved as completed.');
  await ctx.reply(`✅ Trade #${tradeId} resolved as completed.`);

  try {
    await ctx.telegram.sendMessage(trade.buyer_telegram_id, `✅ Trade #${tradeId} dispute has been resolved by admin. Trade marked as completed.`);
    await ctx.telegram.sendMessage(trade.seller_telegram_id, `✅ Trade #${tradeId} dispute has been resolved by admin. Trade marked as completed.`);
  } catch (e) {}
}

async function handleAdminAds(ctx) {
  const user = getOrCreateUser(ctx);
  if (!isAdmin(user)) return;

  const ads = adQueries.getActive.all();
  if (ads.length === 0) return ctx.editMessageText('No active ads.');

  let text = `📋 *Active Ads (${ads.length}):*\n\n`;
  for (const ad of ads.slice(0, 10)) {
    text += `#${ad.id} — ${ad.type.toUpperCase()} ${ad.amount} ${ad.crypto} @ ${formatETB(ad.price_per_unit)} by ${escMd(ad.name)}\n`;
  }

  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'admin_back')]]) });
}

async function handleWhitelistPrompt(ctx, action) {
  const user = getOrCreateUser(ctx);
  if (!isAdmin(user)) return;

  const { setSession } = require('../sessions');
  setSession(ctx.from.id, action === 'add' ? 'admin_whitelist_id' : 'admin_unwhitelist_id', {});
  await ctx.reply(`Enter the Telegram ID of the user to ${action === 'add' ? 'whitelist' : 'remove'}:`);
  await ctx.answerCbQuery();
}

async function handleBroadcastPrompt(ctx) {
  const user = getOrCreateUser(ctx);
  if (!isAdmin(user)) return;
  const { setSession } = require('../sessions');
  setSession(ctx.from.id, 'admin_broadcast', {});
  await ctx.reply('📢 Enter the broadcast message to send to all whitelisted users:');
  await ctx.answerCbQuery();
}

async function sendBroadcast(ctx, message) {
  const users = userQueries.getAllWhitelisted.all();
  let sent = 0;
  for (const u of users) {
    try {
      await ctx.telegram.sendMessage(u.telegram_id, `📢 *Broadcast from Admin:*\n\n${message}`, { parse_mode: 'Markdown' });
      sent++;
    } catch (e) {}
  }
  await ctx.reply(`✅ Broadcast sent to ${sent}/${users.length} users.`);
}

module.exports = {
  handleAdmin,
  handleAdminUsers,
  handleAdminTrades,
  handleAdminDisputes,
  handleResolveDispute,
  handleAdminAds,
  handleWhitelistPrompt,
  handleBroadcastPrompt,
  sendBroadcast,
};
