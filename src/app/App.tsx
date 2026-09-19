import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, Chip, CircularProgress, Container, Stack, Typography } from '@mui/material'
import { errorMessage } from '../api/locationClient'
import { loadMetadata } from '../location/application/metadata'
import { usePresence } from '../location/hooks/usePresence'
import { DiscoverySession } from '../location/components/DiscoverySession'
import { useCurrentTemplates, useIntents } from '../intent/hooks/useIntents'
import { IntentsPage } from '../intent/pages/IntentsPage'
import { intentService, IntentError } from '../intent/application/intentService'

export default function App() {
  const [page, setPage] = useState<'discovery' | 'intents'>('discovery')
  const client = useQueryClient()
  const presence = usePresence()
  const metadata = useQuery({ queryKey: ['metadata'], queryFn: loadMetadata, staleTime: 120_000, refetchInterval: 120_000 })
  const intents = useIntents()
  const templates = useCurrentTemplates(intents.data)
  const sync = useQuery({
    queryKey: ['intent-discovery', presence.data?.id, intents.data.map((i) => [i.id, i.updatedAt, i.active]), templates.map((t) => t.dataUpdatedAt), metadata.dataUpdatedAt],
    queryFn: () => intentService.synchronize(metadata.data!),
    enabled: Boolean(presence.data && metadata.data && !intents.loading && !metadata.isError && !presence.stop.isPending),
    staleTime: 120_000, refetchInterval: presence.data ? 120_000 : false,
  })
  const onChanged = () => {
    void client.invalidateQueries({ queryKey: ['intent-discovery'] })
    void client.invalidateQueries({ queryKey: ['intentTemplate'] })
  }
  const pending = presence.isPending || metadata.isPending || intents.loading || presence.recovering
  const error = presence.error || metadata.error || intents.error || presence.start.error || presence.stop.error
  return <Container maxWidth="sm" sx={{ py: { xs: 3, sm: 5 }, pb: 8 }}>
    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
      <Typography component="h1" sx={{ fontSize: 25, fontWeight: 600, letterSpacing: '-1px' }}>Kavozi<span style={{ color: '#a2865b' }}>.</span></Typography>
      <Chip label="Quietly, privately" size="small" variant="outlined" />
    </Stack>
    <Stack component="nav" aria-label="Main navigation" direction="row" spacing={2} sx={{ mb: 3 }}>
      <Button aria-current={page === 'discovery' ? 'page' : undefined} onClick={() => setPage('discovery')}>Discovery</Button>
      <Button aria-current={page === 'intents' ? 'page' : undefined} onClick={() => setPage('intents')}>Your intents</Button>
    </Stack>
    <Stack spacing={3}>
      {presence.notice && <Alert severity="info">{presence.notice}</Alert>}
      {error && <Alert severity="warning" action={<Button onClick={() => {
        if (metadata.isError) void metadata.refetch()
        if (presence.isError) void presence.refetch()
        presence.start.reset(); presence.stop.reset()
      }}>Dismiss / retry</Button>}>{errorMessage(error)}</Alert>}
      {page === 'intents' && <IntentsPage intents={intents.data} metadata={metadata.isError ? undefined : metadata.data} onChanged={onChanged} />}
      <Box sx={{ display: page === 'discovery' ? 'block' : 'none' }}>
        {pending ? <Box sx={{ py: 8, textAlign: 'center' }}><CircularProgress size={28} /><Typography sx={{ mt: 2 }}>Preparing your private space…</Typography></Box>
          : presence.data && metadata.data && !metadata.isError
            ? <DiscoverySession key={presence.data.id} presence={presence.data} metadata={metadata.data} intents={intents.data}
              synchronized={sync.isSuccess} syncing={sync.isFetching}
              syncError={sync.isError ? sync.error instanceof IntentError ? sync.error.message : errorMessage(sync.error) : undefined}
              onRetry={() => void sync.refetch()} stopping={presence.stop.isPending} onStop={() => presence.stop.mutate()}
              onManage={() => setPage('intents')} onChanged={onChanged} />
            : presence.data ? <Stack spacing={2}><Typography>Discovery needs the service configuration before it can begin.</Typography>
              <Button disabled={presence.stop.isPending} onClick={() => presence.stop.mutate()}>Stop discovery</Button></Stack>
              : <Box sx={{ py: 5 }}><Typography variant="h3" sx={{ mb: 2 }}>A little space for possibility.</Typography>
                <Typography color="text.secondary" sx={{ mb: 4 }}>No account needed. Your intents stay on this device.</Typography>
                <Button variant="contained" size="large" disabled={presence.start.isPending || !metadata.data} onClick={() => presence.start.mutate()}>
                  {presence.start.isPending ? 'Starting…' : 'Start discovery'}</Button></Box>}
      </Box>
    </Stack>
  </Container>
}
