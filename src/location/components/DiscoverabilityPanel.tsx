import { Box, Button, Stack, SvgIcon, Typography } from '@mui/material'
import type { LocationState } from '../hooks/useGeolocation'
import type { Discoverability } from '../application/discoverability'

const acquisitionMessages: Partial<Record<LocationState['status'], string>> = {
  acquiring: 'Acquiring a fresh location…',
  unavailable: 'Location refresh failed or timed out. Check your device settings and try again.',
  denied: 'Location permission was denied. Allow location in your browser settings and try again.',
  poor: 'Accuracy is too poor. Try moving closer to a window or outdoors.',
  stale: 'The browser returned an old location. Waiting for a fresh observation.',
  rejected: 'The service could not accept the new location. Try again.',
}
export function DiscoverabilityPanel({ state, onAction, location, onRefresh }: {
  state: Discoverability; onAction: () => void; location: LocationState; onRefresh: () => void
}) {
  const acquisitionMessage = acquisitionMessages[location.status]
  const colors = { success: ['primary.main', 'primary.contrastText'], warning: ['#f4dfa9', '#49360d'], neutral: ['#e5e8e3', 'text.primary'], error: ['error.main', 'error.contrastText'] }
  const labels = { start: 'Start discovery', location: 'Update location', sync: 'Retry synchronization', retry: 'Retry discovery', inbox: 'Retry discovery', manage: 'Manage intents' }
  return <Box role="status" aria-live="polite" sx={{ bgcolor: colors[state.tone][0], color: colors[state.tone][1], borderRadius: 3, p: { xs: 3, sm: 4 } }}>
    <Stack spacing={2}>
      <SvgIcon sx={{ fontSize: 36 }} aria-hidden="true"><path d={state.discoverable ? 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-2 15-5-5 1.4-1.4L10 14.2l7.6-7.6L19 8z' : 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 5h2v6h-2zm0 8h2v2h-2z'} /></SvgIcon>
      <Typography component="h2" sx={{ fontSize: { xs: 27, sm: 34 }, fontWeight: 800, letterSpacing: '-0.7px', lineHeight: 1.15 }}>{state.label}</Typography>
      <Typography>{state.explanation}</Typography>
      {acquisitionMessage && <Typography variant="body2">{acquisitionMessage}</Typography>}
      {acquisitionMessage && state.action !== 'location' && <Button color="inherit" sx={{ alignSelf: 'flex-start' }} onClick={onRefresh}>Update location</Button>}
      {state.action && <Button variant="outlined" color="inherit" sx={{ alignSelf: 'flex-start', borderColor: 'currentColor' }} onClick={onAction}>{labels[state.action]}</Button>}
    </Stack>
  </Box>
}
