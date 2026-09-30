import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, Stack, TextField, Typography } from '@mui/material'
import { createEncounterClient } from '../api/encounterClient'
import { ConversationSession, type ConversationState } from '../application/ConversationSession'
import { encounterStateLabel, participantLabel, type EncounterEvent } from '../application/events'
import { decodeMessage, utf8Length } from '../application/textProtocol'
import type { Intent } from '../../intent/model/Intent'

export function Conversation({ fingerprint, id, intents, onBack }: { fingerprint: string; id: string; intents: Intent[]; onBack: () => void }) {
  const [state, setState] = useState<ConversationState>({ events: [], loading: true, sending: false, leaving: false, left: false, unavailable: false })
  const [draft, setDraft] = useState({ text: '', version: 0 })
  const [confirm, setConfirm] = useState(false)
  const session = useRef<ConversationSession | null>(null)
  useEffect(() => {
    const service = new ConversationSession(fingerprint, id, createEncounterClient(fingerprint), setState)
    session.current = service
    const resume = () => { if (document.visibilityState !== 'hidden') void service.refresh() }
    document.addEventListener('visibilitychange', resume); window.addEventListener('online', resume)
    void service.start()
    return () => { service.stop(); session.current = null; document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume) }
  }, [fingerprint, id])
  const room = state.room
  const changed = Boolean(draft.text && room && draft.version !== room.membershipVersion)
  const maximum = state.metadata?.maxMessagePayloadBytes ?? 0
  const ownIntents = intents.filter((intent) => room?.mySource?.localDiscoveryProjectionIds?.includes(intent.discoveryProjectionId))
  const available = room?.state === 'OPEN' && !state.unavailable && !state.left && !state.leaving
  const send = async () => {
    if (changed || !draft.text.trim() || !available) return
    if (await session.current?.send(draft.text, draft.version)) setDraft({ text: '', version: room!.membershipVersion })
  }
  return <Stack spacing={2}>
    <Button onClick={onBack} sx={{ alignSelf: 'flex-start' }}>Back to conversations</Button>
    <Typography variant="h4" component="h2">Conversation</Typography>
    {state.loading && <Typography role="status">Loading conversation…</Typography>}
    {room && <>
      <Typography role="status">{state.left ? 'Left conversation' : encounterStateLabel[room.state]} · {room.participants.filter((p) => p.state === 'ACTIVE').length} participants</Typography>
      {ownIntents.length > 0 && <Typography variant="body2">Through your local intents: {ownIntents.map((intent) => intent.title).join(', ')}</Typography>}
      <Box component="details"><summary>Participants in this conversation</summary><List dense aria-label="Participants">
        {room.participants.map((participant) => <ListItem key={participant.participantId}>{participantLabel(room, participant.participantId)}{participant.state === 'LEFT' ? ' · Left' : ''}</ListItem>)}
      </List></Box>
      {room.state === 'WAITING_FOR_MEMBERS' && <Alert severity="info">Waiting for members to claim their places. Messaging opens when the encounter is ready.</Alert>}
      {(room.state === 'CLOSED' || room.state === 'EXPIRED') && <Alert severity="info">This conversation has {room.state === 'CLOSED' ? 'closed' : 'expired'}. New messages cannot be sent.</Alert>}
    </>}
    {state.error && <Alert severity="warning" action={<Button onClick={() => void session.current?.refresh()}>Retry connection</Button>}>{state.error}</Alert>}
    {room && <Stack component="ol" aria-label="Conversation messages and events" spacing={1.5} sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {state.events.map((event) => <EventRow key={event.sequence} event={event} state={state} />)}
    </Stack>}
    {state.pending && <Card><CardContent><Stack spacing={1}>
      <Typography variant="body2">{state.sending ? 'Sending…' : state.pending.status === 'review' ? 'Not sent · Review the changed group' : 'Delivery unconfirmed · Kept on this device'}</Typography>
      <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{decodeMessage(state.pending.body, maximum) ?? 'Unsupported message'}</Typography>
      {state.pending.status === 'pending' ? <Button disabled={state.sending || state.leaving || state.unavailable} onClick={() => void session.current?.retrySend()}>Retry same message</Button>
        : <Button disabled={!available} onClick={async () => {
          const message = await session.current?.takeForReview()
          if (message) setDraft({ text: decodeMessage(message, maximum) ?? '', version: room!.membershipVersion })
        }}>Review text for the current group</Button>}
    </Stack></CardContent></Card>}
    {state.sendError && <Alert severity="warning">{state.sendError}</Alert>}
    {changed && <Alert severity="warning" action={<Button onClick={() => setDraft((value) => ({ ...value, version: room!.membershipVersion }))}>Use current group</Button>}>
      The participant group changed. Review the participant list before choosing to send this draft.
    </Alert>}
    <Box component="form" onSubmit={(event) => { event.preventDefault(); void send() }}><Stack spacing={1}>
      <TextField label="Message" multiline minRows={3} value={draft.text} disabled={!available || state.sending || Boolean(state.pending)}
        onChange={(event) => setDraft((value) => ({ text: event.target.value, version: value.text ? value.version : room?.membershipVersion ?? 0 }))}
        helperText={`${utf8Length(draft.text)} / ${maximum} UTF-8 bytes`} error={Boolean(maximum && utf8Length(draft.text) > maximum)} />
      <Button type="submit" variant="contained" disabled={!available || changed || !draft.text.trim() || utf8Length(draft.text) > maximum || state.sending || Boolean(state.pending)}>Send message</Button>
    </Stack></Box>
    <Typography variant="caption" color="text.secondary">Messages are stored by Kavozi. “Stored” does not mean read. Messages are not end-to-end encrypted.</Typography>
    {room && !state.left && !state.unavailable && <Button color="warning" disabled={state.sending || state.leaving} onClick={() => setConfirm(true)}>Leave conversation</Button>}
    <Dialog open={confirm} onClose={() => setConfirm(false)}><DialogTitle>Leave this conversation?</DialogTitle><DialogContent>
      You will lose access to its messages. Unconfirmed messages may already have been stored. Leaving can close the conversation for remaining members.
    </DialogContent><DialogActions><Button onClick={() => setConfirm(false)}>Cancel</Button><Button color="warning" disabled={state.leaving} onClick={async () => {
      setConfirm(false)
      if (await session.current?.leave()) onBack()
    }}>Confirm leave</Button></DialogActions></Dialog>
  </Stack>
}
function EventRow({ event, state }: { event: EncounterEvent; state: ConversationState }) {
  const room = state.room!
  if (event.type === 'MESSAGE' && 'message' in event) {
    const own = event.message?.senderParticipantId === room.self.participantId
    return <Box component="li" sx={{ alignSelf: own ? 'flex-end' : 'flex-start', maxWidth: '90%', bgcolor: own ? 'primary.main' : 'background.paper', color: own ? 'primary.contrastText' : 'text.primary', p: 2, borderRadius: 3 }}>
      <Typography variant="caption">{participantLabel(room, event.message?.senderParticipantId)} · Stored</Typography>
      <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{decodeMessage(event.message, state.metadata!.maxMessagePayloadBytes) ?? 'Unsupported message'}</Typography>
    </Box>
  }
  const label = event.type === 'PARTICIPANT_JOINED' && 'participant' in event ? `${participantLabel(room, event.participant?.participantId)} joined`
    : event.type === 'PARTICIPANT_LEFT' && 'participantId' in event ? `${participantLabel(room, event.participantId)} left`
    : event.type === 'ENCOUNTER_OPENED' ? 'Conversation opened' : event.type === 'ENCOUNTER_CLOSED' ? 'Conversation closed'
    : event.type === 'ENCOUNTER_EXPIRED' ? 'Conversation expired' : 'Conversation updated'
  return <Typography component="li" variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>{label}</Typography>
}
