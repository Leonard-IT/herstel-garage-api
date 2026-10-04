'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Connection } = require('tedious');
const { buildSqlConfig } = require('../src/lib/sqlConfig');

test('Active Directory Default uses Entra ID (DefaultAzureCredential), not a SQL login', () => {
  const config = buildSqlConfig('Server=herstel.database.windows.net;Database=herstel;Authentication=Active Directory Default;Encrypt=true');
  assert.strictEqual(config.authentication.type, 'azure-active-directory-default');
  assert.strictEqual(config.authentication_type, undefined);
  assert.strictEqual(config.server, 'herstel.database.windows.net');
  assert.strictEqual(config.database, 'herstel');
});

test('Active Directory Managed Identity also maps to DefaultAzureCredential', () => {
  const config = buildSqlConfig('Server=x.database.windows.net;Database=herstel;Authentication=Active Directory Managed Identity;Encrypt=true');
  assert.strictEqual(config.authentication.type, 'azure-active-directory-default');
});

test('SQL login connection strings are left alone', () => {
  const config = buildSqlConfig('Server=localhost,1433;Database=herstel;User Id=sa;Password=pw;Encrypt=true;TrustServerCertificate=true');
  assert.strictEqual(config.authentication, undefined);
  assert.strictEqual(config.user, 'sa');
});

test('tedious accepts the Entra authentication config', () => {
  const connection = new Connection({
    server: 'localhost',
    authentication: { type: 'azure-active-directory-default', options: {} },
    options: { encrypt: true },
  });
  connection.close();
});

test('missing connection string is reported', () => {
  assert.throws(() => buildSqlConfig(undefined), /SQL_CONNECTION_STRING/);
});
