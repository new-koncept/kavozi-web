import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Alert, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, Switch, Typography } from '@mui/material'
import { ApiError, errorMessage } from '../../api/locationClient'
import type { LocationMetadata } from '../../location/application/metadata'
import { intentService, IntentError } from '../application/intentService'
import { validateIntent } from '../application/intentValidator'
import { useIntentTemplate } from '../hooks/useIntents'
import type { Intent } from '../model/Intent'
import { geographyLabel } from '../model/Intent'

export function IntentCard({ intent, metadata, discovery = false, onEdit, onChanged }: {
  intent: Intent; metadata?: LocationMetadata; discovery?: boolean; onEdit?: () => void; onChanged: () => void
}) {
  const template = useIntentTemplate(intent.templateKey)
  const [confirm, setConfirm] = useState(false)
  const validation = metadata && template.data && !template.isError ? validateIntent(intent, template.data, metadata) : undefined
  const action = useMutation({
    mutationFn: async (operation: 'on' | 'off' | 'delete') => {
      if (!metadata) throw new IntentError('Service configuration is unavailable. Try again shortly.')
      if (operation === 'delete') await intentService.delete(intent.id, metadata, confirm)
      else await intentService.setActive(intent.id, operation === 'on', metadata)
    },
    onSuccess: () => { setConfirm(false); onChanged() },
    onError: () => { setConfirm(false); onChanged() },
  })
  return <Card><CardContent><Stack spacing={2}>
    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
      <Typography variant="h5" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{intent.title}</Typography>
      <Chip size="small" label={validation?.needsReview || (template.error instanceof ApiError && template.error.status === 404) ? 'Needs review' : intent.active ? 'Active' : 'Inactive'} />
    </Stack>
    <Typography color="text.secondary">{geographyLabel(intent.geography)}</Typography>
    <Typography variant="body2">{intent.requirements.length} requirements · {intent.preferences.length} preferences{intent.agentInstruction ? ' · Agent configured' : ''}</Typography>
    {template.isError && <Alert severity="warning">Current template unavailable. Saved data is preserved; editing and activation need the current definition.</Alert>}
    {validation?.needsReview && <Alert severity="warning">Needs review: {validation.issues.find((issue) => !issue.warning)?.message}</Alert>}
    {validation?.issues.some((issue) => issue.warning) && <Typography variant="caption">Some preferences need review. They do not block activation.</Typography>}
    {intent.pendingDeletion && <Alert severity="warning">Deletion is waiting for discovery synchronization. Retry delete to finish safely.</Alert>}
    {discovery ? <FormControlLabel label={`Activate ${intent.title}`} control={<Switch checked={intent.active}
      disabled={action.isPending || !metadata || Boolean(intent.pendingDeletion) || (!intent.active && (!validation?.valid || template.isFetching))}
      onChange={(_, active) => action.mutate(active ? 'on' : 'off')} />} />
      : <Stack direction="row" spacing={1}><Button onClick={onEdit} disabled={action.isPending || intent.pendingDeletion}>Edit</Button>
        <Button disabled={action.isPending || !metadata} onClick={() => intent.active ? setConfirm(true) : action.mutate('delete')}>{intent.pendingDeletion ? 'Retry delete' : 'Delete'}</Button></Stack>}
    {action.isError && <Alert severity="error">{action.error instanceof IntentError ? action.error.message : errorMessage(action.error)}</Alert>}
    <Dialog open={confirm} onClose={() => { if (!action.isPending) setConfirm(false) }}>
      <DialogTitle>Delete active intent?</DialogTitle><DialogContent>{intent.title} will be deactivated and removed after discovery is synchronized.</DialogContent>
      <DialogActions><Button disabled={action.isPending} onClick={() => setConfirm(false)}>Cancel</Button><Button disabled={action.isPending} onClick={() => action.mutate('delete')}>Deactivate and delete</Button></DialogActions>
    </Dialog>
  </Stack></CardContent></Card>
}
