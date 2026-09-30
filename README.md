# Kavozi web POC

An anonymous geographic discovery client with browser-owned Intents and node-authenticated Encounter text messaging. Concrete Intents remain in IndexedDB. Location checks geography and bilateral deterministic hard requirements. Encounter stores and forwards messages between its members. No accounts, AI execution, meeting negotiation, maps, or peer-location information are implemented.

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

Restart Vite after changing environment variables. The backend must allow CORS from the frontend origin, including Authorization, Content-Type, Content-Digest, Signature and Signature-Input on GET/POST/PUT/DELETE requests, and expose Retry-After. Use localhost or HTTPS for geolocation, Web Crypto and Web Locks. Normal development uses the real backend; MSW and Playwright interception are test-only. There is no service worker.

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
6. **Continue** records local interest; **Pass** hides an offer after recording. Once the backend makes an encounter available, each accepted client claims its own membership. Select **Open conversation**; messaging is enabled only when the encounter is `OPEN`. Find it later under **Conversations**.
7. Reload preserves Intents, stable projection IDs, Presence credentials, location sequence, and the user's location opt-in. If browser permission remains granted, location updates resume automatically. **Stop discovery** deletes Presence credentials and clears the location opt-in while keeping Intents. Starting again revalidates saved active choices.

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
    App.tsx                              Discovery / Your intents / Conversations navigation
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
- User Intent persistence remains local. AI execution, meeting negotiation and Connection behavior are not implemented. Encounter messaging is described below.

## Existing Location behavior

Presence creation remains anonymous/public. Credentials are stored only in IndexedDB and transient memory; one auth factory handles protected calls. They never appear in local/session storage, URLs, logs or diagnostics. Expired credentials are renewed; invalid auth has one automatic replacement before explicit retry. Ambiguous creation failure does not silently issue more POSTs after reload.

GPS requires an explicit initial opt-in, validates metadata accuracy/freshness/future tolerance, coalesces updates at the Presence interval and persists the monotonic sequence. On later loads, an opted-in session resumes automatically when browser permission remains granted. Successful fixes renew expiry when supplied. Inbox polling honors response/Presence intervals. Stop deletes the Presence, clears its credentials and location opt-in, and stops GPS/polling. Development diagnostics expose only shortened own IDs, counters, accuracy, polling state and projection IDs and synchronization status.

## Browser node identity

The browser bootstraps an independent Ed25519 node identity on startup. Expand **Node identity** below the application content to see status, public fingerprint, creation/registration times, retry errors, or deliberately regenerate the identity. Discovery does not wait for registration. Node identity does **not** bind or authenticate the current Presence: anonymous Presence creation and `Authorization: KavoziPresence <token>` are unchanged. Location requests are not signed.

`src/identity/application/NodeIdentityManager.ts` owns initialization, signing, registration and replacement. React receives only sanitized status and public metadata. `crypto.ts` centralizes unpadded Base64url, SHA-256 and the exact UTF-8 registration statement, including its final LF. Public requests use the existing generated OpenAPI client (`POST /v1/node-registration-challenges`, `POST /v1/nodes`). Both returned fingerprints must match the locally computed `sha256:` fingerprint of canonical DER SPKI. Ed25519 requires a supported browser and secure context (HTTPS or localhost); unsupported browsers show an explicit error and do not fall back to another algorithm.

Dexie database `kavozi-location` upgrades from version 3 to **4**, adding `nodeIdentities` keyed by `slot` (`active` or `candidate`). Existing Presence/Intent tables are preserved. Each identity record has explicit `schemaVersion: 1`, a local UUID, registration state, two structured-cloned `CryptoKey` objects, public SPKI/fingerprint and timestamps; a completed record additionally requires server node ID and matching fingerprint. The private key is generated with `extractable: false`, sign-only usage, and is never serialized to bytes. The public key is exportable SPKI with verify usage. Non-exportability prevents Web Crypto export; it does not prevent authorized code on this origin from using the key to sign.

On startup, a valid registered identity is reused. An incomplete identity resumes registration with the same persisted key. Keys are persisted before any network calls. Transient failures, expired challenges, protocol mismatches and corrupt records never silently generate a replacement. Expired challenges may be retried once with a fresh challenge for the same key; other failures require explicit retry. Deleting IndexedDB loses the identity permanently; a subsequent empty-storage startup creates a new one. There is no recovery or identity-preserving rotation.

