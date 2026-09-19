# Kavozi web POC

An anonymous geographic discovery client with browser-owned Intents. The backend supplies the Location API and read-only Intent template vocabulary. Concrete Intents remain in IndexedDB. No accounts, AI execution, hard-filter backend matching, Encounter, messaging, maps, or peer-location information are implemented.

## Local development

Use Node.js 22.12+ and npm.

```sh
npm install
npm run generate:api
npm run dev
```

The current OpenAPI server is `http://localhost:8080`. Override it in `.env.local` using `.env.example`:

```dotenv
VITE_API_BASE_URL=http://localhost:8080
```

Restart Vite after changing environment variables. The backend must allow CORS from the frontend origin, including Authorization and JSON GET/POST/PUT/DELETE requests. Use localhost or HTTPS for geolocation and Web Locks. Normal development uses the real backend; MSW and Playwright interception are test-only. There is no service worker.

Two independent clients, in separate terminals:

```sh
# Alice — http://localhost:5173
npm run dev -- --port 5173 --strictPort
```

```sh
# Bob — http://localhost:5174
npm run dev -- --port 5174 --strictPort
```

Different ports have separate IndexedDB storage. Same-origin tabs share a Presence. Separate browser profiles also provide isolation.

1. Open each client and grant location permission using **Enable location**. Browser Sensors can simulate Alice at `48.1486, 17.1077` and Bob at `48.1487, 17.1078`, with acceptable accuracy.
2. Open **Your intents**, then **Create intent**. The catalogue comes from the backend; there is no production fallback catalogue.
3. Choose a template, enter a title and geography, then configure the available About me, Must match, Nice to have, encounter-option and agent sections. Save locally.
4. Return to **Discovery** and activate desired Intents. Each activation checks the current definition. Location receives the complete geographic projection of all active Intents.
5. Anonymous offers may name your own matching Intent titles. This confirms geographic eligibility only, not shared templates, satisfied requirements, or peer decisions.
6. **Continue** records local interest; **Pass** hides an offer after recording. No further progression is fabricated.
7. Reload preserves Intents, stable area IDs, Presence credentials, and location sequence. Enable location again. **Stop discovery** deletes Presence credentials while keeping Intents. Starting again revalidates saved active choices.

Closing a tab does not delete a Presence; server expiry applies. Background-tab throttling can delay GPS/polling. The UI marks old location fixes stale.

## Source of truth and generation

The supplied **`openapi/openapi.yaml`** remains unchanged. Generate transport declarations using:

```sh
npm run generate:api
# equivalent:
npx openapi-typescript openapi/openapi.yaml -o src/api/generated/schema.d.ts
```

Both clients use generated `paths`/`components` types with `openapi-fetch`; there are no hand-written template DTO copies.

Current changes in the supplied contract:

- `GET /v1/intent-templates` / `listIntentTemplates` returns `IntentTemplateSummary[]`.
- `GET /v1/intent-templates/{key}` / `getIntentTemplate` returns `TemplateResponse`.
- Template types include `TemplateField`, discriminated `FieldConstraints`, the six constraint variants, `FieldOption`, and `AgentConfiguration`.
- `AreasRequest` now contains **only `areas`**. No revision is sent to Location.
- Metadata remains `GET /.well-known/kavozi-location`.
- The default server is now port **8080**.
- The security scheme description literally specifies **`KavozilPresence <token>`**, including the extra `l`. The centralized header follows that supplied spelling; it was not silently corrected to the previous `KavoziPresence`.
- Template endpoints document `ErrorResponse` on 404. UI errors remain safe, status-based messages, without displaying raw server exceptions.

**Live verification:** on 2026-09-18 nothing was listening at `localhost:8080`, including when checked outside the sandbox. Tests pass against contract-shaped mocks. Real backend compatibility, particularly the auth-prefix spelling, is not yet verified. No backend or OpenAPI changes were made.

## Structure

