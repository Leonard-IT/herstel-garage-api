'use strict';

// What the customer is told on their own page: where their request stands, what happens next, and above all what is expected of
// them. The text depends on the stage of the request and on what the customer told us: can the car still drive, where is it, and
// the preferences they ticked (pickup, rental car, insurance). Plain data in, plain data out, so it can be tested and later reused
// for emails. Text is Dutch: it is shown to customers as is.
//
// Every step says who acts: 'you' (the customer), 'garage' or 'us' (SnelHersteld). Warnings are things that matter before anything
// else (safety, costs that run per day).

const TIME_ZONE = 'Europe/Amsterdam';

const formatDateTime = (iso) =>
  new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE })
    .format(new Date(iso));

// availableFrom is a date without a time ('2026-10-12'); noon UTC keeps it on the same day in Amsterdam.
const formatDate = (date) =>
  new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TIME_ZONE }).format(new Date(`${date}T12:00:00Z`));

/**
 * The stage as the customer sees it. The stored status is 'open' until an offer is accepted; an open request with an offer that is
 * running (active, deadline not passed) is waiting for the customer.
 */
function customerStage(status, offers, now = new Date()) {
  if (status !== 'open') return status; // accepted, in_progress, completed, cancelled
  const running = offers.some((offer) => offer.status === 'active' && new Date(offer.expiresAt) > now);
  return running ? 'offer_received' : 'waiting_for_offer';
}

function warnings({ carDrivable, carLocation, damageType }) {
  const list = [];
  if (carDrivable === 'no') {
    list.push({
      id: 'do-not-drive',
      title: 'Rij niet met de auto',
      text: 'Je gaf aan dat de auto niet meer veilig kan rijden. Laat hem staan. Hoe de auto bij de garage komt, spreek je af met de garage.',
    });
  } else if (carDrivable === 'unknown' || carDrivable == null) {
    list.push({
      id: 'check-drivable',
      title: 'Twijfel je of de auto nog veilig kan rijden?',
      text:
        'Rij er dan niet mee als de verlichting of een spiegel kapot is, een ruit in je zichtveld gebarsten is, een wiel of de ophanging '
        + 'geraakt is, er iets lekt of er waarschuwingslampjes branden. Bespreek het met de garage.',
    });
  }
  if (damageType === 'ev') {
    list.push({
      id: 'ev-safety',
      title: 'Elektrische of hybride auto',
      text: 'Is de onderkant geraakt of was het een harde klap? Laad de auto dan niet op en rij er niet mee tot een garage ernaar gekeken heeft.',
    });
  }
  if (carLocation === 'towing') {
    list.push({
      id: 'storage-costs',
      title: 'Je auto staat bij een bergingsbedrijf',
      text:
        'Daar betaal je vaak stallingskosten per dag. Hoe eerder de auto naar de garage gaat, hoe beter. '
        + 'Vraag je verzekeraar of zij de berging en het transport vergoeden.',
    });
  }
  return list;
}

/** How the car gets to the garage. Depends on whether it can drive, where it is and whether the customer asked for pickup. */
function transportStep({ carDrivable, carLocation, preferences, garage }) {
  const where = garage?.address ? ` (${garage.address})` : '';
  if (carDrivable === 'no' || carLocation === 'towing') {
    return {
      id: 'transport',
      who: 'garage',
      title: 'Transport naar de garage',
      text:
        'De auto moet naar de garage worden gebracht. De garage bespreekt met je hoe: zelf ophalen of via een bergingsbedrijf. '
        + 'Heb je pechhulp of een allriskverzekering? Dan regelt je verzekeraar het transport vaak; vraag het na.',
    };
  }
  if (preferences.includes('pickup-and-delivery')) {
    return {
      id: 'transport',
      who: 'you',
      title: 'Ophalen en terugbrengen afspreken',
      text: `Je wilt de auto laten ophalen. Spreek met de garage af of dat kan en wat het kost. Kan het niet, dan breng je de auto zelf${where}.`,
    };
  }
  if (carDrivable === 'yes') {
    return {
      id: 'transport',
      who: 'you',
      title: 'De auto naar de garage brengen',
      text: `Je brengt de auto op de afgesproken dag zelf naar de garage${where}.`,
    };
  }
  return {
    id: 'transport',
    who: 'you',
    title: 'De auto naar de garage brengen',
    text: `Kan de auto veilig rijden, dan breng je hem op de afgesproken dag zelf naar de garage${where}. Zo niet, dan bespreek je met de garage hoe hij er komt.`,
  };
}

