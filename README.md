# Meridian & Co. — e-commerce platform

A working slice of the platform: product catalogue with search, filtering and
variant handling; secure authentication and profiles; a cart that persists
between sessions; bank-transfer checkout; and order dashboards for both shoppers
and admins.

React + TypeScript on the front, Node + Express + Postgres behind it.

---

## Quick start

Requires **Node 20+** and a **PostgreSQL 14+** you can create two databases on.

```bash
# 1. API
cd server
npm install
cp .env.example .env          # then edit DATABASE_URL and the two JWT secrets
npx prisma migrate deploy     # create the schema
npm run seed                  # 12 products, 35 variants, 2 demo logins
npm run dev                   # http://localhost:4000

# 2. Web app, in a second terminal
cd web
npm install
npm run dev                   # http://localhost:5173
```

Open <http://localhost:5173>. The Vite dev server proxies `/api` to the API, so
both run on one origin and the auth cookies behave exactly as they will in
production.

Generate the secrets with:

```bash
openssl rand -base64 48
```

They must be **two different values** — the API refuses to start if they match,
because reusing one secret means a refresh token verifies as an access token
and effectively never expires.

### Demo logins

| Role     | Email                 | Password           |
| -------- | --------------------- | ------------------ |
| Shopper  | `shopper@example.com` | `Shopper!Passw0rd` |
| Admin    | `admin@example.com`   | `Admin!Passw0rd`   |

---

## Commands

### `server/`

| Command                 | What it does                                          |
| ----------------------- | ----------------------------------------------------- |
| `npm run dev`           | API with hot reload (tsx watch)                       |
| `npm run build`         | Compile TypeScript to `dist/`                         |
| `npm start`             | Run the compiled build                                |
| `npm test`              | 86 integration tests against a real Postgres          |
| `npm run typecheck`     | `tsc --noEmit`                                        |
| `npm run lint`          | ESLint, type-aware                                    |
| `npm run format`        | Prettier                                              |
| `npm run prisma:deploy` | Apply migrations (use this in CI/production)          |
| `npm run prisma:migrate`| Create a new migration from a schema change (dev only)|
| `npm run seed`          | Idempotent seed — safe to re-run                      |

### `web/`

| Command             | What it does                        |
| ------------------- | ----------------------------------- |
| `npm run dev`       | Vite dev server with the API proxy  |
| `npm run build`     | Typecheck then production bundle    |
| `npm run preview`   | Serve the built bundle locally      |
| `npm test`          | 13 unit tests (variant logic)       |
| `npm run typecheck` | `tsc -b --noEmit`                   |
| `npm run lint`      | oxlint                              |

---

## Environment variables

All of `server/.env`. Copy `server/.env.example` and fill it in; the process
validates every value at boot and **exits with a readable message** rather than
starting up half-configured.

| Variable                 | Required | Default                 | Notes |
| ------------------------ | -------- | ----------------------- | ----- |
| `DATABASE_URL`           | yes      | —                       | Postgres connection string |
| `TEST_DATABASE_URL`      | for tests| —                       | **Must differ from `DATABASE_URL`** — the suite truncates every table |
| `PORT`                   | no       | `4000`                  | |
| `CORS_ORIGINS`           | no       | `http://localhost:5173` | Comma-separated allow-list. No wildcard fallback |
| `JWT_ACCESS_SECRET`      | yes      | —                       | ≥32 chars |
| `JWT_REFRESH_SECRET`     | yes      | —                       | ≥32 chars, **different** from the above |
| `ACCESS_TOKEN_TTL`       | no       | `15m`                   | |
| `REFRESH_TOKEN_TTL_DAYS` | no       | `30`                    | |
| `COOKIE_SECURE`          | no       | `false`                 | Set `true` when serving over HTTPS |
| `COOKIE_SAMESITE`        | no       | `lax`                   | `none` requires `COOKIE_SECURE=true` |
| `BANK_*`                 | no       | placeholders            | Account name/number/sort code/IBAN/SWIFT shown at checkout |

---

## Architecture

