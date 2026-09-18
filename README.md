# Kavozi web POC

An anonymous geographic eligibility client for one Kavozi Location backend. Configure your own discovery areas and receive opaque opportunities. There are no accounts, maps, peer coordinates, distances, counts, peer decisions, or Encounter progression.

## Run locally

Use Node.js 22.12+ (validated with Node 22) and npm.

```sh
npm install
npm run generate:api
npm run dev
```

The API defaults to `http://localhost:18080`, matching the supplied OpenAPI server. To change it, create `.env.local` using `.env.example`:

```dotenv
VITE_API_BASE_URL=http://localhost:18080
```

Restart Vite after changing environment variables. The backend must serve the supplied routes and allow CORS from the frontend origins, including `Authorization`, JSON requests, and GET/POST/PUT/DELETE. Use localhost or HTTPS for browser geolocation and Web Locks. Browser settings must allow IndexedDB.

The app talks directly to the real API during normal development. MSW runs only in tests; there is no service worker or fake production API.

## Alice / Bob manual testing

Run these commands in separate terminals:

```sh
# Alice: http://localhost:5173
npm run dev -- --port 5173 --strictPort
```

```sh
# Bob: http://localhost:5174
npm run dev -- --port 5174 --strictPort
```

Ports create different origins, so the two clients have independent IndexedDB stores even in the same browser. Two tabs at the same origin share a Presence; use the two ports or separate browser profiles for independent clients.

1. Open each URL. Each client creates its own anonymous Presence once.
2. Click **Enable location** and grant permission. For deterministic manual GPS, use browser developer tools → Sensors, setting Alice to `48.1486, 17.1077` and Bob to `48.1487, 17.1078`, with acceptable accuracy.
3. Add a radius area (for example, 5 km) and **Save discovery areas** in each client. Alternatively search for a city/district returned by the backend. Empty results stay empty.
4. Wait for backend discovery and the advertised inbox polling interval. Browser test coordinates are inputs, never peer information displayed by the UI.
5. If the backend returns an offer, its labels refer only to this browser's saved areas. **Continue** displays “Interest recorded. Waiting privately for the next step.” **Pass** hides the offer after the server records it.
6. Reload: the Presence, counters, and stable area IDs survive. Enable location again; saved areas are resynchronized as a complete set.
7. **Stop discovery** deletes the Presence and clears its token/counters. Reload stays stopped. **Start discovery** creates a new Presence and reuses your saved area preferences.

Closing a tab does not explicitly delete a Presence; backend expiry applies. This is a foreground browser POC: background tabs and suspended devices can delay GPS and polling. The UI marks an accepted location stale when the backend freshness window passes.

## Transport contract

The authoritative file is **`openapi/openapi.yaml`**. It is not edited by the frontend. Generate transport types with:

```sh
npm run generate:api
# equivalent:
npx openapi-typescript openapi/openapi.yaml -o src/api/generated/schema.d.ts
```

`openapi-fetch` uses generated `paths` and `components` types. Application state has its own small local models; transport DTOs are not manually duplicated.

The supplied specification differs from the initial task examples:

| Item | Supplied contract used by this app |
| --- | --- |
| Metadata | `GET /.well-known/kavozi-location` |
| Authorization | `Authorization: KavoziPresence <presenceToken>` |
| Administrative result identifier | `id`, mapped to request `administrativeAreaId` |
| Backend URL | `http://localhost:18080` |

All response properties are optional in the specification. The application validates essential Presence and metadata fields, requires recording/acceptance statuses for mutations, and ignores incomplete offers. It does not fabricate protocol limits. Presence/inbox response intervals override metadata timing; returned expiry timestamps determine Presence and offer expiry. Discovery cadence is owned by the backend, not a frontend discovery endpoint.

The specification defines no error schemas or error-status semantics. Errors therefore use HTTP status only, never server exception text: network/5xx unavailable, 400/422 rejected input, 409 stale sequence/revision, 401/403 unusable credentials, and 404/410 unavailable resources. Only 401/403 trigger automatic credential replacement; an unavailable offer is not evidence of an invalid Presence. No counter-recovery endpoint, idempotency key for creation, pause endpoint, or Encounter API exists.

**Live verification limitation:** during implementation on 2026-09-17, the service listening on `localhost:18080` returned HTTP 404 for `GET /.well-known/kavozi-location`. Real-backend discovery could not be verified against that running instance. The frontend follows the supplied file; backend routes, configuration, and OpenAPI were not changed. Automated tests below use that contract with mocked responses.

## Source structure

