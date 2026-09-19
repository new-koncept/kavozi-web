import { useState } from 'react'
import { Alert, Button, Card, CardActionArea, CardContent, CircularProgress, Stack, Typography } from '@mui/material'
import type { LocationMetadata } from '../../location/application/metadata'
import { useIntentTemplate, useIntentTemplates } from '../hooks/useIntents'
import { newIntent, type Intent } from '../model/Intent'
import { IntentEditor } from '../components/IntentEditor'
import { IntentCard } from '../components/IntentCard'

function Editing({ initial, metadata, onDone }: { initial: Intent; metadata: LocationMetadata; onDone: () => void }) {
  const template = useIntentTemplate(initial.templateKey)
  if (template.isPending) return <CircularProgress aria-label="Loading template" />
  if (template.isError || !template.data) return <Stack spacing={2}><Alert severity="warning">The current template is unavailable. Your saved intent is unchanged.</Alert>
    <Button onClick={() => void template.refetch()}>Retry template</Button><Button onClick={onDone}>Back to intents</Button></Stack>
  return <IntentEditor initial={initial} template={template.data} metadata={metadata} onDone={onDone} />
}
function TemplatePicker({ onSelect, onCancel }: { onSelect: (key: string) => void; onCancel: () => void }) {
  const templates = useIntentTemplates()
  return <Stack spacing={2}><Typography variant="h4">Choose a starting point</Typography>
    {templates.isPending && <CircularProgress aria-label="Loading templates" />}
    {templates.isError && <Alert severity="warning" action={<Button onClick={() => void templates.refetch()}>Retry</Button>}>The template catalogue is unavailable.</Alert>}
    {!templates.isError && templates.data?.length === 0 && <Typography>No templates are available right now.</Typography>}
    {!templates.isError && templates.data?.filter((template) => template.key && template.name).map((template) => <Card key={template.key}>
      <CardActionArea onClick={() => onSelect(template.key!)}><CardContent><Typography variant="h5">{template.name}</Typography><Typography color="text.secondary">{template.description}</Typography></CardContent></CardActionArea>
    </Card>)}<Button onClick={onCancel}>Cancel</Button>
  </Stack>
}
export function IntentsPage({ intents, metadata, onChanged }: { intents: Intent[]; metadata?: LocationMetadata; onChanged: () => void }) {
  const [picking, setPicking] = useState(false)
  const [editing, setEditing] = useState<Intent>()
  const done = () => { setEditing(undefined); setPicking(false); onChanged() }
  if (editing && metadata) return <Editing key={editing.id} initial={editing} metadata={metadata} onDone={done} />
  if (picking) return <TemplatePicker onSelect={(key) => { setEditing(newIntent(key)); setPicking(false) }} onCancel={done} />
  return <Stack spacing={3}><Typography variant="h3">Your intents</Typography><Typography color="text.secondary">Tell Kavozi what kinds of encounters you’re open to.</Typography>
    {!metadata && <Alert severity="info">Service configuration is unavailable. Your local intents are still here; editing needs the current limits.</Alert>}
    <Button variant="contained" disabled={!metadata} onClick={() => setPicking(true)}>Create intent</Button>
    {intents.map((intent) => <IntentCard key={intent.id} intent={intent} metadata={metadata} onEdit={() => setEditing(intent)} onChanged={onChanged} />)}
  </Stack>
}
