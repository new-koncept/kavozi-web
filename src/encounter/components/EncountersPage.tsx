import { useState } from 'react'
import { Alert, Button, List, ListItemButton, ListItemText, Stack, Typography } from '@mui/material'
import type { Intent } from '../../intent/model/Intent'
import { useEncounters } from '../hooks/useEncounters'
import { encounterErrorMessage } from '../api/encounterClient'
import { Conversation } from './Conversation'
import { encounterStateLabel } from '../application/events'

export function EncountersPage({ fingerprint, initialId, intents }: { fingerprint: string; initialId?: string; intents: Intent[] }) {
  const [selected, setSelected] = useState(initialId)
  if (selected) return <Conversation key={selected} fingerprint={fingerprint} id={selected} intents={intents} onBack={() => setSelected(undefined)} />
  return <EncounterList fingerprint={fingerprint} onOpen={setSelected} />
}
function EncounterList({ fingerprint, onOpen }: { fingerprint: string; onOpen: (id: string) => void }) {
  const query = useEncounters(fingerprint)
  return <Stack spacing={2}>
    <Typography component="h2" variant="h4">Conversations</Typography>
    {query.isPending && <Typography role="status">Loading conversations…</Typography>}
    {query.isError && <Alert severity="warning" action={<Button onClick={() => void query.refetch()}>Retry</Button>}>{encounterErrorMessage(query.error)}</Alert>}
    {query.data?.rooms.length === 0 && <Typography>Your conversations will appear here after encounter admission. They remain accessible independently of discovery.</Typography>}
    <List aria-label="Conversations">{query.data?.rooms.map((room, index) => <ListItemButton key={room.encounterId} onClick={() => onOpen(room.encounterId)}>
      <ListItemText primary={`Conversation ${index + 1}`} secondary={`${encounterStateLabel[room.state]} · ${room.participants.filter((p) => p.state === 'ACTIVE').length} participants`} />
    </ListItemButton>)}</List>
  </Stack>
}
