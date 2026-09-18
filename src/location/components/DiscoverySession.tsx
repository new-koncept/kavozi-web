import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import { errorMessage } from '../../api/locationClient'
import { replaceDiscoveryAreas } from '../application/discoveryAreaService'
import type { LocationMetadata } from '../application/metadata'
import { areaLabel, type LocalDiscoveryArea, type LocalPresence } from '../model/local'
import { useGeolocation } from '../hooks/useGeolocation'
import { useInbox } from '../hooks/useInbox'
import { DiscoveryAreaEditor } from './DiscoveryAreaEditor'
import { LocationPermissionCard } from './LocationPermissionCard'
import { OfferCard } from './OfferCard'

export function DiscoverySession({ presence, metadata, initialAreas, stopping, onStop }: {
  presence: LocalPresence; metadata: LocationMetadata; initialAreas: LocalDiscoveryArea[]
  stopping: boolean; onStop: () => void
}) {
  const client = useQueryClient()
  const [locationEnabled, setLocationEnabled] = useState(false)
  const [watchAttempt, setWatchAttempt] = useState(0)
  const [areas, setAreas] = useState(initialAreas)
  const [editing, setEditing] = useState(initialAreas.length === 0)
  const location = useGeolocation(presence.id, locationEnabled && !stopping, metadata, presence.locationInterval, watchAttempt)
  const sync = useMutation({
    mutationFn: (desired: LocalDiscoveryArea[]) => replaceDiscoveryAreas(presence.id, desired, metadata),
    onMutate: (desired) => setAreas(desired),
    onSuccess: (_, desired) => { client.setQueryData(['local-areas'], desired); setEditing(desired.length === 0) },
  })
  const started = useRef(false)
  const synchronize = sync.mutate
  useEffect(() => {
    if (!started.current) { started.current = true; if (initialAreas.length > 0) synchronize(initialAreas) }
  }, [initialAreas, synchronize])
  const synchronized = presence.syncedRevision > 0 && presence.syncedRevision === presence.revision && !sync.isPending && !sync.isError
  const active = !stopping && location.status === 'active' && synchronized && areas.length > 0
  const inbox = useInbox(presence, active)
  return <Stack spacing={3}>
    <Box sx={{ py: 2 }}><Typography variant="h3" sx={{ fontSize: { xs: 38, sm: 48 }, mb: 2 }}>
      {active ? 'You’re discoverable.' : 'Leave room for a possibility.'}</Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 530 }}>Define where you’re open to discovery. Kavozi quietly looks for something interesting.</Typography></Box>
    <LocationPermissionCard location={location} onEnable={() => setLocationEnabled(true)} onRetry={() => setWatchAttempt((value) => value + 1)} />
    {sync.isError && <Alert severity="warning" action={<Button onClick={() => sync.mutate(areas)}>Retry</Button>}>
      Your areas have not been synchronized. {errorMessage(sync.error)}</Alert>}
    {editing ? <DiscoveryAreaEditor initialAreas={areas} metadata={metadata} busy={sync.isPending || stopping} onSave={(desired) => sync.mutate(desired)} />
      : <Box sx={{ px: 1 }}><Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="overline">Looking in your areas</Typography><Button disabled={stopping || sync.isPending} onClick={() => setEditing(true)}>Edit areas</Button>
      </Stack><Stack spacing={1}>{areas.map((area) => <Typography key={area.id}>{areaLabel(area)}</Typography>)}</Stack></Box>}
    {active && <Box sx={{ py: 2, textAlign: 'center' }}>
      <Box className="quiet-orbit" aria-hidden="true" />
      <Typography sx={{ mt: 2 }}>Searching quietly in the background…</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Opportunities appear here. There’s nothing to refresh.</Typography>
    </Box>}
    {inbox.isError && <Alert severity="warning">Inbox is temporarily unavailable. It will retry at the normal polling interval.</Alert>}
    {!stopping && (inbox.data?.offers ?? []).map((offer) => <OfferCard key={offer.offerHandle} offer={offer} presence={presence} areas={areas} />)}
    <Button disabled={stopping} onClick={onStop} sx={{ alignSelf: 'center' }}>{stopping ? 'Stopping…' : 'Stop discovery'}</Button>
    <Typography variant="caption" sx={{ textAlign: 'center' }} color="text.secondary">Stopping deletes this anonymous presence. Your discovery preferences stay on this device.</Typography>
    {import.meta.env.DEV && <Box component="details" sx={{ fontSize: 12, color: 'text.secondary', borderTop: '1px solid', borderColor: 'divider', pt: 2 }}>
      <summary>Development diagnostics · this browser only</summary>
      <p>Presence: {presence.id.slice(0, 8)}… · Expires: {presence.expiresAt}</p>
      <p>Location sequence: {presence.acceptedSequence} accepted / {presence.sequence} reserved · Area revision: {presence.syncedRevision} synced / {presence.revision} reserved</p>
      <p>Own accuracy: {location.accuracy ?? '—'} m · Inbox: {active ? inbox.fetchStatus : 'paused'}</p>
      <p>Local area IDs: {areas.map((area) => area.id).join(', ') || 'none'}</p>
      <p>Offer handles: {(inbox.data?.offers ?? []).map((offer) => offer.offerHandle?.slice(0, 8)).join(', ') || 'none'}</p>
      <p>Server timing: presence TTL {metadata.presenceTtlSeconds}s · location freshness {metadata.locationFreshnessSeconds}s · discovery interval {metadata.discoveryIntervalMilliseconds}ms · offer TTL {metadata.offerTtlSeconds}s</p>
    </Box>}
  </Stack>
}