```
server/
  prisma/schema.prisma        data model + migrations
  prisma/seed.ts              idempotent demo catalogue
  src/env.ts                  config validated at boot; no silent fallbacks
  src/app.ts                  middleware, CORS, rate limits, health checks
  src/auth/                   tokens, cookies, auth + role middleware
  src/http/                   error shape, async wrapper, typed cookie reader
  src/modules/
    auth/                     register, login, refresh, logout, profile
    catalog/                  products, search, filters, facets, categories
    cart/                     cart service (incl. guest→user merge) + routes
    orders/                   checkout, order state machine, customer views
    admin/                    dashboard stats, order management, stock/price
  tests/                      integration tests over real HTTP + real Postgres

web/
  src/lib/api.ts              single fetch layer; cookie auth + refresh retry
  src/lib/variants.ts         variant resolution logic (unit tested)
  src/lib/money.ts            cents → display string, in one place
  src/hooks/                  auth context/provider, cart queries + mutations
  src/components/             Layout, CartDrawer, ProductCard, VariantPicker, ui
  src/pages/                  catalogue, product, auth, checkout, order, admin
```

### API surface

Public:

```
GET    /health                        process liveness
GET    /ready                         readiness — actually queries the database
GET    /api/catalog/products          search, filter, sort, paginate
GET    /api/catalog/products/:slug    one product with options and variants
GET    /api/catalog/categories        with active-product counts
GET    /api/catalog/facets            brands and real price range
GET    /api/cart                      works signed out (cookie-keyed)
POST   /api/cart/items
PATCH  /api/cart/items/:variantId
DELETE /api/cart/items/:variantId
DELETE /api/cart
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/refresh
POST   /api/auth/logout
```

Requires a session:

```
GET    /api/auth/me
PATCH  /api/auth/me
POST   /api/auth/change-password
POST   /api/orders/checkout
GET    /api/orders
GET    /api/orders/:orderNumber
POST   /api/orders/:orderNumber/cancel
```

Requires `ADMIN`:

```
GET    /api/admin/stats
GET    /api/admin/orders                      filter by status, search
POST   /api/admin/orders/:orderNumber/status
POST   /api/admin/orders/:orderNumber/mark-paid
GET    /api/admin/products
PATCH  /api/admin/products/:id
PATCH  /api/admin/variants/:id/stock
PATCH  /api/admin/variants/:id/price
```

Every error uses one shape, so the client can branch on a code instead of
matching English prose:

```json
{ "error": { "code": "UNPROCESSABLE", "message": "Only 2 of MER-TEE-L-BONE left.", "details": { "available": 2 } } }
```

---

## Decisions worth knowing about

These are the things that would otherwise look arbitrary, or get "simplified"
into a bug.

**Money is integer cents, everywhere.** No floats touch a price. Line and order
totals are computed by the server and re-derived on every read rather than
stored, so a number on the cart page can never disagree with the invoice.

**Sessions are httpOnly cookies, not localStorage.** The access token
(15 minutes) and refresh token (30 days) are both `httpOnly`, so no script on
the page can read them and an XSS bug cannot walk off with a session. Refresh
tokens are stored **hashed** and **rotate on every use**, so a stolen one works
at most once. Alongside them sits a deliberately readable `shop_session=1` flag
that carries no identity — it only lets the SPA know whether it is worth asking
who is signed in, instead of firing a guaranteed 401 on every anonymous page
load. Forging it grants nothing.

**Admin authorisation re-reads the role from the database.** The role in the
token is a snapshot up to 15 minutes old; for anything that can edit the
catalogue or mark money as received, the row is the source of truth. Demoting an
admin takes effect immediately, not when their token expires.

**Stock is claimed with a conditional update.** Checkout decrements inside a
transaction with `WHERE stock >= quantity`, so two shoppers holding the last
unit cannot both pass a check-then-write and oversell it. There is a test that
races four simultaneous checkouts for one unit: exactly one order is created,
the other three get a 409, and stock lands on 0 rather than -3.

**Order lines are snapshots.** Each line keeps its own title, SKU, variant label
and unit price. Editing or deleting a product tomorrow never rewrites what
somebody paid yesterday.

