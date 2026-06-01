const cron = require('node-cron');
const { adQueries, tradeQueries } = require('./database');

function startCronJobs(bot) {
  // Expire ads every 15 minutes
  cron.schedule('*/15 * * * *', () => {
    const result = adQueries.expire.run();
    if (result.changes > 0) {
      console.log(`[CRON] Expired ${result.changes} ads`);
    }
  });

  // Expire trades every 10 minutes
  cron.schedule('*/10 * * * *', async () => {
    const result = tradeQueries.expireOld.run();
    if (result.changes > 0) {
      console.log(`[CRON] Expired ${result.changes} trades`);
    }
  });

  console.log('[CRON] Jobs started');
}

module.exports = { startCronJobs };