Same-origin tabs coordinate with an exclusive Web Lock; a same-page queue coalesces initialization and serializes operations. Atomic singleton insertion ensures only one key wins even without Web Locks (such browsers may make duplicate registration attempts with that same key). Transactions are never held across crypto/network calls. Dexie notifications refresh identity metadata in other tabs. Signing loads the current active record rather than retaining an old private key in memory.

Regeneration requires a confirmation dialog and acknowledgment checkbox. The old identity stays in storage while a candidate is generated, persisted and registered. Only after successful registration does a single transaction replace the active record and delete the candidate/old stored key. A failed candidate is retained for **Retry pending identity replacement**, including after reload. An already registered candidate is promoted on reload without registering again. A newly confirmed regeneration discards an earlier unfinished candidate and generates a new one. Successful promotion publishes an identity-change notification and shows the new fingerprint. This is irreversible: conversations owned by the old identity become inaccessible, and future Connection ownership would also be lost. Pending messages are never transferred or sent with the replacement key.

**Registration crash window:** this backend verifies proof, then returns only `409 Conflict` for an already registered public key; it does not return the existing node ID. A crash after remote creation but before local persistence therefore enters `REGISTRATION_RECOVERY_REQUIRED`, preserving the original key. A backend idempotent, proof-backed recovery operation is needed to recover that node ID safely. The frontend never discards the key automatically or guesses the ID.

Tests use real Web Crypto Ed25519, backend SPKI/fingerprint golden vectors, fake IndexedDB/MSW and Chromium structured-cloning/two-tab tests. Opt-in live testing registers a permanent test node because no node-deletion API exists; the temporary Presence is cleaned up:

```sh
npm run test:e2e -- e2e/node-identity.spec.ts
KAVOZI_LIVE_BACKEND=1 npm run test:e2e -- e2e/node-identity.spec.ts
```

## Encounter text messaging

Use **Open conversation** on an accepted offer, or **Conversations** in navigation. Local acceptance does not imply mutual acceptance: admission handles `409 MATCH_NOT_READY` with up to ten delayed attempts, bounded by offer expiry, then offers an explicit retry. Every caller claims its own membership using both its existing Presence credential and its registered node signature. Both 200 idempotent and 201 initial admission responses are supported. `WAITING_FOR_MEMBERS` disables messaging; `OPEN` enables it. Closed/expired rooms remain readable only while the backend permits access. Leaving requires confirmation and removes access. Rosters support arbitrary participant collections, not fixed Alice/Bob fields. Labels are encounter-scoped; no peer node identifiers or fingerprints are displayed.

Implementation:

```text
src/encounter/
  api/httpSignature.ts            reusable request signer
  api/encounterClient.ts          generated openapi-fetch client, identity scope, safe errors
  application/textProtocol.ts    text encoding and byte limits
  application/events.ts          runtime checks, ordered event/message deduplication
  application/ConversationSession.ts  polling, outbox, send/retry/leave lifecycle
  persistence/outbox.ts          identity-scoped durable pending sends
  hooks/useEncounters.ts         node snapshot and paginated conversation list query
  components/EncounterAdmission.tsx
  components/EncountersPage.tsx
  components/Conversation.tsx
```

The supplied contract remains `openapi/openapi.yaml` (not under `src` in this repository). Signing is grounded in the accessible backend sources `koncept/kavozi/encounter/infrastructure/security/EncounterRequestAuthenticator.java`, `EncounterController.java`, `EncounterErrors.java`, the backend README's Encounter section, and `EncounterSignatureTests.java`. OpenAPI alone names the two signature headers but does not specify the signing base or error codes. The frontend checks the advertised profile and limits before signing; no unverified signing configuration is guessed.

**HTTP signing:** label `kavozi`, tag `kavozi-node-http-v1`, algorithm `ed25519`, fingerprint `keyid`; `created` and `expires` are epoch seconds with a maximum client lifetime of 60 seconds, further bounded by server metadata. Each network attempt uses a new random 32-byte unpadded Base64url nonce. All operations cover `@method` and exact `@target-uri`. Admission adds `authorization`; JSON message sends add exact `content-type` (`application/json`) and `content-digest` (`sha-256=:<standard padded Base64>:`). The signature is `kavozi=:<standard padded Base64>:`. The signature base uses LF between quoted components and ends with `"@signature-params"`; unlike registration it has **no final newline**. The backend reserves nonces before application work, so retrying never reuses HTTP proof. Clock skew, expired/replayed signatures and revoked/unknown nodes fail authentication; the client does not regenerate keys to fix this.