```text
src/
  api/
    generated/schema.d.ts
    locationClient.ts                    shared base URL, Location auth/errors
  app/
    App.tsx                              Discovery / Your intents navigation
    queryClient.ts
    theme.ts
  intent/
    api/
      intentTemplateClient.ts            public, read-only typed requests
      templateDefinition.ts              runtime template-definition checks
    model/Intent.ts                      local tagged values, predicates, geography
    persistence/intentRepository.ts      local reads; service owns mutations
    application/
      fieldSemantics.ts                  central operator labels / operand shapes
      intentValidator.ts                 value, geography, compatibility checks
      intentService.ts                   save / activate / deactivate / safe delete
      intentDiscoveryProjection.ts       sole Intent -> Location transport boundary
    hooks/useIntents.ts                   live IndexedDB state and Query templates
    components/
      IntentEditor.tsx                   one schema-driven editor for all templates
      TemplateFieldEditor.tsx             six generic field types
      PredicateEditor.tsx                requirements and preferences
      GeographyEditor.tsx                shared Location geography controls
      IntentCard.tsx                     state, review, activation, deletion dialog
    pages/IntentsPage.tsx                 catalogue, create/edit/list
  location/
    application/                         existing Presence and GPS services
    persistence/db.ts                    extended Dexie database
    hooks/                               Presence, GPS, inbox
    components/                          discovery, offers, shared geography inputs
    model/
  test/                                  MSW fixtures and setup
  **/*.test.ts(x)                         unit and integration tests
e2e/discovery.spec.ts                     desktop/mobile, two isolated contexts
```

Navigation uses two views in the existing single-page app, without adding a router. The discovery session remains mounted while managing Intents so navigation does not interrupt an enabled GPS watch.

## Local model and IndexedDB

An Intent stores UUID `id`, `templateKey`, title, geography, claims, requirements, preferences, encounter options, optional agent instruction, active state, stable UUID `discoveryAreaId`, and creation/update timestamps. `pendingDeletion` records a failed active-deletion synchronization for safe retry. There are **no Intent version, revision or templateVersion fields**.

Values are tagged local structures rather than transport DTOs:

- BOOLEAN / NUMBER / CODE / TEXT: `{ type, value }`.
- SET: `{ type: 'SET', elementType, values }`.
- RANGE: `{ type: 'RANGE', lower, upper }`.
- Requirements/preferences: local UUID, field key, supplied operator, tagged operand.

Tags detect type changes (including CODE -> TEXT and SET element-type changes) without reinterpreting saved data. In-progress editor geography/operands can be absent; required values are checked before save/activation.

Database **`kavozi-location`**, schema **2**, adds `intents` with indexes `id, templateKey, updatedAt`. `active` is stored but deliberately not indexed: IndexedDB does not support boolean keys. Existing v1 Presence, configuration and preference stores survive the upgrade. Legacy raw-area preferences are retained locally but are no longer the primary UI or projected into discovery. No template or Intent is invented to migrate them; create Intents explicitly. The first new synchronization replaces legacy remote geography with active Intent geography (or an empty list).

Templates are not persisted as authority. TanStack Query uses `['intentTemplates']` and `['intentTemplate', key]`, with two-minute freshness. Current definitions are fetched again for saving/activation/synchronization. Local Intent cards remain visible when the backend is unavailable; editing/activation do not guess a schema.

## Generic editing and validation

One renderer interprets field type, discriminated constraints, roles and permitted operators. Missing optional claims stay absent. CODE values store stable option values; SET supports code selections, boolean selections, numeric/text tags and ISO instants. RANGE uses numeric lower/upper values and unit labels. Agent sections use backend labels, prompt, required flag and maximum length. CUSTOM uses the same rendering path as every other template.

Validation checks template structure at runtime; local values, required roles, numeric bounds/steps, text length, options, set cardinality/type/uniqueness, range ordering, geography, allowed operators and agent constraints are checked before save and activation. Invalid preferences generate warnings, never activation blockers.

An incompatible current definition produces **Needs review**. Saved values remain intact and the editor provides explicit removal/clear actions for obsolete values. Invalid active Intents are deactivated and their geography withdrawn. Template fetch failure suspends remote geography where the backend remains reachable, while preserving local active choices for retry. If Location itself is unavailable, the UI reports synchronization failure rather than claiming that remote geography was cleared.

## Intent -> Location boundary

`buildLocationDiscoveryAreas(activeIntents)` is the only conversion from Intent geography to generated `AreaRequest[]`:

```text
Intent.discoveryAreaId -> AreaRequest.id
RADIUS -> radiusMeters
ADMINISTRATIVE_AREA -> administrativeAreaId
```

