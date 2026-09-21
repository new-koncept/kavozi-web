import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { locationClient, type Schema } from '../../api/locationClient'
import { apiState, base, metadata, resetApiState, server } from '../../test/server'
import { diveTemplate, fixtureIntent } from '../../test/intentFixtures'
import { compileActiveDiscoveryProjections } from './intentDiscoveryProjection'
import { intentsForOffer } from '../model/Intent'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(resetApiState)
afterEach(() => server.resetHandlers())

it('models co-located clients: geographic eligibility alone fails, bilateral requirements pass, asymmetric failure blocks, and qualifying local IDs aggregate', async () => {
  // Contract-shaped test fixture, not a production matcher or a substitute for backend tests.
  // Both clients use the same fresh position and radius; this fixture evaluates only CODE-set INTERSECTS.
  const configurations = new Map<string, Schema['DiscoveryProjectionRequest'][]>()
  const fixes = new Set<string>()
  const credentials = new Map<string, string>()
  const passes = (a: Schema['DiscoveryProjectionRequest'], b: Schema['DiscoveryProjectionRequest']) =>
    (a.requirements ?? []).every((requirement) => {
      const actual = b.claims?.[requirement.field], expected = requirement.value
      return requirement.operator === 'INTERSECTS' && actual?.type === 'SET' && expected.type === 'SET' &&
        actual.values.some((value) => expected.values.some((target) => value.type === target.type && value.value === target.value))
    })
  server.use(
    http.put(`${base}/v1/presences/:presenceId/discovery-projections`, async ({ params, request }) => {
      const id = String(params.presenceId)
      expect(request.headers.get('Authorization')).toBe(`KavoziPresence ${credentials.get(id)}`)
      const body = await request.json() as Schema['DiscoveryProjectionsRequest']
      configurations.set(id, body.projections)
      return HttpResponse.json({ status: 'RECORDED' })
    }),
    http.get(`${base}/v1/presences/:presenceId/inbox`, ({ params }) => {
      const id = String(params.presenceId), own = configurations.get(id) ?? []
      const ids = own.filter((a) => fixes.has(id) && [...configurations].some(([otherId, projections]) => otherId !== id && fixes.has(otherId) && projections.some((b) => passes(a, b) && passes(b, a)))).map((projection) => projection.id)
      const response: Schema['InboxResponse'] = { pollAfterSeconds: 30, offers: ids.length ? [{ offerHandle: '00000000-0000-4000-8000-999999999999', localDiscoveryProjectionIds: ids, status: 'PENDING', expiresAt: new Date(Date.now() + 120_000).toISOString() }] : [] }
      return HttpResponse.json(response)
    }),
  )
  const create = async () => {
    const response = await locationClient.createPresence()
    const presence = { id: response.presenceId!, token: response.presenceToken! }
    credentials.set(presence.id, presence.token)
    await locationClient.updateLocation(presence, { latitude: 48.1486, longitude: 17.1077, accuracyMeters: 18, observedAt: new Date().toISOString(), sequence: 1 })
    fixes.add(presence.id)
    return presence
  }
  const alice = await create(), bob = await create()
  const template = structuredClone(diveTemplate)
  const languages = template.fields!.find((field) => field.key === 'languages')!
  if (languages.constraints?.kind === 'SET') languages.constraints.options!.push({ value: 'sk', label: 'Slovak' })
  const templates = new Map([['dive', template]])
  const intent = (title: string, speaks: string[], requires: string[]) => fixtureIntent({ title, active: true,
    claims: { languages: { type: 'SET', elementType: 'CODE', values: speaks } },
    requirements: requires.length ? [{ id: crypto.randomUUID(), fieldKey: 'languages', operator: 'INTERSECTS', value: { type: 'SET', elementType: 'CODE', values: requires } }] : [],
  })
  const aliceIntent = intent('Alice local title', ['en'], ['en'])
  let bobIntent = intent('Bob private title', ['sk'], [])
  const send = (presence: typeof alice, intents: ReturnType<typeof intent>[]) => locationClient.replaceDiscoveryProjections(presence, { projections: compileActiveDiscoveryProjections(intents, templates, metadata) })
  await send(alice, [aliceIntent]); await send(bob, [bobIntent])
  expect((await locationClient.getInbox(alice)).offers).toEqual([])
  expect((await locationClient.getInbox(bob)).offers).toEqual([])
  bobIntent = { ...bobIntent, claims: { languages: { type: 'SET', elementType: 'CODE', values: ['sk', 'en'] } } }
  await send(bob, [bobIntent])
  expect((await locationClient.getInbox(alice)).offers?.[0].localDiscoveryProjectionIds).toEqual([aliceIntent.discoveryProjectionId])
  expect((await locationClient.getInbox(bob)).offers?.[0].localDiscoveryProjectionIds).toEqual([bobIntent.discoveryProjectionId])
  bobIntent = { ...bobIntent, requirements: intent('unused', [], ['sk']).requirements }
  await send(bob, [bobIntent])
  expect((await locationClient.getInbox(alice)).offers).toEqual([])
  expect((await locationClient.getInbox(bob)).offers).toEqual([])
  bobIntent = { ...bobIntent, requirements: [] }
  const second = intent('Another local intent', ['en'], ['en'])
  await send(alice, [aliceIntent, second]); await send(bob, [bobIntent])
  const inbox = await locationClient.getInbox(alice)
  expect(inbox.offers).toHaveLength(1)
  expect(intentsForOffer(inbox.offers![0].localDiscoveryProjectionIds!, [aliceIntent, second]).map((value) => value.title)).toEqual(['Alice local title', 'Another local intent'])
  expect(Object.keys(inbox.offers![0]).sort()).toEqual(['expiresAt', 'localDiscoveryProjectionIds', 'offerHandle', 'status'])
  expect(JSON.stringify(inbox)).not.toContain(bobIntent.discoveryProjectionId)
  expect(apiState.fixes).toHaveLength(2)
})
