import { useQuery } from '@tanstack/react-query'
import { locationClient } from '../../api/locationClient'
import type { LocalPresence } from '../model/local'

export function useInbox(presence: LocalPresence | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['inbox', presence?.id],
    queryFn: ({ signal }) => locationClient.getInbox(presence!, signal),
    enabled: enabled && Boolean(presence),
    staleTime: (query) => {
      const supplied = query.state.data?.pollAfterSeconds
      return (typeof supplied === 'number' && Number.isFinite(supplied) && supplied > 0 ? supplied : (presence?.inboxInterval ?? 30)) * 1000
    },
    refetchInterval: (query) => {
      if (!enabled) return false
      const supplied = query.state.data?.pollAfterSeconds
      return (typeof supplied === 'number' && Number.isFinite(supplied) && supplied > 0 ? supplied : (presence?.inboxInterval ?? 30)) * 1000
    },
    refetchIntervalInBackground: false,
  })
}