```text
openapi/openapi.yaml              supplied source of truth
src/
  api/
    generated/schema.d.ts        generated transport types
    locationClient.ts            typed client, auth, safe HTTP errors
  app/
    App.tsx                      startup and page composition
    queryClient.ts               conservative Query defaults
    theme.ts                     MUI theme
  location/
    application/                 Presence lifecycle, locks, metadata,
                                 GPS validation/submission, full area replacement
    model/local.ts               local state, radius labels, own-area mapping
    persistence/db.ts            Dexie schema and repositories
    hooks/                       Presence, geolocation, inbox polling
    components/                  permission, area editor, autocomplete, offers
  test/                          MSW server, typed fixtures, test setup
  main.tsx                       React / Query / MUI providers
  index.css                      minimal global styles
  **/*.test.ts(x)                unit and integration coverage
e2e/discovery.spec.ts             two isolated browser contexts
playwright.config.ts
```

## IndexedDB and lifecycle

Database: `kavozi-location`, version **1**. Each table uses `key` as its primary key.

| Table / record | Stored data |
| --- | --- |
| `presences` / `current` | Presence ID, opaque token, expiry, location/inbox intervals, reserved and accepted location sequences, reserved and synchronized area revisions, latest submission time, latest accepted observation time |
| `configurations` / `areas` | Complete desired local area list; stable UUID per area; radius meters or administrative ID plus display name/type |
| `preferences` / `discovery` | Explicit stopped state, also set before a potentially ambiguous creation request |

Credentials are stored only in IndexedDB and transient memory. They are never written to localStorage, sessionStorage, URLs, logs, analytics, or rendered diagnostics. All protected requests use the same header factory; creation, metadata, and administrative search are public.

Startup reuses an unexpired Presence. Mutations and lifecycle changes are serialized using Web Locks across same-origin tabs, with a same-page promise queue as fallback where Web Locks are unavailable. Atomic IndexedDB transactions reserve counters before sending, so rejected or ambiguous requests cannot cause reuse of a number. A reload retains the throttling timestamp too.

A clear expiry replaces credentials. Invalid authentication permits one automatic replacement per mounted application, then stops until explicit retry. Automatic retries are disabled for creation. If creation fails ambiguously, reload remains stopped instead of issuing another silent POST; the public API cannot recover a token from a response that was lost. Successful deletion clears credentials and counter state but keeps area preferences. Failed deletion retains credentials so it can be retried.

## Geolocation and discovery

Location is requested only after an explicit click. `watchPosition` collects fixes; periodic `getCurrentPosition` requests refresh a stationary device at the Presence interval. The newest useful fix is coalesced, throttled, validated against metadata accuracy/freshness/future tolerance, and mapped to the exact generated request. Permission denial stops periodic permission attempts. Watchers and timers are cleaned up when stopping/unmounting.

Each commit sends the **complete** desired area set with a newly reserved revision, including an empty set when clearing discovery. IDs stay stable while editing, retrying, and reloading. A failed synchronization retains the desired configuration and shows a retry action. Backend metadata controls radius bounds, supported types, and maximum area count. Administrative search is debounced by 300 ms and supports the optional CITY/DISTRICT filter; no polygons or fabricated options are used.

Inbox polling starts when location is accepted/fresh and at least one area is synchronized. It honors the inbox response's `pollAfterSeconds`, otherwise the Presence's `inboxPollAfterSeconds`, and avoids immediate repeated fetching on re-enable. Offers map `localDiscoveryAreaIds` only to this browser's areas. Unknown IDs reveal nothing. Expired offers disappear, and accepting exposes only local recording status.

Development-only diagnostics show shortened own Presence/offer IDs, expiry, counters, own accuracy, local area IDs, timing configuration, and polling state. The diagnostics branch is removed from production builds.

## Dependencies

Runtime additions: MUI (`@mui/material`, Emotion), TanStack Query, `openapi-fetch`, and Dexie. Existing React and Vite are retained. TypeScript is pinned to the requested 5.x series (`~5.9.3`). No router is needed for this single-screen flow.

Development additions: `openapi-typescript`, Vitest, React Testing Library, user-event, jest-dom, MSW, jsdom, fake-indexeddb, and Playwright. No authentication, cryptographic, state-machine, or service-worker libraries are used.

## Verification

```sh
npm run generate:api
npm run typecheck
npm test
npm run lint
npm run build

# Install Chromium once if it is not already available:
npx playwright install chromium
npm run test:e2e
```

Unit/MSW integration tests cover persistence, concurrent startup, expiry and invalid credentials, ambiguous creation failure, monotonic sequence/revision and retry behavior, metadata limits, complete area replacement, own-ID mapping, public/protected authentication, geolocation submission/coalescing, empty/anonymous inboxes, polling cadence, accept/decline, administrative search, reload, and deletion failures.

The Playwright smoke test uses two isolated browser contexts with close mocked GPS positions and contract-shaped HTTP responses. It verifies independent credentials/area IDs, desktop/mobile layout, privacy-safe offers, local acceptance, reload sequencing, and deletion isolation. It does **not** simulate backend geographic matching or claim that Alice and Bob actually matched. Screenshots are written to the ignored `test-results/` directory. Tests never start a service worker.
