const { tradeQueries } = require('../database');
const { formatETB, escMd } = require('../helpers');

async function handleStats(ctx) {
  const today = tradeQueries.statsToday.get();
  const week = tradeQueries.statsWeek.get();
  const month = tradeQueries.statsMonth.get();
  const topCrypto = tradeQueries.popularCrypto.get();
  const topPay = tradeQueries.popularPayment.get();

  const text = `📊 *EthioP2P Global Stats*

📅 *Today:*
  Trades: *${today.count || 0}*
  Volume: *${escMd(formatETB(today.volume || 0))}*

📆 *This Week:*
  Trades: *${week.count || 0}*
  Volume: *${escMd(formatETB(week.volume || 0))}*

🗓️ *This Month:*
  Trades: *${month.count || 0}*
  Volume: *${escMd(formatETB(month.volume || 0))}*

🏆 Most Traded: *${topCrypto ? topCrypto.crypto : 'N/A'}*
💳 Top Payment: *${topPay ? escMd(topPay.payment_method) : 'N/A'}*`;

  await ctx.reply(text, { parse_mode: 'MarkdownV2' });
}

module.exports = { handleStats };
