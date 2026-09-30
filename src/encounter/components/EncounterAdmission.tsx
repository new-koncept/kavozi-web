import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Stack, Typography } from '@mui/material'
import type { LocalPresence } from '../../location/model/local'
import { createEncounterClient, EncounterError, encounterErrorMessage, retryDelay } from '../api/encounterClient'
import { validateEncounter } from '../application/events'
import { useNodeIdentity } from '../hooks/useEncounters'

export function EncounterAdmission({ presence, offerHandle, expiresAt, onOpen }: {
  presence: LocalPresence; offerHandle: string; expiresAt: string; onOpen: (id: string, fingerprint: string) => void
}) {
  const identity = useNodeIdentity()
  if (identity.status !== 'READY') return <Alert severity="info">A registered node identity is needed to open a conversation. Check Node identity below.</Alert>
  return <Admission key={identity.fingerprint} fingerprint={identity.fingerprint} presence={presence} offerHandle={offerHandle} expiresAt={expiresAt} onOpen={onOpen} />
}
function Admission({ fingerprint, presence, offerHandle, expiresAt, onOpen }: {
  fingerprint: string; presence: LocalPresence; offerHandle: string; expiresAt: string; onOpen: (id: string, fingerprint: string) => void
}) {
  const client = useQueryClient()
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ id?: string; waiting?: boolean; error?: string; busy?: boolean }>({ busy: true })
  const { id, token } = presence
  useEffect(() => {
    const api = createEncounterClient(fingerprint), abort = new AbortController()
    let timer: ReturnType<typeof setTimeout>, tries = 0
    const claim = async () => {
      setState({ busy: true, waiting: true })
      try {
        const room = validateEncounter(await api.claim({ id, token }, offerHandle, abort.signal))
        if (abort.signal.aborted) return
        setState({ id: room.encounterId })
        void client.invalidateQueries({ queryKey: ['encounters', fingerprint] })
      } catch (error) {
        if (abort.signal.aborted) return
        const waiting = error instanceof EncounterError && error.code === 'MATCH_NOT_READY'
        const delay = retryDelay(error, tries++, 3000)
        if ((waiting || error instanceof EncounterError && error.transient) && tries < 10 && Date.now() + delay < Date.parse(expiresAt)) {
          setState({ waiting, busy: true, error: waiting ? undefined : encounterErrorMessage(error) })
          timer = setTimeout(() => void claim(), delay)
        } else setState({ waiting, error: waiting ? 'The encounter is not available yet. You can check again while this offer is valid.' : encounterErrorMessage(error) })
      }
    }
    void claim()
    return () => { abort.abort(); clearTimeout(timer); api.dispose() }
  }, [fingerprint, id, token, offerHandle, expiresAt, attempt, client])
  return <Stack spacing={1}>
    {state.id ? <Button variant="contained" onClick={() => onOpen(state.id!, fingerprint)}>Open conversation</Button>
      : <Typography role="status">{state.waiting ? 'Waiting for the encounter to become available.' : 'Opening conversation…'}</Typography>}
    {state.error && <Alert severity="info">{state.error}</Alert>}
    {!state.id && !state.busy && <Button onClick={() => setAttempt((value) => value + 1)}>Check conversation again</Button>}
  </Stack>
}
