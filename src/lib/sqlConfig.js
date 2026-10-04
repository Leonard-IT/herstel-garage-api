'use strict';

const sql = require('mssql');

// mssql only maps "Authentication=Active Directory Integrated" to Entra ID login; any other value
// (including "Active Directory Default") silently becomes a SQL login without credentials and fails with
// "Login failed for user ''". Map the documented Microsoft values explicitly to DefaultAzureCredential, which uses
// the Azure CLI login in the pipeline and the managed identity in the Function App.
const ENTRA_AUTHENTICATION = /(?:^|;)\s*Authentication\s*=\s*Active\s*Directory\s*(?:Default|Managed\s*Identity)\s*(?:;|$)/i;

function buildSqlConfig(connectionString) {
  if (!connectionString) throw new Error('SQL_CONNECTION_STRING is not configured');
  const config = sql.ConnectionPool.parseConnectionString(connectionString);
  if (ENTRA_AUTHENTICATION.test(connectionString)) {
    delete config.authentication_type;
    config.authentication = { type: 'azure-active-directory-default' };
  }
  return config;
}

module.exports = { buildSqlConfig };
