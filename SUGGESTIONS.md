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
