import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { diveTemplate, coffeeTemplate } from './intentFixtures'
import type { Template } from '../intent/api/intentTemplateClient'
import type { Schema } from '../api/locationClient'

export const base = 'http://localhost:8080'
import { metadata, fixturePresence } from './fixtures'
export { metadata, fixturePresence } from './fixtures'
function initialState() {
  return { templates: structuredClone([diveTemplate, coffeeTemplate]) as Template[], templateRequests: [] as string[], creates: 0, createAuth: [] as (string | null)[], auth: [] as string[],
    fixes: [] as Schema['FixRequest'][], configurations: [] as Schema['AreasRequest'][],
    inboxCalls: 0, offer: false, accepted: [] as string[], declined: [] as string[], deletes: 0, searches: [] as string[] }
}
export let apiState = initialState()
export function resetApiState() { apiState = initialState() }
function authorized(request: Request) {
  const auth = request.headers.get('Authorization') ?? ''
  apiState.auth.push(auth)
  return /^KavoziPresence test-secret-\d+$/.test(auth)
}
export const handlers = [
  http.get(`${base}/v1/intent-templates`, ({ request }) => {
    if (request.headers.has('Authorization')) return new HttpResponse(null, { status: 400 })
    apiState.templateRequests.push('catalogue')
    return HttpResponse.json(apiState.templates.map(({ key, name, description }) => ({ key, name, description })))
  }),
  http.get(`${base}/v1/intent-templates/:key`, ({ params, request }) => {
    if (request.headers.has('Authorization')) return new HttpResponse(null, { status: 400 })
    apiState.templateRequests.push(String(params.key))
    const template = apiState.templates.find((t) => t.key === params.key)
    return template ? HttpResponse.json(template) : new HttpResponse(null, { status: 404 })
  }),
  http.get(`${base}/.well-known/kavozi-location`, () => HttpResponse.json(metadata)),
  http.post(`${base}/v1/presences`, ({ request }) => {
    apiState.createAuth.push(request.headers.get('Authorization'))
    apiState.creates++
    return HttpResponse.json(fixturePresence(apiState.creates), { status: 201 })
  }),
  http.put(`${base}/v1/presences/:presenceId/location`, async ({ request }) => {
    if (!authorized(request)) return new HttpResponse(null, { status: 401 })
    const fix = await request.json() as Schema['FixRequest']
    apiState.fixes.push(fix)
    return HttpResponse.json({ status: 'ACCEPTED', sequence: fix.sequence, expiresAt: new Date(Date.now() + 3600_000).toISOString() } satisfies Schema['FixResponse'])
  }),
  http.put(`${base}/v1/presences/:presenceId/discovery-areas`, async ({ request }) => {
    if (!authorized(request)) return new HttpResponse(null, { status: 401 })
    apiState.configurations.push(await request.json() as Schema['AreasRequest'])
    return HttpResponse.json({ status: 'RECORDED' } satisfies Schema['RecordedResponse'])
  }),
  http.get(`${base}/v1/presences/:presenceId/inbox`, ({ request }) => {
    if (!authorized(request)) return new HttpResponse(null, { status: 401 })
    apiState.inboxCalls++
    return HttpResponse.json({ pollAfterSeconds: 45, offers: apiState.offer && !apiState.declined.length ? [{
      offerHandle: '00000000-0000-4000-8000-999999999999',
      localDiscoveryAreaIds: apiState.configurations.at(-1)?.areas.map((area) => area.id) ?? [],
      status: apiState.accepted.length ? 'ACCEPTED' : 'PENDING', expiresAt: new Date(Date.now() + 120_000).toISOString(),
    }] : [] } satisfies Schema['InboxResponse'])
  }),
  http.post(`${base}/v1/presences/:presenceId/offers/:offerHandle/accept`, ({ request, params }) => {
    if (!authorized(request)) return new HttpResponse(null, { status: 401 })
    apiState.accepted.push(String(params.offerHandle))
    return HttpResponse.json({ status: 'RECORDED' } satisfies Schema['RecordedResponse'])
  }),
  http.post(`${base}/v1/presences/:presenceId/offers/:offerHandle/decline`, ({ request, params }) => {
    if (!authorized(request)) return new HttpResponse(null, { status: 401 })
    apiState.declined.push(String(params.offerHandle))
    return HttpResponse.json({ status: 'RECORDED' } satisfies Schema['RecordedResponse'])
  }),
  http.delete(`${base}/v1/presences/:presenceId`, ({ request }) => {
    if (!authorized(request)) return new HttpResponse(null, { status: 401 })
    apiState.deletes++
    return new HttpResponse(null, { status: 204 })
  }),
  http.get(`${base}/v1/location/administrative-areas`, ({ request }) => {
    const query = new URL(request.url).searchParams.get('query') ?? ''
    apiState.searches.push(query)
    return HttpResponse.json(query.toLowerCase().includes('brat') ? [{
      id: '00000000-0000-4000-8000-888888888888', code: 'BA', name: 'Bratislava', type: 'CITY',
    } satisfies Schema['AdministrativeAreaResponse']] : [])
  }),
]
export const server = setupServer(...handlers)

export function position(overrides: Partial<GeolocationCoordinates> = {}, timestamp = Date.now()): GeolocationPosition {
  const coords = { latitude: 48.1486, longitude: 17.1077, accuracy: 18, altitude: null,
    altitudeAccuracy: null, heading: null, speed: null, ...overrides, toJSON: () => ({}) }
  return { coords, timestamp, toJSON: () => ({}) }
}
