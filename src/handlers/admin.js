const { Markup } = require('telegraf');
const { userQueries, adQueries, tradeQueries } = require('../database');
const { getOrCreateUser, isAdmin, formatETB, escMd } = require('../helpers');

async function handleAdmin(ctx) {
  const user = getOrCreateUser(ctx);
  if (!isAdmin(user)) return ctx.reply('⛔ Access denied\\. Admin only\\.', { parse_mode: 'MarkdownV2' });

  await ctx.reply('🔐 *Admin Panel*', {
    parse_mode: 'MarkdownV2',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('👥 Users', 'admin_users'), Markup.button.callback('📋 Active Ads', 'admin_ads')],
      [Markup.button.callback('🔄 All Trades', 'admin_trades'), Markup.button.callback('⚠️ Disputes', 'admin_disputes')],
      [Markup.button.callback('➕ Whitelist User', 'admin_whitelist'), Markup.button.callback('➖ Remove User', 'admin_unwhitelist')],
      [Markup.button.callback('📢 Broadcast', 'admin_broadcast')],
    ]),
  });
}

async function handleAdminUsers(ctx) {
  const user = getOrCreateUser(ctx);
  if (!isAdmin(user)) return ctx.answerCbQuery('Access denied.', { show_alert: true });
  await ctx.answerCbQuery();

  const users = userQueries.getAll.all();
  if (users.length === 0) return ctx.editMessageText('No users yet.');

  let text = '👥 *All Users:*\n\n';
  for (const u of users.slice(0, 20)) {
    const status = u.is_admin ? '👑' : u.is_whitelisted ? '✅' : '🔒';
    const uLink = u.username
      ? `[${escMd(u.name)}](https://t.me/${u.username})`
      : `[${escMd(u.name)}](tg://user?id=${u.telegram_id})`;
    text += `${status} ${uLink} — ID: \`${u.telegram_id}\` \\| ${u.total_trades} trades\n`;
  }

  await ctx.editMessageText(text, {
    parse_mode: 'MarkdownV2',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('➕ Whitelist', 'admin_whitelist'), Markup.button.callback('➖ Remove', 'admin_unwhitelist')],
      [Markup.button.callback('🔙 Back', 'admin_back')],
    ]),
  });
}

async function handleAdminTrades(ctx) {
  const user = getOrCreateUser(ctx);
  if (!isAdmin(user)) return ctx.answerCbQuery('Access denied.', { show_alert: true });
  await ctx.answerCbQuery();

  const trades = tradeQueries.getAll.all();
  if (trades.length === 0) return ctx.editMessageText('No trades yet.');

  let text = '🔄 *Recent Trades:*\n\n';
  for (const t of trades.slice(0, 15)) {
    text += `\\#${t.id} — ${escMd(t.buyer_name)} → ${escMd(t.seller_name)} \\| ${escMd(formatETB(t.total_etb))} \\| ${escMd(t.status)}\n`;
  }

  await ctx.editMessageText(text, {
    parse_mode: 'MarkdownV2',
    ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'admin_back')]]),
  });
}

async function handleAdminDisputes(ctx) {
  const user = getOrCreateUser(ctx);
  if (!isAdmin(user)) return ctx.answerCbQuery('Access denied.', { show_alert: true });
  await ctx.answerCbQuery();

  const disputes = tradeQueries.getDisputed.all();
  if (disputes.length === 0) return ctx.editMessageText('✅ No active disputes\\!', { parse_mode: 'MarkdownV2' });

  let text = '⚠️ *Active Disputes:*\n\n';
  for (const t of disputes) {
    const bLink = t.buyer_telegram_id
      ? `[${escMd(t.buyer_name)}](tg://user?id=${t.buyer_telegram_id})`
      : escMd(t.buyer_name);
    const sLink = t.seller_telegram_id
      ? `[${escMd(t.seller_name)}](tg://user?id=${t.seller_telegram_id})`
      : escMd(t.seller_name);
    text += `*Trade \\#${t.id}*\nBuyer: ${bLink} \\| Seller: ${sLink}\nAmount: ${escMd(formatETB(t.total_etb))}\nReason: ${escMd(t.dispute_reason || 'Not specified')}\n\n`;
  }

  const buttons = disputes.slice(0, 5).map(t => [
    Markup.button.callback(`✅ Resolve #${t.id}`, `resolve_dispute_${t.id}`),
    Markup.button.callback(`❌ Cancel #${t.id}`, `cancel_trade_${t.id}`),
  ]);
  buttons.push([Markup.button.callback('🔙 Back', 'admin_back')]);

  await ctx.editMessageText(text, { parse_mode: 'MarkdownV2', ...Markup.inlineKeyboard(buttons) });
}

