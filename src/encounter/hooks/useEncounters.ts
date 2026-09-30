import { useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { nodeIdentityManager } from '../../identity/application/NodeIdentityManager'
import { createEncounterClient, retryDelay, EncounterError } from '../api/encounterClient'
import { validateEncounter, type EncounterView } from '../application/events'

export const useNodeIdentity = () => useSyncExternalStore(nodeIdentityManager.subscribe, nodeIdentityManager.getSnapshot)
export function useEncounters(fingerprint: string) {
  return useQuery({
    queryKey: ['encounters', fingerprint],
    queryFn: async ({ signal }) => {
      const api = createEncounterClient(fingerprint)
      try {
        const metadata = await api.metadata()
        const rooms = new Map<string, EncounterView>(), cursors = new Set<string>()
        let cursor: string | undefined
        do {
          const page = await api.list(cursor, signal)
          if (!Array.isArray(page.encounters)) throw new EncounterError(502, 'INVALID_RESPONSE')
          for (const value of page.encounters) { const room = validateEncounter(value); rooms.set(room.encounterId, room) }
          cursor = page.nextCursor || undefined
          if (cursor && cursors.has(cursor)) throw new EncounterError(502, 'INVALID_RESPONSE')
          if (cursor) cursors.add(cursor)
        } while (cursor && !signal.aborted)
        signal.throwIfAborted()
        return { rooms: [...rooms.values()], interval: metadata.pollAfterSeconds * 1000 }
      } finally { api.dispose() }
    },
    gcTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => query.state.error
      ? query.state.error instanceof EncounterError && query.state.error.transient ? retryDelay(query.state.error, query.state.errorUpdateCount) : false
      : query.state.data?.interval ?? false,
  })
}
