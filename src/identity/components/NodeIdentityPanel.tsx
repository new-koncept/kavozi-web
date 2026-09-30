import { useEffect, useState, useSyncExternalStore } from 'react'
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, Typography } from '@mui/material'
import { nodeIdentityManager, type NodeIdentityManager } from '../application/NodeIdentityManager'

export function NodeIdentityPanel({ manager = nodeIdentityManager }: { manager?: NodeIdentityManager }) {
  const state = useSyncExternalStore(manager.subscribe, manager.getSnapshot)
  const [confirm, setConfirm] = useState(false)
  const [understood, setUnderstood] = useState(false)
  useEffect(() => { void manager.initialize() }, [manager])
  const ready = state.status === 'READY'
  const replacement = ready ? state.replacement : undefined
  const busy = state.status === 'INITIALIZING' || state.status === 'REGISTERING' || replacement?.status === 'REGISTERING'
  const reason = 'reason' in state ? state.reason : replacement?.reason
  const labels = { INITIALIZING: 'Initializing', REGISTERING: 'Registering', READY: 'Ready', UNSUPPORTED: 'Unsupported', ERROR: 'Error', REGISTRATION_RECOVERY_REQUIRED: 'Registration recovery required' }
  return <Box component="section" aria-label="Node identity" sx={{ mt: 4, borderTop: '1px solid', borderColor: 'divider', pt: 2 }}>
    <Box component="details" open={reason ? true : undefined}>
      <Box component="summary" sx={{ cursor: 'pointer' }}>Node identity · {labels[state.status]}{ready ? ` · ${state.fingerprint.slice(0, 19)}…` : ''}</Box>
      <Stack spacing={2} sx={{ mt: 2 }}>
        <Typography variant="body2">This browser has its own node identity. It is not yet bound to your Presence; discovery still uses its existing Presence token.</Typography>
        {'fingerprint' in state && <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>Fingerprint: {state.fingerprint}</Typography>}
        {ready && <Typography variant="caption">Created: {new Date(state.createdAt).toLocaleString()} · Registered: {new Date(state.registeredAt).toLocaleString()}</Typography>}
        {replacement?.status === 'REGISTERING' && <Typography role="status">Registering replacement identity. Your current identity remains usable.</Typography>}
        {reason && <Alert severity={state.status === 'UNSUPPORTED' ? 'warning' : 'error'}>{reason}</Alert>}
        {reason && <Button disabled={busy} onClick={() => void (replacement ? manager.regenerate() : manager.initialize())}>
          {replacement ? 'Retry pending identity replacement' : 'Retry node registration'}</Button>}
        <Button color="warning" variant="outlined" disabled={busy || state.status === 'UNSUPPORTED'} onClick={() => { setUnderstood(false); setConfirm(true) }}>Regenerate node identity…</Button>
      </Stack>
    </Box>
    <Dialog open={confirm} onClose={() => setConfirm(false)}>
      <DialogTitle>Create a completely new node identity?</DialogTitle>
      <DialogContent><Stack spacing={2}>
        <Typography>Successful replacement permanently deletes this browser’s old private key. There is no identity recovery or rotation that preserves your identity.</Typography>
        <Typography>You will lose access to conversations owned by the old identity, and eventually to connections owned only by it. Current Presence and discovery remain unchanged. If registration fails, the current identity is retained and the same pending key can be retried. This action discards any earlier unfinished replacement.</Typography>
        <FormControlLabel control={<Checkbox checked={understood} onChange={(_, checked) => setUnderstood(checked)} />} label="I understand this creates a new identity and cannot be undone after successful replacement." />
      </Stack></DialogContent>
      <DialogActions><Button onClick={() => setConfirm(false)}>Cancel</Button><Button color="warning" disabled={!understood || busy} onClick={() => { setConfirm(false); void manager.regenerate(true) }}>Create new identity</Button></DialogActions>
    </Dialog>
  </Box>
}
