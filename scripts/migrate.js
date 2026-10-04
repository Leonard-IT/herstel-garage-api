'use strict';

// Applies db/migrations/*.sql in order and records them in dbo.SchemaMigrations.
// Usage: SQL_CONNECTION_STRING="..." node scripts/migrate.js   (reads local.settings.json if unset)
// Pass --create-database to create the database first if it does not exist (local container only;
// on Azure the database is created in the portal and the pipeline identity has no rights on master).

const fs = require('node:fs');
const path = require('node:path');
const sql = require('mssql');

function connectionString() {
  if (process.env.SQL_CONNECTION_STRING) return process.env.SQL_CONNECTION_STRING;
  const settings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'local.settings.json'), 'utf8'));
  return settings.Values.SQL_CONNECTION_STRING;
}

async function main() {
  const config = sql.ConnectionPool.parseConnectionString(connectionString());
  const database = config.database;

  if (process.argv.includes('--create-database')) {
    const master = await new sql.ConnectionPool({ ...config, database: 'master' }).connect();
    await master.request().query(`IF DB_ID(N'${database.replace(/'/g, "''")}') IS NULL CREATE DATABASE [${database.replace(/]/g, ']]')}]`);
    await master.close();
  }

  const pool = await new sql.ConnectionPool(config).connect();
  await pool.request().query(`
    IF OBJECT_ID('dbo.SchemaMigrations') IS NULL
      CREATE TABLE dbo.SchemaMigrations (Name VARCHAR(200) NOT NULL PRIMARY KEY, AppliedAt DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME())`);
  const applied = new Set((await pool.request().query('SELECT Name FROM dbo.SchemaMigrations')).recordset.map((r) => r.Name));

  const dir = path.join(__dirname, '..', 'db', 'migrations');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue;
    console.log(`Applying ${file}`);
    const batches = fs.readFileSync(path.join(dir, file), 'utf8').split(/^\s*GO\s*$/im).filter((b) => b.trim());
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      for (const batch of batches) await new sql.Request(tx).batch(batch);
      await new sql.Request(tx).input('name', sql.VarChar, file).query('INSERT INTO dbo.SchemaMigrations (Name) VALUES (@name)');
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  }
  await pool.close();
  console.log('Database is up to date');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
