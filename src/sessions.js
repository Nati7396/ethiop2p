const { sessionQueries } = require('./database');

function getSession(telegramId) {
  const row = sessionQueries.get.get(String(telegramId));
  if (!row) return { state: null, data: {} };
  return {
    state: row.state,
    data: row.data ? JSON.parse(row.data) : {},
  };
}

function setSession(telegramId, state, data = {}) {
  sessionQueries.set.run(String(telegramId), state, JSON.stringify(data));
}

function clearSession(telegramId) {
  sessionQueries.clear.run(String(telegramId));
}

module.exports = { getSession, setSession, clearSession };
