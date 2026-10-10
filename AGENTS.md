# AGENTS.md

Instructions for coding agents working on herstel-garage-api, the backend of SnelHersteld.nl. Read this before you change anything.

## The platform

Three repositories, checked out side by side in one parent folder. Some tooling depends on that layout.

| Repo | What it is | Stack |
| --- | --- | --- |
| `herstel-garage-api` (this one) | The API: repair requests, offers, share links, the customer page's data | Azure Functions v4 (Node, CommonJS), Azure SQL, Blob Storage |
| `herstel-garage-web` | The garage dashboard, plus the **mock API** in `mock/` | Vite, React, TypeScript, TanStack Query, Vitest |
| `herstel-web` | The public site: request form (`nieuwe-aanvraag.html`), customer page (`mijn-aanvraag.html`), garage sign-up | Plain HTML, CSS and inline JavaScript, no build step, no package.json |

Production: API at `https://api.snelhersteld.nl/api` (Function App `fn-garage-api-prod`), dashboard at `https://garage.snelhersteld.nl`,
site at `https://snelhersteld.nl`.

## Rule 1: keep the mock API in step with this API

`herstel-garage-web/mock/` is a fake of this API. Developers build the dashboard and the customer page against it, so a mock that has
drifted gives them screens that break in production.

**Every change here that a client can notice must also be made in the mock, in the same piece of work.** That includes:

- a new, removed or renamed endpoint or route;
- a changed response shape (fields added, removed, renamed, or a changed meaning);
- a changed rule: validation, status codes, error codes, what someone may see, how a status is worked out;
- new states that need sample data to be visible.

What to change:

1. `mock/api.mjs`: the endpoint and its rules.
2. `mock/data.mjs`: sample data, so the new behaviour can be seen when the mock starts.
3. `mock/api.test.mjs`: a test that pins the rule. This test is how the mock keeps following the API.
4. `herstel-garage-web/src/test/server.ts`: the MSW handlers of the dashboard's own tests, if the dashboard calls the endpoint.
5. The "The mock API" section of herstel-garage-web's README, if what the mock covers has changed.

Do not copy logic or text that the API can share. The customer page's view and texts come from `src/lib/customerView.js` and
`src/lib/customerNextSteps.js`, which the mock loads directly from this repo. Extend that pattern when it fits: pure modules in `src/lib`,
loaded by the mock, instead of a second copy.

Check the mock with `npx vitest run mock` in herstel-garage-web. If you are told not to touch the mock, say clearly in your answer that it
now differs from the API, and how.

## Commands

| Where | Command | What it does |
| --- | --- | --- |
| herstel-garage-api | `npm test` | All tests (`node --test`, no extra libraries) |
| herstel-garage-api | `func start` | Local Functions host on port 7071 (needs SQL, Azurite and `local.settings.json`; see the README) |
| herstel-garage-api | `npm run migrate` | Applies `db/migrations` (CI does this on every push to main) |
| herstel-garage-web | `npm test`, `npm run lint`, `npm run build` | Run all three before saying the dashboard work is done |
| herstel-garage-web | `npm run dev:mock` | Mock API on port 7072 plus the dashboard, signed in as a dev user. Also serves herstel-web under `/site/` and prints a link per customer scenario |

## How the code is organised

- `src/functions/*.js`: one HTTP endpoint per file (`app.http`), kept thin. It checks access, validates, calls `src/lib`, and maps the
  result to a status. Unexpected errors are logged with `context.error` and answered with a general 500, never with the error text.
- `src/lib/*.js`: the logic. Database access lives in `*Repository.js`; pure rules (validation, views, next steps, tokens) live in
  their own modules, so they can be tested without a database.
- `test/*.test.js`: `node:test` and `node:assert`. Handlers are tested by putting stub modules into `require.cache` before the function
  file is loaded (see `test/shareHandlers.test.js` and `test/customerHandlers.test.js`). Add tests for every new rule.
- Match the style of the surrounding code: `'use strict'`, CommonJS, English comments that explain *why*, short functions.
- Text that customers or garages see is Dutch. Code, comments, API messages and docs are English.

## Rules that are easy to break

- **Never start a route with `admin`.** Azure reserves it: production answered `/api/admin/...` with an empty 404 before the function ran.
  Administrator endpoints live under `backoffice/...`, and a test guards this.
- **Access.** Garage endpoints use `requireGarage` (`src/lib/garageAuth.js`). Administrator endpoints use `requireAdmin`
  (`src/lib/adminAuth.js`, with the `ADMIN_USER_IDS` setting). Public token endpoints (`s/{token}`, `customer/...`) check the token's
  format with `isValidToken` before they ask the database, and answer with `Cache-Control: no-store` and `noindex`.
- **Privacy.** Before a customer accepts its offer, a garage sees no personal data: no name, no contact details, no license plate, and only
  the 4-digit postal area. The public share page shows even less. A garage's phone and email reach the customer only after acceptance.
- **"In option" is never stored.** A request is `in_option` while it is `open` and has an active offer whose `ExpiresAt` has not passed.
  This is worked out on every read. Anything that reads offers must check `ExpiresAt` as well as `Status`.
- **One running offer per request.** Locking is done in the repositories (`UPDLOCK, HOLDLOCK` on the request row). Keep it when you
  change those queries.

## Database migrations

- Add a new numbered file in `db/migrations/` (`009_...sql`). Never edit a migration that has been applied; the pipeline records each
  file in `dbo.SchemaMigrations` and does not run it again.
- Put each `ALTER` in its own batch with `GO`: SQL Server compiles a whole batch first, so a column added in the same batch cannot be used.
- New columns on existing tables must be `NULL`, or have a default or a backfill, because the tables already have data.
- The SQL can usually not be run locally (the SQL Server Docker image does not download on the developer's machine). Say plainly when
  SQL has only been reviewed and not run, and add "try it against the real database" to `TODO.md`.

## When something changes, update these too

- **Docs in this repo:** `README.md` (endpoints, settings), `TODO.md` (follow-ups; tick off what you finished), `SUGGESTIONS.md` (ideas
  for later), `CUSTOMER_SCENARIOS.md` (what the customer is told, and why).
- **A new app setting:** add it to the README's settings table. If the API cannot run locally without it, add it to
  `local.settings.example.json` too, with an empty or safe value. Optional settings with a default stay out of that file.
- **The API's address:** it is in `herstel-garage-web/.env.production` (`VITE_API_BASE_URL`), in the CSP `connect-src` in
  `herstel-garage-web/public/staticwebapp.config.json`, and as `PROD_API_BASE_URL` in herstel-web's `nieuwe-aanvraag.html`,
  `aanmelden-garage.html` and `mijn-aanvraag.html`.
- **A new public endpoint called from the site or the dashboard:** the Function App's CORS list must allow `https://snelhersteld.nl`,
  `https://www.snelhersteld.nl` and `https://garage.snelhersteld.nl`. That is set in Azure; tell the user, you cannot change it from here.

## Working with the user

- Do not commit or push unless asked. A push to main deploys the API and runs the migrations.
- Changes in Azure or Entra (app settings, CORS, authentication, DNS) are the user's. Give the exact steps.
- Be precise about what you verified: tests run, a page looked at, SQL only reviewed, WhatsApp previews untested.
- Some files have Windows line endings (CRLF). Keep them as they are.
- Do not stop or inspect processes you did not start, for example something already running on port 7071 or 7072. Use another port.