/** The steps after an offer is (or would be) accepted, in order. */
function afterAcceptSteps(input) {
  const { preferences, garage, availableFrom, accepted } = input;
  const name = garage?.companyName ?? 'De garage';
  const from = availableFrom ? ` De garage kan vanaf ${formatDate(availableFrom)}.` : '';
  const steps = [];

  steps.push(accepted
    ? {
        id: 'contact',
        who: 'garage',
        title: `${name} neemt contact met je op`,
        text: `De garage heeft je naam en telefoonnummer en belt je om een afspraak te maken.${from}${garage?.phone ? ` Je kunt ook zelf bellen: ${garage.phone}.` : ''}`,
      }
    : {
        id: 'contact',
        who: 'garage',
        title: `${name} neemt contact met je op`,
        text: `Pas als je accepteert, krijgt de garage je naam en telefoonnummer. De garage belt je dan om een afspraak te maken.${from}`,
      });

  steps.push(transportStep(input));

  if (preferences.includes('insurance-handling')) {
    steps.push({
      id: 'insurance',
      who: 'you',
      title: 'Je verzekeraar inlichten',
      text:
        'Meld de schade bij je verzekeraar als je dat nog niet deed, en geef het schadenummer door aan de garage. '
        + 'Vraag of je zelf een garage mag kiezen: bij sommige polissen krijg je anders minder vergoed.',
    });
  }
  if (preferences.includes('rental-car')) {
    steps.push({
      id: 'rental-car',
      who: 'you',
      title: 'Vervangend vervoer',
      text: 'Je gaf aan dat je vervangend vervoer nodig hebt. Vraag bij het maken van de afspraak of de garage een leenauto heeft. Soms vergoedt je verzekering een huurauto.',
    });
  }
  steps.push({
    id: 'prepare',
    who: 'you',
    title: 'Klaarzetten voor de afspraak',
    text: 'Neem beide sleutels en je kentekencard mee en haal waardevolle spullen uit de auto. Heb je met iemand een schadeformulier ingevuld? Neem een kopie mee.',
  });
  steps.push({
    id: 'price',
    who: 'garage',
    title: 'Geen verrassingen over de kosten',
    text: 'De garage bekijkt de auto en bevestigt de prijs voordat de reparatie begint. Zonder jouw akkoord wordt er niets gerepareerd.',
  });
  return steps;
}

/**
 * Everything the page needs to explain where the customer stands.
 * input: { stage, carDrivable, carLocation, damageType, preferences: [slug], garage: { companyName, address, phone } | null,
 *          availableFrom, expiresAt }  (garage/availableFrom/expiresAt: the running or accepted offer, when there is one)
 * Returns { stage, title, summary, warnings: [{ id, title, text }], steps: [{ id, who, title, text }], ifNoAnswer }.
 */
function buildNextSteps(input) {
  const ctx = { preferences: [], ...input };
  const name = ctx.garage?.companyName ?? 'de garage';
  const list = warnings(ctx);

  switch (ctx.stage) {
    case 'waiting_for_offer':
      return {
        stage: ctx.stage,
        title: 'We zoeken een garage voor je',
        summary: 'Garages bij jou in de buurt bekijken je aanvraag en de foto\'s. Je hoeft nu niets te doen.',
        warnings: list,
        steps: [
          { id: 'matching', who: 'us', title: 'Garages bekijken je aanvraag', text: 'Een garage die de reparatie kan doen, stuurt een voorstel met de datum waarop hij kan beginnen.' },
          { id: 'keep-link', who: 'you', title: 'Bewaar deze pagina', text: 'Zodra er een voorstel is, staat het hier en nemen we contact met je op. Je kunt het voorstel dan bekijken en accepteren.' },
        ],
        ifNoAnswer: null,
      };
    case 'offer_received':
      return {
        stage: ctx.stage,
        title: `Je hebt een voorstel van ${name}`,
        summary: `Bekijk het voorstel en laat vóór ${formatDateTime(ctx.expiresAt)} weten of je het accepteert. Dit gebeurt er als je accepteert:`,
        warnings: list,
        steps: afterAcceptSteps({ ...ctx, accepted: false }),
        ifNoAnswer:
          `Reageer je niet vóór ${formatDateTime(ctx.expiresAt)}, dan vervalt het voorstel en kunnen andere garages een voorstel doen. `
          + 'Wijs je het af, dan gebeurt dat meteen.',
      };
    case 'accepted':
      return {
        stage: ctx.stage,
        title: `Je hebt het voorstel van ${name} geaccepteerd`,
        summary: 'Dit zijn de volgende stappen, en wat we van je verwachten.',
        warnings: list,
        steps: afterAcceptSteps({ ...ctx, accepted: true }),
        ifNoAnswer: null,
      };
    case 'in_progress':
      return {
        stage: ctx.stage,
        title: 'Je auto wordt gerepareerd',
        summary: `${capitalize(name)} laat het je weten als de auto klaar is.`,
        warnings: [],
        steps: [
          { id: 'questions', who: 'garage', title: 'Vragen over de reparatie?', text: ctx.garage?.phone ? `Bel de garage: ${ctx.garage.phone}.` : 'Neem contact op met de garage.' },
        ],
        ifNoAnswer: null,
      };
    case 'completed':
      return {
        stage: ctx.stage,
        title: 'De reparatie is klaar',
        summary: 'Fijn dat je SnelHersteld gebruikt hebt.',
        warnings: [],
        steps: [
          { id: 'inspect', who: 'you', title: 'Bekijk de reparatie bij het ophalen', text: 'Kijk bij daglicht of de kleur en de naden goed zijn. Zie je iets dat niet klopt, meld het dan meteen bij de garage.' },
          { id: 'invoice', who: 'you', title: 'Bewaar de factuur', text: 'Die heb je nodig voor de garantie en eventueel voor je verzekeraar.' },
        ],
        ifNoAnswer: null,
      };
    default:
      return {
        stage: ctx.stage,
        title: 'Deze aanvraag is gesloten',
        summary: 'Klopt dat niet? Neem dan contact met ons op.',
        warnings: [],
        steps: [],
        ifNoAnswer: null,
      };
  }
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

module.exports = { customerStage, buildNextSteps, formatDate, formatDateTime };
