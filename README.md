# Paisley Christmas Markets(POC)

A web app for running a seasonal market:

- Visitors see the dates, the traders and a stall map.
- Traders apply for a stall online.
- Administrators review applications and allocate stalls.


| Part | Technology | Folder |
| --- | --- | --- |
| Frontend | Vue 3 + Vite + Tailwind CSS | `client/` |
| REST API | Node.js, Express 5, TypeScript | `server/`, `api/` |
| Database, login, file storage | Supabase (PostgreSQL, Auth, Storage) | `supabase/` |
| Hosting | Vercel (site + API), Supabase London region | `vercel.json` |

## Where things are

```
api/index.ts            Vercel entry point (hands /api/* to the Express app)
server/src/             The API: app.ts, routes/, middleware/, lib/
server/tests/           API tests (Vitest + Supertest)
server/scripts/         create-admin, seed-demo, smoke
shared/application.ts   The application form's validation, shared by API and frontend
supabase/migrations/    The database, in four files: tables, rules, access control, storage
supabase/seed.sql       Sample markets, stalls and announcements
supabase/tests/         Database tests (pgTAP)
client/src/lib/         Helper the Vue pages call instead of fetch()
client/src/mocks/       Mock JSON in exactly the API's format
```

## Quick start

```bash
npm install
cp .env.example .env        # then fill in the Supabase values
npm run dev                 # API at http://localhost:3000/api
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the API locally with reload |
| `npm test` | API tests (needs a local Supabase stack) |
| `npm run test:db` | Database tests |
| `npm run typecheck` | TypeScript check |
| `npm run create-admin -- <email> <market-slug>` | Make a user an administrator |
| `npm run seed:demo` | Add fictional demo traders in every status |
| `npm run smoke` | End-to-end check against a running site |

## API

Interactive documentation is served by the API itself at `/api/docs` (OpenAPI at `/api/openapi.json`).

Errors always look like this:

```json
{ "error": "validation_failed", "message": "Some fields need attention.", "fields": { "postcode": "Enter a valid UK postcode" } }
```

## Security

Access is enforced in the database with Row Level Security, not just in the API:

- A trader can only read and change their own rows.
- An administrator can only see their own market's data.
- Visitors only get a view of approved traders' listing fields.

The API passes each user's own token through to the database, so these rules apply to every request. The secret key is only used in three places (account deletion, the nightly retention job and short-lived document links) and never reaches the browser.
