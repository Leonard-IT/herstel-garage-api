'use strict';

// The public page behind a share link, as plain server-rendered HTML. It has to be HTML that is complete when it is fetched, because
// chat apps (WhatsApp and others) read the Open Graph tags (og:title, og:description, og:image) from it to build the link preview and
// do not run JavaScript, which a single-page app would need.
//
// Everything that comes from the database (and so from customers) goes through escapeHtml.

const DAMAGE_TYPE_LABELS = {
  lakschade: 'Lakschade',
  carrosserie: 'Carrosserieschade',
  bumper: 'Bumper- en kunststofschade',
  ruitschade: 'Ruitschade',
  ev: 'Elektrisch / hybride (EV)',
  overig: 'Overige schade',
};

const LOCATION_LABELS = {
  front: 'Voorkant',
  rear: 'Achterkant',
  left: 'Linkerzijde',
  right: 'Rechterzijde',
  roof: 'Dak',
  windscreen: 'Ruiten',
  wheels: 'Wielen',
  interior: 'Interieur',
  other: 'Overig',
};

// What a chat app and a browser can show. Photos in other formats (HEIC from an iPhone) are left out of the page and the preview.
const DISPLAYABLE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);

/** "5 min geleden", "3 uur geleden", "2 dagen geleden". */
function timeAgo(date, now = new Date()) {
  const minutes = Math.max(1, Math.round((now.getTime() - new Date(date).getTime()) / 60000));
  if (minutes < 60) return `${minutes} min geleden`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} uur geleden`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 dag geleden' : `${days} dagen geleden`;
}

/** The photos that can be shown, each with its number in the full list (the number the photo URL uses, 1-based). */
function displayablePhotos(images) {
  return images
    .map((image, index) => ({ ...image, number: index + 1 }))
    .filter((image) => DISPLAYABLE_IMAGE_TYPES.includes(image.contentType));
}

/** The short text under the title in the preview: the kind of damage, where, how many photos. No free text from the customer. */
function describeRequest(view) {
  const parts = [DAMAGE_TYPE_LABELS[view.damageType] ?? 'Reparatieaanvraag'];
  if (view.location) parts.push(LOCATION_LABELS[view.location] ?? view.location);
  if (view.postalArea) parts.push(`postcode ${view.postalArea}`);
  const photos = displayablePhotos(view.images).length;
  if (photos > 0) parts.push(photos === 1 ? '1 foto' : `${photos} foto's`);
  return `${parts.join(' · ')}. Bekijk de aanvraag en doe een aanbod.`;
}

const carTitle = (view) => `${view.car.make} ${view.car.model}${view.car.buildYear ? ` (${view.car.buildYear})` : ''}`;

const STYLE = `
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#F9F8F7;color:#2C2C2B;line-height:1.5}
  header{background:#fff;border-bottom:1px solid #E6E5E3;padding:14px 20px;font-weight:700;font-size:17px;color:#1C1B1A}
  header span{color:#2783DE}
  main{max-width:720px;margin:0 auto;padding:24px 16px 48px}
  .eyebrow{color:#B0632A;font-weight:700;text-transform:uppercase;letter-spacing:.03em;font-size:12px}
  h1{font-size:24px;margin:6px 0 4px;color:#1C1B1A}
  .sub{color:#7D7A75;font-size:14px;margin:0 0 18px}
  .photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;margin:0 0 18px}
  .photos a{display:block;aspect-ratio:4/3;border-radius:10px;overflow:hidden;border:1px solid #E6E5E3;background:#F0EFED}
  .photos img{width:100%;height:100%;object-fit:cover;display:block}
  dl{margin:0 0 22px;background:#fff;border:1px solid #E6E5E3;border-radius:12px}
  dl div{display:flex;justify-content:space-between;gap:16px;padding:12px 16px;border-top:1px solid #F0EFED;font-size:14.5px}
  dl div:first-child{border-top:0}
  dt{color:#7D7A75}
  dd{margin:0;font-weight:600;text-align:right}
  .cta{display:block;text-align:center;background:#2783DE;color:#fff;text-decoration:none;font-weight:700;padding:14px 20px;border-radius:10px;font-size:16px}
  .note{color:#7D7A75;font-size:13px;margin:12px 0 0;text-align:center}
`;