The signer uses the actual generated `Request.url`, including its encoded query, rather than reconstructing an internal backend URL. Development directly targets `VITE_API_BASE_URL=http://localhost:8080`. For a reverse proxy, set that URL to the browser-visible API and configure the backend's `ENCOUNTER_PUBLIC_ORIGIN` to the same external scheme/authority. Preserve the path and raw query: the backend public-origin setting does not compensate for stripped path prefixes. Forward signed headers and body bytes unchanged. Signed fetches reject redirects. Required CORS permissions are listed above; authentication must not be weakened to compensate for proxy/CORS mistakes.

**Text protocol:** `protocol: "kavozi.text.v1"`, `contentType: "text/plain; charset=utf-8"`, `payload` is canonical unpadded Base64url of UTF-8 text. This is encoding, not encryption. Limits use decoded UTF-8 byte length, the OpenAPI's encoded-payload cap, and the exact JSON request byte count. Unicode/diacritics/emoji are supported. Malformed Base64url/UTF-8, unknown protocols and unsupported content types render an “Unsupported message” placeholder. React renders plain text; HTML is never executed. “Stored” means accepted by the messenger, not read by another person.

**Reliability and persistence:** Dexie version **5** adds `encounterOutbox` with compound key `[fingerprint+encounterId]`, preserving existing tables/identities. It stores one unresolved send per node/conversation: sender participant ID, stable message UUID, original membership version, typed request and exact serialized JSON, plus pending/review status. Payloads in this local outbox are plaintext encoded; no end-to-end encryption is claimed. A send is persisted before its network request. Retry uses those same bytes/message ID with fresh signature metadata. The server's uniqueness scope is `(encounter, sender participant, messageId)`. POST acknowledgments and polled events merge once using that scope and sequence. Atomic outbox insertion and conditional deletion prevent another tab from overwriting/deleting an unresolved or newer send.

Membership conflicts retain the old request for review, refresh the roster, and require an explicit decision before a new message ID/body with the current version is created. Drafts also require review if the group changes while typing. Pending sends survive reload but are never automatically resent. On identity replacement, old requests are aborted; the signer checks the expected fingerprint against the active stored key inside its existing lock. Old outbox rows stay in their old identity namespace and are never used with a new key.

Conversation history and its cursor are held **only in memory together**. Reload requests accessible history again from `afterSequence=0`; the server applies `self.firstVisibleSequence` for members admitted later. Events are sorted/deduplicated, and the exact returned `nextAfterSequence` is used (sequences need not be contiguous). `hasMore` pages are drained immediately before polling at the advertised interval. Polls do not overlap, transient failures back off and respect Retry-After, reconnect/visibility changes resume checks, and unmount/leave/identity changes cancel requests and ignore late responses. Terminal rooms stop periodic event polling. Conversation lists are recovered through paginated node-signed requests without Presence credentials. `mySource.localDiscoveryProjectionIds` maps only to the caller's saved local intents; titles, preferences and agent instructions are never sent to Encounter.

**Live verification (2026-09-24):** two isolated Chromium contexts registered different real nodes, accepted a real matching offer, claimed the same encounter and exchanged Unicode messages once each. A response was deliberately lost *after* real server storage; retry returned the existing message without duplication. Reload recovered history; messaging continued after deleting the original Presence. A third registered non-member received 404 for room read, events and send. Leaving returned success, removed that member's access (404), and closed the two-member room. The API has no node deletion endpoint; test nodes remain registered and synthetic encounter data remains until backend retention cleanup. Temporary test Presences are deleted in `finally`.

Run the opt-in real test (not mocked messaging):

```sh
KAVOZI_LIVE_BACKEND=1 npm run test:e2e -- e2e/live-messaging.spec.ts
```

For manual verification, run Alice on 5173 and Bob on 5174 (or use separate browser profiles), wait for both node identities to be Ready, configure mutually eligible Intents and nearby mocked GPS, and click Continue on both offers. Open both conversations, exchange Czech/Slovak text and emoji, then reload. Stop discovery on one client and reopen via Conversations to confirm Presence independence. Temporarily disconnect that client, attempt a message, reconnect and retry the same message; verify one copy. Confirm Leave conversation and verify the former member no longer lists or accesses it. Automated tests additionally exercise a stored-but-lost response and direct signed non-member access.

No signing/CORS interoperability blocker was found against the running backend. The node-registration duplicate-key recovery gap documented above still applies. Encounter error schemas/profile details are missing from generated OpenAPI, so the checked backend verifier/service sources supply those details; raw error messages are never displayed. Invitation-management screens, AI, outcome/meeting negotiation and encryption are outside this increment.

## Verification commands

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
