import { Alert, Button, Card, CardContent, Stack, Typography } from '@mui/material'
import type { LocationState } from '../hooks/useGeolocation'

const descriptions: Record<LocationState['status'], string> = {
  idle: 'Enable location to begin', acquiring: 'Acquiring your location…', active: 'Location active',
  denied: 'Location permission was denied. Allow location in your browser settings, then try again.',
  unavailable: 'Location is temporarily unavailable. Check your device settings or try again.',
  poor: 'Accuracy is too poor for discovery. Try moving closer to a window or outdoors.',
  stale: 'Waiting for a fresh location. Discovery needs a recent fix.',
  rejected: 'The service could not accept your location.',
}
export function LocationPermissionCard({ location, onEnable, onRetry }: {
  location: LocationState; onEnable: () => void; onRetry: () => void
}) {
  return <Card><CardContent sx={{ p: 3 }}><Stack spacing={2}>
    <Typography sx={{ fontWeight: 600 }}>{descriptions[location.status]}</Typography>
    {location.status === 'idle' && <>
      <Typography color="text.secondary">Kavozi sends your location to the service to check geographic compatibility privately. Your coordinates are never shown to another person.</Typography>
      <Button variant="contained" onClick={onEnable}>Enable location</Button>
    </>}
    {location.accuracy !== undefined && <Typography variant="body2" color="text.secondary">Accuracy ~{Math.round(location.accuracy)} m</Typography>}
    {location.message && <Alert severity="warning">{location.message}</Alert>}
    {['denied', 'unavailable', 'poor', 'stale', 'rejected'].includes(location.status) && <Button onClick={onRetry}>Try location again</Button>}
  </Stack></CardContent></Card>
}
