const https = require('https');

let cache = {};
const CACHE_TTL = 60 * 1000; // 60 seconds

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'EthioP2P/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// Get ETB per 1 USD from exchange rate API
async function getEtbRate() {
  const key = 'etb_rate';
  if (cache[key] && Date.now() - cache[key].ts < CACHE_TTL) return cache[key].value;
  try {
    const data = await fetchJson('https://open.er-api.com/v6/latest/USD');
    const rate = data.rates?.ETB;
    if (rate) {
      cache[key] = { value: rate, ts: Date.now() };
      return rate;
    }
  } catch (e) {
    console.error('[Market] ETB rate fetch failed:', e.message);
  }
  // Fallback rate ~130 ETB per USD (approximate)
  return cache[key]?.value || 130;
}

// Get Binance spot price in USDT for a symbol
async function getBinancePrice(symbol) {
  const key = `binance_${symbol}`;
  if (cache[key] && Date.now() - cache[key].ts < CACHE_TTL) return cache[key].value;
  try {
    const pair = symbol === 'USDT' ? 'USDTBUSD' : `${symbol}USDT`;
    // Use BTCUSDT, ETHUSDT directly; USDT = 1 USD
    const data = await fetchJson(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol === 'USDT' ? 'USDCUSDT' : `${symbol}USDT`}`);
    const price = parseFloat(data.price);
    if (!isNaN(price)) {
      cache[key] = { value: price, ts: Date.now() };
      return price;
    }
  } catch (e) {
    // Silently fail — use cached or fallback
  }
  return cache[key]?.value || null;
}

// Get market price of 1 unit of crypto in ETB
async function getMarketPriceETB(crypto) {
  const etbRate = await getEtbRate();
  if (crypto === 'USDT') {
    // 1 USDT ≈ 1 USD
    return etbRate;
  }
  const usdPrice = await getBinancePrice(crypto);
  if (!usdPrice) return null;
  return usdPrice * etbRate;
}

// Returns a formatted price hint string
async function getPriceHint(crypto, userPricePerUnit) {
  try {
    const marketPrice = await getMarketPriceETB(crypto);
    if (!marketPrice) return null;

    const diff = ((userPricePerUnit - marketPrice) / marketPrice) * 100;
    const diffStr = diff >= 0 ? `+${diff.toFixed(1)}%` : `${diff.toFixed(1)}%`;
    const icon = Math.abs(diff) < 2 ? '🟰' : diff > 0 ? '📈' : '📉';
    const etbStr = Number(marketPrice).toLocaleString('en-ET', { maximumFractionDigits: 0 });

    return `${icon} Market: ~${etbStr} ETB/${crypto} \\(your price is ${diffStr}\\)`;
  } catch (e) {
    return null;
  }
}

// Get all 3 crypto prices at once for /stats or price command
async function getAllPrices() {
  const etbRate = await getEtbRate();
  const results = {};
  for (const sym of ['BTC', 'ETH', 'USDT']) {
    if (sym === 'USDT') {
      results[sym] = etbRate;
    } else {
      const usd = await getBinancePrice(sym);
      results[sym] = usd ? usd * etbRate : null;
    }
  }
  return { prices: results, etbRate };
}

module.exports = { getMarketPriceETB, getPriceHint, getAllPrices, getEtbRate };
