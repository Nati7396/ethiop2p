const { tradeQueries } = require('../database');
const { formatETB } = require('../helpers');

async function handleStats(ctx) {
  const today = tradeQueries.statsToday.get();
  const week = tradeQueries.statsWeek.get();
  const month = tradeQueries.statsMonth.get();
  const topCrypto = tradeQueries.popularCrypto.get();
  const topPay = tradeQueries.popularPayment.get();

  const text = `
📊 *EthioP2P Global Stats*

📅 *Today:*
  Trades: ${today.count || 0}
  Volume: ${formatETB(today.volume || 0)}

📆 *This Week:*
  Trades: ${week.count || 0}
  Volume: ${formatETB(week.volume || 0)}

🗓️ *This Month:*
  Trades: ${month.count || 0}
  Volume: ${formatETB(month.volume || 0)}

🏆 Most Traded: ${topCrypto ? topCrypto.crypto : 'N/A'}
💳 Top Payment: ${topPay ? topPay.payment_method : 'N/A'}
`.trim();

  await ctx.reply(text, { parse_mode: 'Markdown' });
}

module.exports = { handleStats };