Every update replaces the complete set, including `areas: []` for zero active Intents. The current metadata maximum is enforced. Template key, title, claims, predicates, encounter options and agent instruction never enter a Location request. Inbox `localDiscoveryAreaIds` map only to saved Intents' `discoveryAreaId`; unknown IDs reveal nothing.

Lifecycle and projection mutations use the existing same-origin Web Lock / same-page promise queue. Failed activation/deactivation synchronization preserves the desired local state and provides retry. Deleting an active Intent requires confirmation, persists it inactive with a pending-deletion marker, synchronizes remaining geography, then removes the record. If synchronization fails, the record remains and **Retry delete** repeats synchronization before deletion. Inactive Intents without pending deletion can be removed locally.

## Explicit schema ambiguities and limits

- **Operator operand schemas are absent.** The local interpretation uses sets for scalar IN/NOT_IN, sets for INTERSECTS/CONTAINS_ALL, numeric ranges for RANGE_INTERSECTS, and field-shaped values for equality/comparison. Scalar members of IN retain original field bounds. Ambiguous combinations such as IN on a SET/RANGE or ordering a non-ordered code are visibly unsupported; they cannot become valid hard requirements. No matching is executed.
- **`required` is field-wide, not role-specific.** It applies to supported About me / encounter-option values; requirement-only fields require a predicate. A field shared with CLAIM does not force an additional requirement. Preference-only missing/invalid data is non-blocking.
- **RANGE has no elementType.** Its numeric min/max/step imply the supported numeric range editor. Non-numeric ranges cannot be described by this contract.
- **SET INSTANT has no declared wire format.** Local values use ISO-8601 instants; the editor accepts device-local date/time and normalizes to an ISO timestamp. Nothing is transmitted to Location.
- **SET REFERENCE has no reference target or lookup endpoint.** It is editable only when explicit options supply stable values. A free-form or entity-search reference is not invented; configured/required unsupported values need review.
- **Administrative areas have no lookup-by-ID endpoint.** IDs originate from the shared backend search and are validated structurally as UUIDs. Continued existence is ultimately checked by Location when the projected area is submitted.
- Most response properties are optional in OpenAPI. Essential keys, field definitions and metadata are runtime-checked before use. Agent sections are enabled when `AgentConfiguration.enabled` is true.
- No Intent persistence, deterministic-matching projection, AI execution, Encounter, or messaging API exists here. Those capabilities are not simulated.

## Existing Location behavior

Presence creation remains anonymous/public. Credentials are stored only in IndexedDB and transient memory; one auth factory handles protected calls. They never appear in local/session storage, URLs, logs or diagnostics. Expired credentials are renewed; invalid auth has one automatic replacement before explicit retry. Ambiguous creation failure does not silently issue more POSTs after reload.

GPS requires an explicit action, validates metadata accuracy/freshness/future tolerance, coalesces updates at the Presence interval and persists the monotonic sequence. Successful fixes renew expiry when supplied. Inbox polling honors response/Presence intervals. Stop deletes the Presence, clears its credentials and stops GPS/polling. Development diagnostics expose only shortened own IDs, counters, accuracy, polling state and the local-only structured matching limitation.

## Verification

No new dependencies were required for Intent management. The existing React, TypeScript 5.x, Vite, MUI, TanStack Query, openapi-typescript/openapi-fetch, Dexie and test stack are reused.

```sh
npm run generate:api
npm run typecheck
npm test
npm run lint
npm run build

# Install Chromium once if necessary:
npx playwright install chromium
npm run test:e2e
```

The unit/MSW suite covers Location regressions, template vocabulary/runtime checks, all six generic field types, constraints, operator operands, preference behavior, template changes, IndexedDB persistence and migration, full geography projection, activation/deactivation, safe deletion retries, administrative search and local offer mapping.

Playwright creates Dive Buddy and Coffee & Conversation Intents in two isolated browser contexts with close mocked GPS fixes, activates both, checks geography-only payloads, local offer titles, desktop/mobile layout, acceptance isolation, reload persistence/sequence and Presence deletion. Screenshots are saved to ignored `test-results/`. This test validates browser behavior against mocked transport; it does not execute geographic or structured matching on a real backend.
