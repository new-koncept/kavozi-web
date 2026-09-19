import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'
import { useQueries, useQuery } from '@tanstack/react-query'
import { intentRepository } from '../persistence/intentRepository'
import { intentTemplateClient } from '../api/intentTemplateClient'
import type { Intent } from '../model/Intent'

export function useIntents() {
  const [state, setState] = useState<{ data: Intent[]; loading: boolean; error?: Error }>({ data: [], loading: true })
  useEffect(() => {
    const subscription = liveQuery(intentRepository.list).subscribe({
      next: (data) => setState({ data, loading: false }),
      error: () => setState({ data: [], loading: false, error: new Error('Local intents could not be loaded.') }),
    })
    return () => subscription.unsubscribe()
  }, [])
  return state
}
export const templateQuery = (key: string) => ({
  queryKey: ['intentTemplate', key], queryFn: ({ signal }: { signal: AbortSignal }) => intentTemplateClient.get(key, signal),
  staleTime: 120_000, refetchInterval: 120_000,
})
export function useIntentTemplate(key: string) { return useQuery(templateQuery(key)) }
export function useIntentTemplates() {
  return useQuery({ queryKey: ['intentTemplates'], queryFn: ({ signal }) => intentTemplateClient.list(signal), staleTime: 120_000 })
}
export function useCurrentTemplates(intents: Intent[]) {
  const keys = [...new Set(intents.map((intent) => intent.templateKey))].sort()
  const queries = useQueries({ queries: keys.map(templateQuery) })
  return keys.map((key, index) => ({ key, ...queries[index] }))
}
