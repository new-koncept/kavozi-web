import createClient from 'openapi-fetch'
import type { paths, components } from '../../api/generated/schema'
import { usableTemplate } from './templateDefinition'
import { API_BASE_URL, ApiError } from '../../api/locationClient'

export type Template = components['schemas']['TemplateResponse']
export type TemplateField = components['schemas']['TemplateField']
export type Constraints = components['schemas']['FieldConstraints']
const client = createClient<paths>({ baseUrl: API_BASE_URL, fetch: (request) => globalThis.fetch(request) })

async function read<T>(request: Promise<{ data?: T; response: Response }>) {
  let result: { data?: T; response: Response }
  try { result = await request } catch { throw new ApiError(0) }
  if (!result.response.ok) throw new ApiError(result.response.status)
  if (!result.data) throw new ApiError(502)
  return result.data
}
export const intentTemplateClient = {
  async list(signal?: AbortSignal) {
    const catalogue = await read(client.GET('/v1/intent-templates', { signal }))
    if (!Array.isArray(catalogue) || catalogue.some((entry) => !entry || typeof entry.key !== 'string' || !entry.key
      || typeof entry.name !== 'string' || !entry.name.trim()) || new Set(catalogue.map((entry) => entry.key)).size !== catalogue.length) throw new ApiError(502)
    return catalogue
  },
  async get(key: string, signal?: AbortSignal): Promise<Template> {
    const template = await read(client.GET('/v1/intent-templates/{key}', { params: { path: { key } }, signal }))
    if (!usableTemplate(template, key)) throw new ApiError(502)
    return template
  },
}
