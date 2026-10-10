# Customer scenarios

What a customer has to do after a garage makes an offer depends on their situation. This file describes the scenarios, what the
customer page (`mijn-aanvraag.html` in herstel-web) shows or arranges for each, and what we recommend asking.

The rules live in one place: `src/lib/customerNextSteps.js` (tested in `test/customerNextSteps.test.js`). Change the texts there, not
in the page. The texts are Dutch because customers see them as they are.

## What decides the scenario

| Input | Where it comes from | Values |
| --- | --- | --- |
| Stage of the request | Request status and its offers | `waiting_for_offer`, `offer_received`, `accepted`, `in_progress`, `completed`, `cancelled` |
| Can the car still drive safely? | Form question (`carDrivable`) | `yes`, `no`, `unknown` (or empty for older requests) |
| Where is the car now? | Form question (`carLocation`) | `home` (home or work), `towing` (towing company or garage), `other` |
| Kind of damage | Form (`damageType`) | `ev` triggers a battery warning |
| Preferences | Form checkboxes | `pickup-and-delivery`, `rental-car`, `insurance-handling` add their own steps |

The two car questions decide the biggest difference: whether the customer drives the car to the garage, or someone has to fetch it.

## Stages

| Stage | The customer sees | What is expected of the customer |
| --- | --- | --- |
| Waiting for an offer | "We zoeken een garage voor je" | Nothing. Keep the link. |
| Offer received | The offer (garage, address, accreditations, start date, deadline), "Als je accepteert" steps | Accept or decline before the deadline. If they do nothing, the offer lapses and other garages can make an offer. |
| Accepted | The garage's phone, email and website, "Wat er nu gebeurt" steps | Wait for the garage's call (or call themselves), then do their own steps. |
| In progress | "Je auto wordt gerepareerd" | Nothing. Call the garage with questions. |
| Completed | "De reparatie is klaar" | Check the repair in daylight when picking up, keep the invoice. |
| Cancelled | "Deze aanvraag is gesloten" | Contact us if that is wrong. |

Before accepting, the customer is told that the garage only receives their name and phone number once they accept.

## Scenarios

| Situation | Warning | Transport step | Who acts |
| --- | --- | --- | --- |
| Car can drive, at home or work | — | Bring the car to the garage on the agreed day, with the garage address | Customer |
| Car can drive, wants pickup | — | Agree pickup and return with the garage; if not possible, bring it yourself | Customer |
| Car cannot drive | "Rij niet met de auto" | The garage discusses transport (fetch it, or via a towing company); roadside assistance or all-risk insurance often covers it | Garage |
| Not sure whether it can drive (or not asked) | Safety checklist: do not drive with broken lights or mirrors, a cracked windscreen in view, a hit wheel or suspension, a leak, or warning lights | Bring it if safe, otherwise discuss transport with the garage | Customer |
| At a towing company | Storage costs per day, so the sooner the better; ask the insurer whether towing and transport are covered | Same as "cannot drive", even if the car could drive | Garage |
| Electric or hybrid | Do not charge or drive after a hit to the underside or a hard impact, until a garage has looked at it | Follows the other rules | — |

Steps added by preferences, after transport:

| Preference | Step for the customer |
| --- | --- |
| Insurance handling | Report the damage to the insurer, pass the claim number to the garage, and ask whether the policy allows a free choice of garage (some pay less otherwise) |
| Rental car | Ask the garage for a courtesy car when booking; the insurance sometimes pays for a rental |

Every accepted or offered request also gets:

1. The garage contacts you to make an appointment (from the offer's start date).
2. Transport (see above).
3. Insurance and rental car, when chosen.
4. Prepare: both keys, the registration card, valuables out of the car, a copy of any damage form signed with another party.
5. No surprises about the cost: the garage confirms the price before starting, and nothing is repaired without the customer's approval.

Steps are numbered and marked with who acts: **Jij** (the customer, shown in blue), **Garage** or **SnelHersteld**. A customer can see
at a glance which steps are theirs.

## Recommendation

**Ask two questions for the pilot: "Can the car still drive safely?" and "Where is the car now?"** Both are now required in the
request form (optional in the API, so older forms keep working). They decide the biggest difference in what the customer has to do,
they are quick to answer, and a wrong guess is costly: a customer who drives an unsafe car, or a car at a towing company that runs
up storage costs while nobody acts.

**Do not ask more yet.** Insurance type (third-party, all-risk, paying themselves) and whether there is a damage form with another party
would refine the advice, but they make the form longer before we know they matter. Use the "insurance handling" preference for now and
add the questions when pilot customers show they need them.

**Keep the operations manual during the pilot.** The page tells the customer what to expect; the team makes sure it happens:

- Send the customer their link when an offer arrives (there is no email yet; see `POST /api/backoffice/repair-requests/{id}/customer-link`).
- Tell the garage when its offer is accepted, with the customer's name and phone number. The garage dashboard does not show accepted
  requests yet.
- For "cannot drive" and "towing company", check with the garage that transport is arranged. That is where most delays and extra
  costs come from.

**Later, when it pays off:**

- Emails at each stage, with the same texts (that is why they live in the API).
- Insurance type in the form, so the insurance step can say what applies to the customer instead of asking them to check.
- Transport as a garage option on the offer ("pickup included"), shown on the offer card, so customers who cannot drive can choose
  the garage that solves it.
- A price on the offer, once the price model is decided.
- A contact address on the page; the texts already say "neem contact met ons op".

The follow-up work is in `TODO.md`, under "Customer page".
