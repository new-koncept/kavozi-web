import { NodeIdentityPanel } from '../identity/components/NodeIdentityPanel'
import { ProjectionError } from '../intent/application/intentDiscoveryProjection'
import { useState } from 'react'
import { useIsMutating, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, Chip, Container, Stack, Typography } from '@mui/material'
import { ApiError, errorMessage } from '../api/locationClient'
import { loadMetadata } from '../location/application/metadata'
import { usePresence } from '../location/hooks/usePresence'
import { DiscoverySession } from '../location/components/DiscoverySession'
import { useCurrentTemplates, useIntents } from '../intent/hooks/useIntents'
import { IntentsPage } from '../intent/pages/IntentsPage'
import { intentService, IntentError } from '../intent/application/intentService'
import { useNodeIdentity } from '../encounter/hooks/useEncounters'
import { EncountersPage } from '../encounter/components/EncountersPage'

export default function App() {
  const [page, setPage] = useState<'discovery' | 'intents' | 'conversations'>('discovery')
  const [conversation, setConversation] = useState<{ id: string; fingerprint: string }>()
  const identity = useNodeIdentity()
  const client = useQueryClient()
  const presence = usePresence()
  const metadata = useQuery({ queryKey: ['metadata'], queryFn: loadMetadata, staleTime: 120_000, refetchInterval: 120_000 })
  const intents = useIntents()
  const templates = useCurrentTemplates(intents.data)
  const writing = useIsMutating({ mutationKey: ['intent-write'] }) > 0
  const sync = useQuery({
    queryKey: ['intent-discovery', presence.data?.id, intents.data.map((i) => [i.id, i.updatedAt, i.active]), templates.map((t) => t.data), metadata.data],
    queryFn: () => intentService.synchronize(metadata.data!),
    enabled: Boolean(presence.data && metadata.data && !intents.loading && !metadata.isError && !presence.stop.isPending && !writing),
    staleTime: 120_000, refetchInterval: (query) => {
      const error = query.state.error
      if (error instanceof IntentError || error instanceof ProjectionError || (error instanceof ApiError && error.status >= 400 && error.status < 500)) return false
      return presence.data ? 120_000 : false
    },
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
    <Stack component="nav" aria-label="Main navigation" direction="row" spacing={1} sx={{ mb: 3, flexWrap: 'wrap' }}>
      <Button aria-current={page === 'discovery' ? 'page' : undefined} onClick={() => setPage('discovery')}>Discovery</Button>
      <Button aria-current={page === 'intents' ? 'page' : undefined} onClick={() => setPage('intents')}>Your intents</Button>
      <Button aria-current={page === 'conversations' ? 'page' : undefined} onClick={() => { setConversation(undefined); setPage('conversations') }}>Conversations</Button>
    </Stack>
    <Stack spacing={3}>
      {page === 'conversations' && (identity.status === 'READY'
        ? <EncountersPage key={`${identity.fingerprint}:${conversation?.id ?? ''}`} fingerprint={identity.fingerprint}
          initialId={conversation?.fingerprint === identity.fingerprint ? conversation.id : undefined} intents={intents.data} />
        : <Alert severity="info">Conversations need your registered node identity. Check Node identity below.</Alert>)}
      {page === 'intents' && presence.notice && <Alert severity="info">{presence.notice}</Alert>}
      {page === 'intents' && error && <Alert severity="warning" action={<Button onClick={() => {
        if (metadata.isError) void metadata.refetch()
        if (presence.isError) void presence.refetch()
        presence.start.reset(); presence.stop.reset()
      }}>Dismiss / retry</Button>}>{errorMessage(error)}</Alert>}
      {page === 'intents' && <IntentsPage intents={intents.data} metadata={metadata.isError ? undefined : metadata.data} onChanged={onChanged} />}
      <Box sx={{ display: page === 'discovery' ? 'block' : 'none' }}>
        <DiscoverySession presence={presence.data} metadata={metadata.isError ? undefined : metadata.data} intents={intents.data}
          loading={pending || presence.start.isPending} error={Boolean(error)}
          synchronized={sync.isSuccess} syncing={sync.isFetching || writing}
          syncError={sync.isError ? (sync.error instanceof IntentError || sync.error instanceof ProjectionError) ? sync.error.message : errorMessage(sync.error) : undefined}
          onRetry={async () => (await sync.refetch()).isSuccess} stopping={presence.stop.isPending} onStop={() => presence.stop.mutate()}
          onStart={() => presence.start.mutate()} onRecover={() => {
            if (metadata.isError) void metadata.refetch()
            if (presence.isError) void presence.refetch()
            presence.start.reset(); presence.stop.reset()
          }} onManage={() => setPage('intents')} onChanged={onChanged} onEncounter={(id, fingerprint) => { setConversation({ id, fingerprint }); setPage('conversations') }} />
      </Box>
    </Stack>
    <NodeIdentityPanel />
  </Container>
}
