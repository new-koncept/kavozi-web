# Kavozi web POC

An anonymous geographic discovery client with browser-owned Intents. The backend supplies the Location API and read-only Intent template vocabulary. Concrete Intents remain in IndexedDB. Location now checks geography and bilateral deterministic hard requirements. No accounts, AI execution, Encounter, messaging, maps, or peer-location information are implemented.

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
4. Return to **Discovery** and activate desired Intents. Each activation checks the current definition. Location receives the complete deterministic projection of all active Intents.
5. Anonymous offers may name your own matching Intent titles. This confirms mutual geography and hard requirements, not shared templates, preference compatibility, agent evaluation, or peer decisions.
6. **Continue** records local interest; **Pass** hides an offer after recording. No further progression is fabricated.
7. Reload preserves Intents, stable projection IDs, Presence credentials, and location sequence. Enable location again. **Stop discovery** deletes Presence credentials while keeping Intents. Starting again revalidates saved active choices.

Closing a tab does not delete a Presence; server expiry applies. Background-tab throttling can delay GPS/polling. The UI marks old location fixes stale.

## Source of truth and generation

The contract is **`openapi/openapi.yaml`**, with its server URL configured for port 8080. Generate transport declarations using:

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
- `PUT /v1/presences/{presenceId}/discovery-projections` replaces the complete `DiscoveryProjectionsRequest.projections` list.
- New generated types: `DiscoveryProjectionRequest`, `GeographyRequest`, `HardRequirementRequest`, `DiscoveryValue`, `ScalarValue` and six typed value variants.
- Inbox offers contain `localDiscoveryProjectionIds`. Metadata exposes `maxDiscoveryProjections`, `supportedGeographyTypes`, per-projection claim/requirement limits, set/text limits and a total request byte limit.
- Metadata remains `GET /.well-known/kavozi-location`.
- The default server is now port **8080**.
- Protected Presence requests send **`Authorization: KavoziPresence <presenceToken>`** with the exact case-sensitive prefix. The token belongs to the path’s Presence ID. Creation, metadata, administrative search, and template requests remain public.
- Template endpoints document `ErrorResponse` on 404. UI errors remain safe, status-based messages, without displaying raw server exceptions.

**Live verification (2026-09-20):** the running backend on `localhost:8080` passed the opt-in two-context Playwright flow: real template catalogue, typed claims, projection replacement, geolocation, inbox offers, deactivation and Presence deletion. Temporary test Presences were cleaned up. No backend/OpenAPI changes were made.

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

An Intent stores UUID `id`, `templateKey`, title, geography, claims, requirements, preferences, encounter options, optional agent instruction, active state, stable UUID `discoveryProjectionId`, and creation/update timestamps. `pendingDeletion` is retained only to finish pre-migration pending deletions. New mutations commit only after successful synchronization. There are **no Intent version, revision or templateVersion fields**.

Values are tagged local structures rather than transport DTOs:

- BOOLEAN / NUMBER / CODE / TEXT: `{ type, value }`.
- SET: `{ type: 'SET', elementType, values }`.
- RANGE: `{ type: 'RANGE', lower, upper }`.
- Requirements/preferences: local UUID, field key, supplied operator, tagged operand.

Tags detect type changes (including CODE -> TEXT and SET element-type changes) without reinterpreting saved data. In-progress editor geography/operands can be absent; required values are checked before save/activation.

Database **`kavozi-location`**, schema **3**, retains `presences`, `preferences` and `intents` (indexes `id, templateKey, updatedAt`). `active` is stored but not indexed because IndexedDB boolean keys are unsupported. The v3 migration moves each legacy Intent area UUID into `discoveryProjectionId`, removes the old property, and preserves all other Intent data, credentials and location sequences. The unused legacy `configurations` store is removed; full Intent geography remains intact. A migration test covers both v1 and v2 upgrades and reopening without regenerating UUIDs.

Templates are not persisted as authority. TanStack Query uses `['intentTemplates']` and `['intentTemplate', key]`, with two-minute freshness. Current definitions are fetched again for saving/activation/synchronization. Local Intent cards remain visible when the backend is unavailable; editing/activation do not guess a schema.

## Generic editing and validation

One renderer interprets field type, discriminated constraints, roles and permitted operators. Missing optional claims stay absent. CODE values store stable option values; SET supports code selections, boolean selections, numeric/text tags and ISO instants. RANGE uses numeric lower/upper values and unit labels. Agent sections use backend labels, prompt, required flag and maximum length. CUSTOM uses the same rendering path as every other template.

Validation checks template structure at runtime; local values, required roles, numeric bounds/steps, text length, options, set cardinality/type/uniqueness, range ordering, geography, allowed operators and agent constraints are checked before save and activation. Invalid preferences generate warnings, never activation blockers.

An incompatible current definition produces **Needs review**. Saved values remain intact and the editor provides explicit removal/clear actions for obsolete values. Invalid active Intents are withdrawn as whole projections before deactivation is persisted. No individual requirement is silently removed. Template fetch failure suspends remote projections where the backend remains reachable, while preserving local active choices for retry. If Location itself is unavailable, the UI reports synchronization failure rather than claiming that remote projections were cleared.

## Intent -> Location boundary

`compileDiscoveryProjection(intent, template, metadata)` and `compileActiveDiscoveryProjections(intents, templates, metadata)` are the single explicit application boundary into generated Location transport types:

```text
Intent.discoveryProjectionId -> projection.id
Intent.geography            -> geography (no display labels)
Intent.claims               -> field key -> typed DiscoveryValue
Intent.requirements         -> { field, operator, value: DiscoveryValue }
```

