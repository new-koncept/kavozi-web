import { useQuery } from '@tanstack/react-query'
import { Alert, Box, Button, Chip, CircularProgress, Container, Stack, Typography } from '@mui/material'
import { errorMessage } from '../api/locationClient'
import { loadMetadata } from '../location/application/metadata'
import { usePresence } from '../location/hooks/usePresence'
import { discoveryAreaRepository } from '../location/persistence/db'
import { DiscoverySession } from '../location/components/DiscoverySession'

export default function App() {
  const presence = usePresence()
  const metadata = useQuery({ queryKey: ['metadata'], queryFn: loadMetadata, staleTime: 300_000 })
  const areas = useQuery({ queryKey: ['local-areas'], queryFn: discoveryAreaRepository.get, staleTime: Infinity })
  const pending = presence.isPending || metadata.isPending || areas.isPending || presence.recovering
  const error = presence.error || metadata.error || areas.error || presence.start.error || presence.stop.error
  return <Container maxWidth="sm" sx={{ py: { xs: 3, sm: 5 }, pb: 8 }}>
    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 5 }}>
      <Typography component="h1" sx={{ fontSize: 25, fontWeight: 600, letterSpacing: '-1px' }}>Kavozi<span style={{ color: '#a2865b' }}>.</span></Typography>
      <Chip label="Quietly, privately" size="small" variant="outlined" />
    </Stack>
    <Stack spacing={3}>
      {presence.notice && <Alert severity="info">{presence.notice}</Alert>}
      {error && <Alert severity="warning" action={<Button onClick={() => {
        if (metadata.isError) void metadata.refetch()
        if (areas.isError) void areas.refetch()
        if (presence.isError) void presence.refetch()
        presence.start.reset(); presence.stop.reset()
      }}>Dismiss / retry</Button>}>{errorMessage(error)}</Alert>}
      {pending ? <Box sx={{ py: 8, textAlign: 'center' }}><CircularProgress size={28} /><Typography sx={{ mt: 2 }}>Preparing your private space…</Typography></Box>
        : presence.data && metadata.data && areas.data
          ? <DiscoverySession key={presence.data.id} presence={presence.data} metadata={metadata.data} initialAreas={areas.data}
            stopping={presence.stop.isPending} onStop={() => presence.stop.mutate()} />
          : presence.data ? <Stack spacing={2}>
            <Typography>Your anonymous presence is ready. Discovery needs the service configuration and your saved areas before it can begin.</Typography>
            <Button disabled={presence.stop.isPending} onClick={() => presence.stop.mutate()}>Stop discovery</Button>
          </Stack>
          : !presence.data && <Box sx={{ py: 5 }}><Typography variant="h3" sx={{ mb: 2 }}>A little space for possibility.</Typography>
            <Typography color="text.secondary" sx={{ mb: 4 }}>No account needed. Start an anonymous presence, choose your discovery areas, and let Kavozi quietly look.</Typography>
            <Button variant="contained" size="large" disabled={presence.start.isPending || !metadata.data} onClick={() => presence.start.mutate()}>
              {presence.start.isPending ? 'Starting…' : 'Start discovery'}</Button></Box>}
    </Stack>
  </Container>
}
