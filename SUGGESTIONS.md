# Suggestions

Ideas and recommendations that are not decided yet. Once one is decided, move the work to `TODO.md` and delete the suggestion here.

## Offers: what should an MVP offer contain?

The dashboard has the offer screens (herstel-garage-web, `src/features/offers`), but they only collect two things: the **first date** the
garage can start the repair, and **how long the offer stays valid** (12, 24 or 48 hours). Nothing is sent yet.

### First decide: does the garage enter a price?

Right now an offer has no amount, so it is incomplete as an offer. But `PROJECT.md` (herstel-web) describes the price as a clock that rises
in fixed, published steps (starting at 90% of the independent appraisal and going up to 100%). In that model the garage does not type a
price; the offer means *"I accept the current price, and this is my date"*. The two models need different screens, so choose first:

| Model | Garage enters | The offer overview shows | Notes |
|---|---|---|---|
| **Price clock** (as in PROJECT.md) | nothing about price | the price at the moment of sending, and what it would be at the next step | Needs taxatie (the appraisal) in the data, and the clock logic in the API. The price must be locked when the garage confirms. |
| **Garage quotes a price** | an amount (and maybe a breakdown) | the amount | Simpler to build, but then the platform loses control of the price mechanism described in PROJECT.md. |

### Fields to add, in order of value for the customer

1. **Repair duration**: how many working days the repair takes, so the customer knows when the car is back. The date collected now is
   the *start*, not the finish.
2. **Pickup and delivery**: whether the garage collects and returns the car. It matches an existing customer preference
   (`pickup-and-delivery`).
3. **Rental car**: included, optional or not available. It matches an existing customer preference (`rental-car`).
4. **Warranty**: how long (for example 1 or 2 years). The first mockup of the dashboard already had it.
5. **Parts type**: original, equivalent quality or used. This often decides the price.
6. **Note to the customer**: a short free text for anything that does not fit elsewhere.
7. **Insurance handling**: whether the garage settles with the customer's insurer. It matches an existing customer preference
   (`insurance-handling`).

Tip: show the customer's chosen preferences next to the matching offer fields (rental car, pickup, insurance), so the garage answers
exactly what the customer asked for.

### Leave for later

- Price breakdown (parts and labour)
- Attachments (for example a quote PDF)
- Negotiation and counter offers
- Editing or withdrawing a sent offer (decide the rules first: allowed until the customer views it? never?)

## Links delen: ideas for later

The page where the team makes links, copies them and sees whether they were opened (herstel-garage-web `/delen`, API `/api/admin/share-links`).
Roughly in order of how much they would help.

### Sending and sharing

- **A ready-made message.** A "Kopieer bericht" button with a greeting to the garage by name, two lines about the request and the link, so the
  team pastes one thing into WhatsApp instead of composing it each time. Optionally a "Open in WhatsApp" button (`https://wa.me/<number>?text=...`)
  that opens the chat with the garage's phone number already filled in (needs a phone number per garage in the database).
- **Send from the page.** Email or SMS (Azure Communication Services) directly from the page, with delivery status, instead of copy and paste.
- **A short, own domain** for the links (for example `snelhersteld.nl/s/…`): shorter in the chat, looks more trustworthy, and works with a QR code.
- **A better preview image.** A dedicated 1200×630 image made on the server (one photo, or a collage, with the car and damage on it). It is small,
  always the right shape, and WhatsApp shows it more reliably than a 1600 px photo. Needs server-side image resizing (for example when a photo is
  uploaded, so it is done once).
- **One link for several requests.** A digest page listing several open requests for a garage ("3 nieuwe aanvragen in jouw regio").

### Who to send it to

- **Suggested garages.** Propose garages for the chosen request by specialization (damage type) and distance, and hide or mark garages that already
  got this request. Needs the structured coverage area from the TODO ("Matching garages to requests").
- **Send to all garages within X km** with one click, and "all garages that have not seen this request yet".
- **Filters and groups** in the garage list: by city, specialization, active in the last 30 days, never opened a link.

### Understanding what works

- **Follow the link through to an offer.** Today "opened" is the last thing we know. If the link carries its token through the sign-in, the offer
  can be tied back to the link, which gives the full funnel: shared (preview loaded) → opened → logged in → offer made, with conversion and the
  time between each step. This is the number that says whether sharing works.
- **Stats per garage and per period.** Open rate, time to open and offers per garage (who responds, who never does), and per week or month with a
  small chart. Also the **median** time to open: the average is pulled up by a few links that were opened days later.
- **A list that can be filtered and sorted** (status, garage, request, date range) and exported to CSV.
- **Reminders.** A list of links not opened after 24 hours, with a one-click "send a reminder" (a new message, same link); optionally automatic.
- **Notify the team** (Teams, email) when a link is opened for the first time, or when a request that was shared is taken by another garage.

### Safer and more precise

- **More reliable "opened".** A small script on the page that reports an open only when a real browser ran it. That keeps out mail scanners (Safe
  Links and similar) and prefetching that fetch a link without a person looking at it, and could count unique visitors. The page has no scripts
  now, on purpose, so this is a trade-off.
- **Revoke along with the request.** Revoke or mark the links of a request automatically when it is accepted, cancelled or expires, and let the
  team extend or renew a link that is about to expire.
- **Identify the garage.** The link is tied to a garage for tracking, but anyone who gets it can open it. Asking for login (or a one-time code to
  the garage's own phone number or email) would prove it was really that garage that opened it.
- **Rate limiting and alerts** on the public endpoints (many 404s from one address looks like guessing), and an audit log of who made or revoked which link.
- **Roles.** Separate "can make links" from "can see everything", once the admin site exists with its own sign-in through the company tenant.

