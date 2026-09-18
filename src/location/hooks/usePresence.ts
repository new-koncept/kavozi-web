import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { liveQuery } from 'dexie'
import { invalidPresenceEvents } from '../../api/locationClient'
import { db, presenceRepository } from '../persistence/db'
import { presenceService } from '../application/presenceService'
import type { LocalPresence } from '../model/local'

export function usePresence() {
  const client = useQueryClient()
  const [notice, setNotice] = useState('')
  const [recovering, setRecovering] = useState(false)
  const recovered = useRef(false)
  const stopping = useRef(false)
  const query = useQuery({ queryKey: ['presence'], queryFn: () => presenceService.ensure(), staleTime: Infinity })
  useEffect(() => {
    // Keep tabs and requests in sync without storing credentials in another medium.
    const subscription = liveQuery(async () => ({
      current: await presenceRepository.get(), preference: await db.preferences.get('discovery'),
    })).subscribe(({ current, preference }) => {
      if (current) client.setQueryData(['presence'], current)
      else if (preference?.stopped) client.setQueryData(['presence'], null)
    })
    const invalid = (event: Event) => {
      if (!(event instanceof CustomEvent) || stopping.current) return
      const id: unknown = event.detail
      if (typeof id !== 'string' || client.getQueryData<LocalPresence | null>(['presence'])?.id !== id) return
      client.setQueryData(['presence'], null)
      client.removeQueries({ queryKey: ['inbox'] })
      const allowCreate = !recovered.current
      recovered.current = true
      setRecovering(true)
      setNotice(allowCreate ? 'Your previous presence expired. Creating a fresh anonymous presence.'
        : 'Your presence could not be authenticated. Discovery is stopped; try again when the service is ready.')
      void presenceService.recover(id, allowCreate).then((presence) => {
        client.setQueryData(['presence'], presence)
      }).catch(() => {
        setNotice('Could not renew your anonymous presence. Use Start discovery to try again.')
      }).finally(() => setRecovering(false))
    }
    invalidPresenceEvents.addEventListener('invalid', invalid)
    return () => { subscription.unsubscribe(); invalidPresenceEvents.removeEventListener('invalid', invalid) }
  }, [client])
  const expiresAt = query.data?.expiresAt
  const refetch = query.refetch
  useEffect(() => {
    if (!expiresAt) return
    const timer = setTimeout(() => { void refetch() }, Math.min(2_147_483_647, Math.max(1, Date.parse(expiresAt) - Date.now() + 10)))
    return () => clearTimeout(timer)
  }, [expiresAt, refetch])
  const start = useMutation({
    mutationFn: async () => {
      client.setQueryData(['presence'], await presenceService.ensure(true))
    },
    onSuccess: () => setNotice(''),
  })
  const stop = useMutation({
    mutationFn: async () => {
      stopping.current = true
      try { await presenceService.stop() } finally { stopping.current = false }
    },
    onSuccess: () => { client.setQueryData(['presence'], null); client.removeQueries({ queryKey: ['inbox'] }); setNotice('') },
  })
  return { ...query, start, stop, notice, recovering }
}
