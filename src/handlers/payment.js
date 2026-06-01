const { Markup } = require('telegraf');
const { paymentQueries } = require('../database');
const { getOrCreateUser, isWhitelisted, formatPaymentInfo, escMd } = require('../helpers');
const { setSession } = require('../sessions');

async function handlePayment(ctx) {
  const user = getOrCreateUser(ctx);
  if (!isWhitelisted(user)) return ctx.reply('⛔ You are not whitelisted\\.', { parse_mode: 'MarkdownV2' });

  const info = paymentQueries.get.get(user.id);
  const current = formatPaymentInfo(info);

  await ctx.reply(
    `💳 *Your Payment Info*\n\n${current}\n\nWhat would you like to update\\?`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🏦 Bank Details', 'pay_set_bank')],
        [Markup.button.callback('📱 Telebirr Number', 'pay_set_telebirr')],
        [Markup.button.callback('📱 M-Pesa Number', 'pay_set_mpesa')],
      ]),
    }
  );
}

async function handleSetBank(ctx) {
  setSession(ctx.from.id, 'set_bank_name', {});
  await ctx.reply('🏦 Enter your *bank name*\n_e\\.g\\. CBE, Awash, Abyssinia, Dashen_', { parse_mode: 'MarkdownV2' });
  if (ctx.callbackQuery) await ctx.answerCbQuery();
}

async function handleSetTelebirr(ctx) {
  setSession(ctx.from.id, 'set_telebirr', {});
  await ctx.reply('📱 Enter your *Telebirr phone number*:', { parse_mode: 'MarkdownV2' });
  if (ctx.callbackQuery) await ctx.answerCbQuery();
}

async function handleSetMpesa(ctx) {
  setSession(ctx.from.id, 'set_mpesa', {});
  await ctx.reply('📱 Enter your *M\\-Pesa phone number*:', { parse_mode: 'MarkdownV2' });
  if (ctx.callbackQuery) await ctx.answerCbQuery();
}

module.exports = { handlePayment, handleSetBank, handleSetTelebirr, handleSetMpesa };
