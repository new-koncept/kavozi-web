import { discoveryReview } from '../application/intentDiscoveryProjection'
import { Box, CircularProgress, List, ListItem, Stack, Switch, Typography } from '@mui/material'
import type { Intent } from '../model/Intent'
import type { LocationMetadata } from '../../location/application/metadata'
import { useIntentTemplate } from '../hooks/useIntents'

type Props = { intents: Intent[]; metadata?: LocationMetadata; disabled: boolean; pendingId?: string; onToggle: (id: string, active: boolean) => void }
function IntentRow({ intent, metadata, disabled, pendingId, onToggle }: Omit<Props, 'intents'> & { intent: Intent }) {
  const template = useIntentTemplate(intent.templateKey)
  const valid = metadata && template.data && !template.isError && !discoveryReview(intent, template.data, metadata)
  return <ListItem divider sx={{ px: 0, py: 1.5, gap: 2, justifyContent: 'space-between' }}>
    <Typography sx={{ overflowWrap: 'anywhere', minWidth: 0 }}>{intent.title}</Typography>
    <Stack direction="row" sx={{ alignItems: 'center', flexShrink: 0 }}>
      {pendingId === intent.id && <CircularProgress size={16} aria-label={`Saving ${intent.title}`} sx={{ mr: 1 }} />}
      <Typography variant="caption" aria-hidden="true" sx={{ width: 24 }}>{intent.active ? 'ON' : 'OFF'}</Typography>
      <Switch checked={intent.active} disabled={disabled || Boolean(intent.pendingDeletion) || (!intent.active && (!valid || template.isFetching))}
        slotProps={{ input: { 'aria-label': `Turn ${intent.title} ${intent.active ? 'off' : 'on'}` } }}
        onChange={(_, active) => onToggle(intent.id, active)} />
    </Stack>
  </ListItem>
}
export function IntentToggleList(props: Props) {
  return <Box><Typography component="h2" variant="h5" sx={{ mb: 1 }}>Your intents</Typography>
    {!props.intents.length && <Typography color="text.secondary">Create an intent to tell Kavozi what you’re open to.</Typography>}
    <List disablePadding aria-label="Your intents">{props.intents.map((intent) => <IntentRow key={intent.id} {...props} intent={intent} />)}</List>
  </Box>
}
