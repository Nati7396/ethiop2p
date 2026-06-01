const { Markup } = require('telegraf');
const { paymentQueries } = require('../database');
const { getOrCreateUser, isWhitelisted, formatPaymentInfo } = require('../helpers');
const { setSession } = require('../sessions');

async function handlePayment(ctx) {
  const user = getOrCreateUser(ctx);
  if (!isWhitelisted(user)) return ctx.reply('⛔ You are not whitelisted.');

  const info = paymentQueries.get.get(user.id);
  const current = formatPaymentInfo(info);

  await ctx.reply(`💳 *Payment Info*\n\nCurrent details:\n${current}\n\nWhat would you like to update?`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🏦 Bank Details', 'pay_set_bank'), Markup.button.callback('📱 Telebirr', 'pay_set_telebirr')],
      [Markup.button.callback('📱 M-Pesa', 'pay_set_mpesa')],
    ]),
  });
}

async function handleSetBank(ctx) {
  setSession(ctx.from.id, 'set_bank_name', {});
  await ctx.reply('🏦 Enter your *bank name* (e.g., CBE, Awash, Abyssinia):', { parse_mode: 'Markdown' });
  await ctx.answerCbQuery();
}

async function handleSetTelebirr(ctx) {
  setSession(ctx.from.id, 'set_telebirr', {});
  await ctx.reply('📱 Enter your *Telebirr phone number*:', { parse_mode: 'Markdown' });
  await ctx.answerCbQuery();
}

async function handleSetMpesa(ctx) {
  setSession(ctx.from.id, 'set_mpesa', {});
  await ctx.reply('📱 Enter your *M-Pesa phone number*:', { parse_mode: 'Markdown' });
  await ctx.answerCbQuery();
}

module.exports = { handlePayment, handleSetBank, handleSetTelebirr, handleSetMpesa };
