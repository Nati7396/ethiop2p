const { tradeQueries } = require('../database');
const { formatETB, escMd } = require('../helpers');
const { getAllPrices } = require('../market');

async function handleStats(ctx) {
  const today = tradeQueries.statsToday.get();
  const week = tradeQueries.statsWeek.get();
  const month = tradeQueries.statsMonth.get();
  const topCrypto = tradeQueries.popularCrypto.get();
  const topPay = tradeQueries.popularPayment.get();

  let priceSection = '';
  try {
    const { prices, etbRate } = await getAllPrices();
    const fmt = (v) => v ? Number(v).toLocaleString('en-ET', { maximumFractionDigits: 0 }) : 'N/A';
    priceSection = `\n\n💹 *Live Market Prices \\(ETB\\):*
  BTC: *${escMd(fmt(prices.BTC))} ETB*
  ETH: *${escMd(fmt(prices.ETH))} ETB*
  USDT: *${escMd(fmt(prices.USDT))} ETB*
  _Rate: 1 USD ≈ ${escMd(fmt(etbRate))} ETB_`;
  } catch (_) {}

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
💳 Top Payment: *${topPay ? escMd(topPay.payment_method) : 'N/A'}*${priceSection}`;

  await ctx.reply(text, { parse_mode: 'MarkdownV2' });
}

module.exports = { handleStats };
