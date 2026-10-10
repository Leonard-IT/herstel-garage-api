'use strict';

/**
 * The public website that hosts the customer's page (herstel-web). The app setting CUSTOMER_SITE_URL wins, for a test site or a local
 * copy; otherwise the live site.
 */
const customerSiteUrl = (env = process.env) => (env.CUSTOMER_SITE_URL?.trim() || 'https://snelhersteld.nl').replace(/\/+$/, '');

/**
 * The customer's link to their own request. The token goes in the fragment (after #): a browser never sends that part to a server, so
 * it does not end up in the website's access logs or in the Referer header of anything the page loads. The page reads it and asks
 * the API itself.
 */
const customerPageUrl = (token, env = process.env) => `${customerSiteUrl(env)}/mijn-aanvraag.html#${token}`;

module.exports = { customerSiteUrl, customerPageUrl };
