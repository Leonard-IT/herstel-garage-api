'use strict';

const sql = require('mssql');

// mssql only maps "Authentication=Active Directory Integrated" to Entra ID login; any other value
// (including "Active Directory Default") silently becomes a SQL login without credentials and fails with
// "Login failed for user ''". Map the documented Microsoft values explicitly to DefaultAzureCredential, which uses
// the Azure CLI login in the pipeline and the managed identity in the Function App.
const ENTRA_AUTHENTICATION = /(?:^|;)\s*Authentication\s*=\s*["']?\s*Active\s*Directory\s*(?:Default|Managed\s*Identity|MSI)\s*["']?\s*(?:;|$)/i;

function buildSqlConfig(connectionString) {
  if (!connectionString) throw new Error('SQL_CONNECTION_STRING is not configured');
  const config = sql.ConnectionPool.parseConnectionString(connectionString);
  if (process.env.SQL_ACCESS_TOKEN) {
    // Explicit token (pipeline): uses exactly the identity of the Azure CLI login instead of the credential chain.
    delete config.authentication_type;
    config.authentication = { type: 'azure-active-directory-access-token', options: { token: process.env.SQL_ACCESS_TOKEN } };
  } else if (ENTRA_AUTHENTICATION.test(connectionString)) {
    delete config.authentication_type;
    config.authentication = { type: 'azure-active-directory-default' };
  }
  return config;
}

// A serverless Azure SQL database that is auto-paused needs up to a minute to resume on the first connection,
// which exceeds the default 15s connect timeout. Retry transient connection failures with a longer timeout.
const TRANSIENT_CODES = ['ETIMEOUT', 'ESOCKET', 'ECONNCLOSED'];
const TRANSIENT_NUMBERS = [40197, 40501, 40613, 49918, 49919, 49920];

function isTransient(err) {
  return TRANSIENT_CODES.includes(err.code) || TRANSIENT_NUMBERS.includes(err.number ?? err.originalError?.number)
    || /not currently available|Failed to connect/i.test(err.message);
}

async function connectWithRetry(config, { attempts = 3, timeoutMs = 30000, delayMs = 5000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    const pool = new sql.ConnectionPool({ ...config, connectionTimeout: config.connectionTimeout ?? timeoutMs });
    try {
      return await pool.connect();
    } catch (err) {
      await pool.close().catch(() => {});
      if (attempt >= attempts || !isTransient(err)) throw err;
      console.log(`SQL connection attempt ${attempt} failed (${err.message}); retrying in ${delayMs / 1000}s (database may be resuming)`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

module.exports = { buildSqlConfig, connectWithRetry };