**Order status is a state machine, not a free-text field.** Every legal
transition is listed in `order.status.ts`; anything else is refused with a 409
naming both states. Cancelling or refunding returns stock; the terminal states
are terminal, which is also what stops stock being credited twice. Revenue on
the dashboard counts only orders where money actually arrived.

**The cart lives on the server.** That is what makes it persist across sessions
and devices, and what stops the customer editing it. The guest→user merge on
sign-in **sums** overlapping lines rather than overwriting them, **clamps** to
available stock rather than failing the login, and drops anything that went out
of stock or inactive while the shopper browsed. `cart.service.ts` documents all
six rules; each has a test.

**Catalogue filters narrow variants, not just products.** A card that matched an
"under $30" search will not open onto a $90 default. Price sorting is currently
applied within each page, because the sort key lives on a child row — the API
says so in its response (`sortedWithinPageOnly`) and the UI repeats it. Past a
few thousand products the fix is a denormalised `minPriceCents` column on
`Product`; flagged here rather than left to be discovered as a bug.

**The variant picker repairs instead of dead-ending.** In the seed data the tee
comes in Bone and Ink in every size, but Moss only in M and L. A picker that
merely disables what does not combine makes Moss unreachable from the default
Size=S — the shopper concludes the colour is unavailable and leaves. So clicking
a value keeps it and drags the other axes to the nearest combination that
exists, preferring one in stock. `variants.test.ts` asserts that from every
starting point, every click lands on a real variant.

---

## Testing

```bash
cd server && npm test     # 86 integration tests
cd web    && npm test     # 13 unit tests
```

The server suite runs against a **real Postgres** rather than mocks, because the
things most worth testing here are transactions, unique constraints and
concurrent writes — none of which a mock can tell you about. It needs
`TEST_DATABASE_URL` pointing at a database it may **truncate**, and it refuses
to run if that is unset or equal to `DATABASE_URL`.

What is covered, beyond the happy paths:

- every protected route returns 401 with no credentials, and with a token forged
  using the wrong secret
- a customer gets 403 on admin routes; a demoted admin is refused immediately
- a profile PATCH carrying `role: "ADMIN"` does not escalate
- wrong password and unknown email are indistinguishable in body and status
- refresh rotation, replay of a revoked token, and password change revoking
  every other session
- four concurrent checkouts for one unit of stock
- a failed line rolling the whole order back, leaving the basket intact
- customer B cannot read, cancel or list customer A's order (404, not 403)
- illegal, skipped and repeated status transitions
- stock returned on cancel, and not credited twice

---

## Deployment

```bash
# API
cd server
npm ci
npm run build
npx prisma migrate deploy        # never `migrate dev` in production
node dist/index.js               # behind a process manager

# Web
cd web
npm ci
npm run build                    # static files in dist/
```

Serve `web/dist` from your CDN or reverse proxy, and route `/api` to the Node
process. Points that bite in production:

- Set `COOKIE_SECURE=true` once you are on HTTPS.
- Keep the web app and the API on **one origin** (proxy `/api`) if you can. If
  they must be cross-site, set `COOKIE_SAMESITE=none` — which requires
  `COOKIE_SECURE=true`, or browsers drop the cookie and nobody stays logged in
  — and add the web origin to `CORS_ORIGINS`.
- `app.set('trust proxy', 1)` is already set, so rate limiting and logging see
  the real client IP behind a load balancer. Adjust the hop count if you have
  more than one proxy.
- Point the load balancer's health check at `/ready`, not `/health`. The first
  says the process is alive; only the second proves it can reach the database.

## Not built yet

Named rather than implied, so nothing here comes as a surprise:

- **Card and PayPal payments.** Bank transfer is the only method, as specified.
  It sits behind a payment-method enum and a status machine, so adding a
  provider means a new adapter and no change to order logic.
- **Transactional email.** Order confirmations are shown on screen; no mail is
  sent. There is no email-verification or password-reset flow yet.
- **Tax.** `TAX_RATE_BP` exists and is 0. Real rates need a jurisdiction
  decision before an implementation.
- **Product image upload.** Seed images are inline SVG data URIs. Real
  photography needs an object store and an upload endpoint.
- **Admin product creation.** Admins can edit titles, prices, stock and the
  active flag; creating a product with its option matrix is still a seed-level
  operation.