async function handleResolveDispute(ctx, tradeId) {
  const user = getOrCreateUser(ctx);
  if (!isAdmin(user)) return ctx.answerCbQuery('Access denied.', { show_alert: true });
  await ctx.answerCbQuery('Trade resolved.');

  const trade = tradeQueries.getById.get(tradeId);
  if (!trade) return ctx.reply('Trade not found.');

  tradeQueries.complete.run(tradeId);
  await ctx.reply(`✅ Trade \\#${tradeId} resolved as completed by admin\\.`, { parse_mode: 'MarkdownV2' });

  for (const tid of [trade.buyer_telegram_id, trade.seller_telegram_id]) {
    try {
      await ctx.telegram.sendMessage(tid, `✅ Trade \\#${tradeId} dispute resolved by admin\\. Marked as completed\\.`, { parse_mode: 'MarkdownV2' });
    } catch (e) {}
  }
}

async function handleAdminAds(ctx) {
  const user = getOrCreateUser(ctx);
  if (!isAdmin(user)) return ctx.answerCbQuery('Access denied.', { show_alert: true });
  await ctx.answerCbQuery();

  const ads = adQueries.getActive.all();
  if (ads.length === 0) return ctx.editMessageText('No active ads right now\\!', { parse_mode: 'MarkdownV2' });

  let text = `📋 *Active Ads \\(${ads.length}\\):*\n\n`;
  for (const ad of ads.slice(0, 15)) {
    text += `\\#${ad.id} — ${escMd(ad.type.toUpperCase())} ${escMd(String(ad.amount))} ${ad.crypto} @ ${escMd(formatETB(ad.price_per_unit))} by ${escMd(ad.name)}\n`;
  }

  await ctx.editMessageText(text, {
    parse_mode: 'MarkdownV2',
    ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'admin_back')]]),
  });
}

async function handleWhitelistPrompt(ctx, action) {
  const user = getOrCreateUser(ctx);
  if (!isAdmin(user)) return ctx.answerCbQuery('Access denied.', { show_alert: true });
  await ctx.answerCbQuery();

  const { setSession } = require('../sessions');
  setSession(ctx.from.id, action === 'add' ? 'admin_whitelist_id' : 'admin_unwhitelist_id', {});
  await ctx.reply(
    `Enter the *Telegram ID* of the user to ${action === 'add' ? '✅ whitelist' : '❌ remove'}:\n\n_\\(They must have started the bot first\\)_`,
    { parse_mode: 'MarkdownV2' }
  );
}

async function handleBroadcastPrompt(ctx) {
  const user = getOrCreateUser(ctx);
  if (!isAdmin(user)) return ctx.answerCbQuery('Access denied.', { show_alert: true });
  await ctx.answerCbQuery();

  const { setSession } = require('../sessions');
  setSession(ctx.from.id, 'admin_broadcast', {});
  await ctx.reply('📢 Type the broadcast message to send to all whitelisted users:');
}

async function sendBroadcast(ctx, message) {
  const users = userQueries.getAllWhitelisted.all();
  let sent = 0;
  for (const u of users) {
    try {
      await ctx.telegram.sendMessage(u.telegram_id, `📢 *Announcement from EthioP2P:*\n\n${escMd(message)}`, { parse_mode: 'MarkdownV2' });
      sent++;
    } catch (e) {}
  }
  await ctx.reply(`✅ Broadcast sent to *${sent}*/${users.length} users\\.`, { parse_mode: 'MarkdownV2' });
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
