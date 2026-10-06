'use strict';

const { buildSqlConfig, connectWithRetry } = require('./sqlConfig');

let poolPromise;

function getPool() {
  if (!poolPromise) {
    poolPromise = connectWithRetry(buildSqlConfig(process.env.SQL_CONNECTION_STRING));
    poolPromise.catch(() => { poolPromise = undefined; });
  }
  return poolPromise;
}

module.exports = { getPool };
