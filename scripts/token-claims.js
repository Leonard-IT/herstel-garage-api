'use strict';

// Temporary diagnostic: reads an access token on stdin and prints a masked summary of its identity claims.
// Secrets are masked in GitHub logs, so only the first 8 and last 4 characters of each id are shown.

const mask = (v) => String(v || '').replace(/^(.{8}).*(.{4})$/, '$1...$2');
const token = require('node:fs').readFileSync(0, 'utf8').trim();
const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
console.log(`token appid: ${mask(claims.appid || claims.azp)} | oid: ${mask(claims.oid)} | tid: ${mask(claims.tid)} | idtyp: ${claims.idtyp}`);
