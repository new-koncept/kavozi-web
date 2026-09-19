import { useState } from 'react'
import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import type { LocationMetadata } from '../application/metadata'
import type { LocalPresence } from '../model/local'
import { useGeolocation } from '../hooks/useGeolocation'
import { useInbox } from '../hooks/useInbox'
import { LocationPermissionCard } from './LocationPermissionCard'
import { OfferCard } from './OfferCard'
import type { Intent } from '../../intent/model/Intent'
import { IntentCard } from '../../intent/components/IntentCard'

export function DiscoverySession({ presence, metadata, intents, synchronized, syncError, syncing, onRetry, stopping, onStop, onManage, onChanged }: {
  presence: LocalPresence; metadata: LocationMetadata; intents: Intent[]; synchronized: boolean
  syncError?: string; syncing: boolean; onRetry: () => void; stopping: boolean; onStop: () => void
  onManage: () => void; onChanged: () => void
}) {
  const [locationEnabled, setLocationEnabled] = useState(false)
  const [watchAttempt, setWatchAttempt] = useState(0)
  const location = useGeolocation(presence.id, locationEnabled && !stopping, metadata, presence.locationInterval, watchAttempt)
  const active = !stopping && location.status === 'active' && synchronized && intents.some((intent) => intent.active)
  const inbox = useInbox(presence, active)
  return <Stack spacing={3}>
    <Box sx={{ py: 2 }}><Typography variant="h3" sx={{ fontSize: { xs: 38, sm: 48 }, mb: 2 }}>
      {active ? 'You’re discoverable.' : 'What are you open to?'}</Typography>
      <Typography color="text.secondary">Choose your active intents. Kavozi quietly looks for geographic possibilities.</Typography></Box>
    <LocationPermissionCard location={location} onEnable={() => setLocationEnabled(true)} onRetry={() => setWatchAttempt((value) => value + 1)} />
    {syncError && <Alert severity="warning" action={<Button onClick={onRetry}>Retry sync</Button>}>{syncError} Changes may not yet be reflected by the service.</Alert>}
    {syncing && <Typography variant="body2">Synchronizing discovery…</Typography>}
    {intents.length === 0 && <Typography>Start with an intent to tell Kavozi what you’re open to.</Typography>}
    {intents.map((intent) => <IntentCard key={intent.id} intent={intent} metadata={metadata} discovery onChanged={onChanged} />)}
    <Button variant="outlined" onClick={onManage}>Manage intents</Button>
    {active && <Box sx={{ py: 2, textAlign: 'center' }}><Box className="quiet-orbit" aria-hidden="true" />
      <Typography sx={{ mt: 2 }}>Searching quietly in the background…</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Discovery currently checks geography. Other intent details stay on this device.</Typography>
    </Box>}
    {inbox.isError && <Alert severity="warning">Inbox is temporarily unavailable. It will retry at the normal polling interval.</Alert>}
    {!stopping && (inbox.data?.offers ?? []).map((offer) => <OfferCard key={offer.offerHandle} offer={offer} presence={presence} intents={intents} />)}
    <Button disabled={stopping} onClick={onStop} sx={{ alignSelf: 'center' }}>{stopping ? 'Stopping…' : 'Stop discovery'}</Button>
    <Typography variant="caption" sx={{ textAlign: 'center' }} color="text.secondary">Stopping deletes this anonymous presence. Your intents stay on this device.</Typography>
    {import.meta.env.DEV && <Box component="details" sx={{ fontSize: 12, color: 'text.secondary', borderTop: '1px solid', borderColor: 'divider', pt: 2 }}>
      <summary>Development diagnostics · this browser only</summary>
      <p>Presence: {presence.id.slice(0, 8)}… · Expires: {presence.expiresAt}</p>
      <p>Location sequence: {presence.acceptedSequence} accepted / {presence.sequence} reserved</p>
      <p>Own accuracy: {location.accuracy ?? '—'} m · Inbox: {active ? inbox.fetchStatus : 'paused'}</p>
      <p>Active local area IDs: {intents.filter((intent) => intent.active).map((intent) => intent.discoveryAreaId).join(', ') || 'none'}</p>
      <p>Structured matching projection: local only</p>
      <p>Offer handles: {(inbox.data?.offers ?? []).map((offer) => offer.offerHandle?.slice(0, 8)).join(', ') || 'none'}</p>
    </Box>}
  </Stack>
}