BOOLEAN, NUMBER, CODE and TEXT use `{ type, value }`. SET uses `{ type: 'SET', valueType, values: [{ type, value }, ...] }`: items are typed scalar objects, not raw strings. RANGE uses `{ type: 'RANGE', lower, upper }` with numeric bounds and no valueType. Claim keys and requirement `field` come from the exact same template field key, never a display label.

Only projection IDs, geography, claims and hard requirements are sent. Title, templateKey, preferences, encounter options, agent instruction, local predicate IDs and full templates never enter a Location request. Compilation checks the current template, UUID/geography, values, permitted operators, per-projection limits and UTF-8 byte size of the complete `{ projections }` request. The empty active set sends `{ projections: [] }`. Inbox `localDiscoveryProjectionIds` map only to saved Intents; unknown IDs reveal nothing.

Mutations use the existing same-origin Web Lock / same-page queue. Activation, deactivation, active edits and active deletion compile and send the complete desired state **before** writing to IndexedDB. Failure leaves the previous saved choice/configuration intact. Active deletion still requires confirmation. A storage failure after a successful request attempts to restore the prior remote configuration (or withdraw all projections); the UI remains blocked until resynchronization. Inactive edits/deletion remain local. Deterministic 4xx and compilation failures do not receive periodic synchronization retries; explicit retry or a changed configuration is required.

The discoverability indicator stays blocked during mutations and failed synchronization. Switches reflect saved state; pending changes have a row indicator. Retry attempts the failed toggle again. Preferences remain non-blocking local context. No agent is invoked.

## Explicit schema ambiguities and limits

- **Live catalogue currently has no hard-requirement fields.** All seven running templates expose no `REQUIREMENT` role (2026-09-20). The generic UI correctly omits hard-requirement controls for those templates; it does not promote preferences into requirements. Compiler and bilateral MSW scenarios use test templates that explicitly permit requirements. The backend must publish requirement-enabled template fields for users to configure these through the live UI.

- **Operator operand schemas are absent.** The local interpretation uses sets for scalar IN/NOT_IN, sets for INTERSECTS/CONTAINS_ALL, numeric ranges for RANGE_INTERSECTS, and field-shaped values for equality/comparison. Scalar members of IN retain original field bounds. Ambiguous combinations such as IN on a SET/RANGE or ordering a non-ordered code are visibly unsupported; they cannot become valid hard requirements. No matching is executed in the frontend. The OpenAPI does not specify a full operator/type compatibility matrix; backend rejection is surfaced safely, without retry loops.
- **`required` is field-wide, not role-specific.** It applies to supported About me / encounter-option values; requirement-only fields require a predicate. A field shared with CLAIM does not force an additional requirement. Preference-only missing/invalid data is non-blocking.
- **RANGE has no elementType.** Its numeric min/max/step imply the supported numeric range editor. Non-numeric ranges cannot be described by this contract.
- **Template SET INSTANT/REFERENCE cannot be represented by DiscoveryValue.** Template constraints still expose these element kinds, but discovery SET supports only BOOLEAN/NUMBER/CODE/TEXT. Local values remain editable/preserved. Such claims or hard requirements need review and cannot activate; preferences and encounter options stay local.
- **SET REFERENCE has no reference target or lookup endpoint.** It is editable only when explicit options supply stable values. A free-form or entity-search reference is not invented; configured/required unsupported values need review.
- **Administrative areas have no lookup-by-ID endpoint.** IDs originate from the shared backend search and are validated structurally as UUIDs. Continued existence is ultimately checked by Location when the projection is submitted.
- Most response properties are optional in OpenAPI. Essential keys, field definitions and metadata are runtime-checked before use. Agent sections are enabled when `AgentConfiguration.enabled` is true.
- **Ordered CODE comparisons:** template options include `order`, but the projection has no ordering table. Stable CODE values/operators are sent unchanged; the contract does not explain how the backend interprets custom ordering. The frontend does not convert codes to numbers or send template metadata.
- No Intent persistence, AI execution, Encounter, or messaging API exists here. Those capabilities are not simulated.

## Existing Location behavior

Presence creation remains anonymous/public. Credentials are stored only in IndexedDB and transient memory; one auth factory handles protected calls. They never appear in local/session storage, URLs, logs or diagnostics. Expired credentials are renewed; invalid auth has one automatic replacement before explicit retry. Ambiguous creation failure does not silently issue more POSTs after reload.

GPS requires an explicit action, validates metadata accuracy/freshness/future tolerance, coalesces updates at the Presence interval and persists the monotonic sequence. Successful fixes renew expiry when supplied. Inbox polling honors response/Presence intervals. Stop deletes the Presence, clears its credentials and stops GPS/polling. Development diagnostics expose only shortened own IDs, counters, accuracy, polling state and projection IDs and synchronization status.

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

# Explicit opt-in: uses localhost:8080 and cleans up temporary real Presences
KAVOZI_LIVE_BACKEND=1 npm run test:e2e -- e2e/live-discovery.spec.ts
```

The unit/MSW suite covers Location regressions, template vocabulary/runtime checks, all six generic field types, constraints, operator operands, preference behavior, template changes, IndexedDB persistence and migration, typed deterministic compilation and privacy boundaries, activation/deactivation, safe deletion retries, administrative search and local offer mapping.

Playwright creates Dive Buddy and Coffee & Conversation Intents in two isolated browser contexts with close mocked GPS fixes, activates both, checks deterministic projection payloads, local offer titles, desktop/mobile layout, acceptance isolation, reload persistence/sequence and Presence deletion. Screenshots are saved to ignored `test-results/`. This test validates browser behavior against mocked transport; it does not execute matching on a real backend. Additional MSW scenarios model co-located clients with CODE-set INTERSECTS: geographic-only failure, bilateral PASS, asymmetric failure and aggregation of multiple local IDs into one offer. This test-only fixture is not a production matching engine.