function shell({ title, description, image, url, body }) {
  const og = [
    ['og:type', 'website'],
    ['og:site_name', 'SnelHersteld.nl'],
    ['og:locale', 'nl_NL'],
    ['og:title', title],
    ['og:description', description],
    ...(url ? [['og:url', url]] : []),
    ...(image ? [['og:image', image], ['og:image:alt', `Foto van de schade: ${title}`]] : []),
    ['twitter:card', image ? 'summary_large_image' : 'summary'],
    ['twitter:title', title],
    ['twitter:description', description],
    ...(image ? [['twitter:image', image]] : []),
  ];
  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)} — SnelHersteld.nl</title>
<meta name="description" content="${escapeHtml(description)}">
${og.map(([name, content]) => `<meta property="${name}" content="${escapeHtml(content)}">`).join('\n')}
<style>${STYLE}</style>
</head>
<body>
<header>SnelHersteld<span>.nl</span></header>
<main>
${body}
</main>
</body>
</html>`;
}

/**
 * The page for a working link: the details of the request, the photos, and a button to the dashboard to make an offer.
 * `urls` holds the absolute address of this page and of the photos, and the dashboard address.
 */
function renderSharePage(view, { token, baseUrl, dashboardUrl, now = new Date() }) {
  const title = `Nieuwe reparatieaanvraag: ${carTitle(view)}`;
  const photos = displayablePhotos(view.images);
  const photoUrl = (number) => `${baseUrl}/s/${token}/photo/${number}`;
  const rows = [
    ['Auto', carTitle(view)],
    ['Soort schade', DAMAGE_TYPE_LABELS[view.damageType] ?? 'Onbekend'],
    view.location ? ['Locatie schade', LOCATION_LABELS[view.location] ?? view.location] : null,
    view.postalArea ? ['Postcodegebied', view.postalArea] : null,
    ['Ingediend', timeAgo(view.createdAt, now)],
  ].filter(Boolean);

  const body = `<div class="eyebrow">Reparatieaanvraag</div>
<h1>${escapeHtml(carTitle(view))}</h1>
<p class="sub">${escapeHtml(describeRequest(view))}</p>
${
  photos.length
    ? `<div class="photos">${photos
        .map(
          (photo) =>
            `<a href="${escapeHtml(photoUrl(photo.number))}" target="_blank" rel="noopener"><img src="${escapeHtml(photoUrl(photo.number))}" alt="Foto ${photo.number} van de schade aan ${escapeHtml(carTitle(view))}" loading="lazy"></a>`,
        )
        .join('')}</div>`
    : ''
}
<dl>${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>
<a class="cta" href="${escapeHtml(`${dashboardUrl}/aanvragen/${view.requestId}`)}">Bekijk de aanvraag en doe een aanbod</a>
<p class="note">Voor een aanbod log je in met het account van je garage.</p>`;

  return shell({
    title,
    description: describeRequest(view),
    image: photos.length ? photoUrl(photos[0].number) : null,
    url: `${baseUrl}/s/${token}`,
    body,
  });
}

/** The page for a link that does not work (unknown, expired, revoked, or the request is taken). Says nothing about which. */
function renderGonePage({ dashboardUrl }) {
  return shell({
    title: 'Deze link is niet meer geldig',
    description: 'Deze reparatieaanvraag is niet meer beschikbaar via deze link.',
    image: null,
    url: null,
    body: `<h1>Deze link is niet meer geldig</h1>
<p class="sub">De aanvraag is niet meer beschikbaar, of de link is verlopen. Bekijk de actuele aanvragen in het garagedashboard.</p>
<a class="cta" href="${escapeHtml(dashboardUrl)}">Naar het garagedashboard</a>`,
  });
}

module.exports = {
  renderSharePage,
  renderGonePage,
  describeRequest,
  displayablePhotos,
  escapeHtml,
  timeAgo,
  DISPLAYABLE_IMAGE_TYPES,
};
