import { ProjectionError } from '../../intent/application/intentDiscoveryProjection'
import { useEffect, useRef, useState } from 'react'
import { useMutation, onlineManager } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'
import type { LocationMetadata } from '../application/metadata'
import type { LocalPresence } from '../model/local'
import { useGeolocation } from '../hooks/useGeolocation'
import { useInbox } from '../hooks/useInbox'
import { OfferCard } from './OfferCard'
import { geographyLabel, type Intent } from '../../intent/model/Intent'
import { IntentToggleList } from '../../intent/components/IntentToggleList'
import { intentService, IntentError } from '../../intent/application/intentService'
import { deriveDiscoverability, type DiscoveryReadiness } from '../application/discoverability'
import { DiscoverabilityPanel } from './DiscoverabilityPanel'

export function DiscoverySession({ presence, metadata, intents, synchronized, syncError, syncing, onRetry, stopping, onStop, onManage, onChanged, loading, error, onStart, onRecover }: {
  presence?: LocalPresence | null; metadata?: LocationMetadata; intents: Intent[]; synchronized: boolean
  syncError?: string; syncing: boolean; onRetry: () => Promise<boolean>; stopping: boolean; onStop: () => void
  onManage: () => void; onChanged: () => void; loading: boolean; error: boolean; onStart: () => void; onRecover: () => void
}) {
  const [locationPresence, setLocationPresence] = useState<string>()
  const [watchAttempt, setWatchAttempt] = useState(0)
  const location = useGeolocation(presence?.id, Boolean(presence && locationPresence === presence.id && !stopping), metadata, presence?.locationInterval ?? 30, watchAttempt)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const deadlines = [Date.parse(presence?.expiresAt ?? ''), (presence?.acceptedObservedAt ?? 0) + (metadata?.locationFreshnessSeconds ?? 0) * 1000]
    const tick = () => setNow(Date.now())
    const timers = deadlines.filter((time) => time > Date.now()).map((time) => setTimeout(tick, Math.min(2147483647, time - Date.now())))
    const interval = setInterval(tick, 1000)
    window.addEventListener('focus', tick)
    return () => { timers.forEach(clearTimeout); clearInterval(interval); window.removeEventListener('focus', tick) }
  }, [presence?.expiresAt, presence?.acceptedObservedAt, metadata?.locationFreshnessSeconds])
  const busy = useRef(false)
  const change = useMutation({
    mutationKey: ['intent-write'],
    mutationFn: ({ id, active }: { id: string; active: boolean }) => intentService.setActive(id, active, metadata!),
    onSettled: () => { busy.current = false; onChanged() },
  })
  const online = useSyncExternalStore((notify) => onlineManager.subscribe(notify), () => onlineManager.isOnline())
  const readiness: DiscoveryReadiness = {
    now, presence, loading, stopping, error, enabledCount: intents.filter((intent) => intent.active).length,
    freshnessSeconds: metadata?.locationFreshnessSeconds, futureToleranceSeconds: metadata?.futureToleranceSeconds,
    location: location.status,
    synchronization: change.isPending || syncing ? 'pending' : syncError || change.isError ? 'failed' : synchronized ? 'ready' : 'pending',
    synchronizationMessage: change.error instanceof ProjectionError || change.error instanceof IntentError ? change.error.message : syncError,
    inbox: 'pending',
  }
  const canPoll = deriveDiscoverability(readiness).canPoll
  const inbox = useInbox(presence, canPoll)
  const state = deriveDiscoverability({ ...readiness, inbox: !online || inbox.fetchStatus === 'paused' ? 'paused' : inbox.isError ? 'failed' : inbox.isSuccess ? 'ready' : 'pending' })
  const updateLocation = () => { setLocationPresence(presence?.id); setWatchAttempt((value) => value + 1) }
  const act = () => {
    switch (state.action) {
      case 'location': updateLocation(); break
      case 'manage': onManage(); break
      case 'start': onStart(); break
      case 'retry': onRecover(); break
      case 'inbox': void inbox.refetch(); break
      case 'sync':
        if (change.isError && change.variables) { busy.current = true; change.mutate(change.variables) }
        else void onRetry().then((success) => { if (success) change.reset() })
        break
    }
  }
  return <Stack spacing={3}>
    <DiscoverabilityPanel state={state} onAction={act} location={location} onRefresh={updateLocation} />
    <IntentToggleList intents={intents} metadata={metadata} pendingId={change.isPending ? change.variables.id : undefined}
      disabled={change.isPending || stopping || loading || !presence || !metadata}
      onToggle={(id, active) => { if (!busy.current) { busy.current = true; change.mutate({ id, active }) } }} />
    <Button variant="outlined" onClick={onManage}>Manage intents</Button>
    {presence && location.status === 'idle' && state.action !== 'location' && <Button onClick={updateLocation}>Enable location</Button>}
    {!stopping && presence && (inbox.data?.offers ?? []).map((offer) => <OfferCard key={offer.offerHandle} offer={offer} presence={presence} intents={intents} />)}
    {presence && <><Button disabled={stopping} onClick={onStop} sx={{ alignSelf: 'center' }}>{stopping ? 'Stopping…' : 'Stop discovery'}</Button>
      <Typography variant="caption" sx={{ textAlign: 'center' }} color="text.secondary">Stopping deletes this anonymous presence. Your intents stay on this device.</Typography></>}
    {import.meta.env.DEV && presence && <Box component="details" sx={{ fontSize: 12, color: 'text.secondary', borderTop: '1px solid', borderColor: 'divider', pt: 2 }}>
      <summary>Development diagnostics · this browser only</summary>
      <p>Presence: {presence.id.slice(0, 8)}… · Expires: {presence.expiresAt}</p>
      <p>Location sequence: {presence.acceptedSequence} accepted / {presence.sequence} reserved</p>
      <p>Own accuracy: {location.accuracy ?? '—'} m · Inbox: {canPoll ? inbox.fetchStatus : 'paused'}</p>
      {intents.filter((intent) => intent.active).map((intent) => <p key={intent.id}>{intent.title} · Projection: {intent.discoveryProjectionId.slice(0, 8)}… · {geographyLabel(intent.geography)} · Claims: {Object.keys(intent.claims).length} · Hard requirements: {intent.requirements.length}</p>)}
      <p>Location + hard requirements · Sync: {synchronized && !syncing && !syncError ? 'OK' : 'Pending or failed'}</p>
      <p>Offer handles: {(inbox.data?.offers ?? []).map((offer) => offer.offerHandle?.slice(0, 8)).join(', ') || 'none'}</p>
    </Box>}
  </Stack>
}
