'use strict';

const { randomBytes } = require('node:crypto');

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A new link token: 32 random bytes as base64url, 43 characters. Cannot be guessed. */
const createToken = () => randomBytes(32).toString('base64url');

/** True for something that looks like a token. Checked before the database is asked anything. */
const isValidToken = (value) => typeof value === 'string' && TOKEN_PATTERN.test(value);

/**
 * The part of the URL in front of "/s/<token>". The app setting SHARE_BASE_URL wins (for a short or custom domain later); otherwise
 * the Function App's own address, which Azure provides as WEBSITE_HOSTNAME; locally the Functions host.
 */
function shareBaseUrl(env = process.env) {
  const configured = env.SHARE_BASE_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;
  if (env.WEBSITE_HOSTNAME) return `https://${env.WEBSITE_HOSTNAME}/api`;
  return 'http://localhost:7071/api';
}

const shareUrl = (token, env = process.env) => `${shareBaseUrl(env)}/s/${token}`;

/** The dashboard that the "make an offer" button on the public page leads to. */
const dashboardUrl = (env = process.env) => (env.DASHBOARD_URL?.trim() || 'https://garage.snelhersteld.nl').replace(/\/+$/, '');

/**
 * Where the button on the public page leads: a garage in the network to the request in the dashboard; a prospect to the sign-up form
 * on the website, with the link's token as its invitation. The token goes after the #, so it never reaches the website's server logs.
 */
function clickTarget(view, token, env = process.env) {
  if (view.recipientType === 'prospect') {
    const site = (env.CUSTOMER_SITE_URL?.trim() || 'https://snelhersteld.nl').replace(/\/+$/, '');
    return `${site}/aanmelden-garage.html#uitnodiging=${token}`;
  }
  return `${dashboardUrl(env)}/aanvragen/${view.requestId}`;
}

// Programs that fetch a page to build a preview or to index it, not a person who reads it. Chat apps (WhatsApp, Telegram, Slack,
// Discord, Skype, Facebook, LinkedIn, X), search engines, mail scanners and command line tools. Apple's iMessage previews present
// themselves as "facebookexternalhit"/"Facebot"/"Twitterbot", so they are covered too.
const PREVIEW_BOTS =
  /bot\b|bots\b|crawl|spider|slurp|preview|facebookexternalhit|facebot|whatsapp|telegram|slack|discord|skype|linkedin|pinterest|embedly|quora|vkshare|outbrain|w3c_validator|curl\/|wget\/|python-requests|go-http-client|okhttp|java\/|libwww|headlesschrome|lighthouse|bingpreview|google-read-aloud|yandex|duckduck|applebot/i;

/**
 * Whether this request comes from a link previewer instead of a person. An empty User-Agent counts as a program too: browsers always
 * send one. This is best effort (a program can pretend to be a browser); the previewers that matter here identify themselves.
 */
const isPreviewBot = (userAgent) => !userAgent || PREVIEW_BOTS.test(userAgent);

module.exports = { createToken, isValidToken, shareBaseUrl, shareUrl, dashboardUrl, clickTarget, isPreviewBot };
