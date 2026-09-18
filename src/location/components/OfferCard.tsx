import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Alert, Button, Card, CardContent, Stack, Typography } from '@mui/material'
import { ApiError, errorMessage, locationClient, type Schema } from '../../api/locationClient'
import { areaLabel, matchedLocalAreas, type LocalDiscoveryArea, type LocalPresence } from '../model/local'

export function OfferCard({ offer, presence, areas }: {
  offer: Schema['OfferResponse']; presence: LocalPresence; areas: LocalDiscoveryArea[]
}) {
  const [decision, setDecision] = useState<'accepted' | 'declined' | null>(null)
  const [expired, setExpired] = useState(() => !offer.expiresAt || Date.parse(offer.expiresAt) <= Date.now())
  useEffect(() => {
    if (!offer.expiresAt) return
    const timer = setTimeout(() => setExpired(true), Math.max(0, Date.parse(offer.expiresAt) - Date.now()))
    return () => clearTimeout(timer)
  }, [offer.expiresAt])
  const action = useMutation({
    mutationFn: async (choice: 'accepted' | 'declined') => {
      if (!offer.offerHandle || !offer.expiresAt || Date.parse(offer.expiresAt) <= Date.now()) throw new ApiError(410)
      const result = choice === 'accepted' ? await locationClient.acceptOffer(presence, offer.offerHandle)
        : await locationClient.declineOffer(presence, offer.offerHandle)
      if (result.status !== 'RECORDED') throw new ApiError(502)
      return choice
    }, onSuccess: setDecision,
  })
  if (decision === 'declined' || expired || !offer.offerHandle || !offer.expiresAt
    || !Number.isFinite(Date.parse(offer.expiresAt))
    || (offer.status !== 'PENDING' && offer.status !== 'ACCEPTED')) return null
  const accepted = decision === 'accepted' || offer.status === 'ACCEPTED'
  const ownAreas = matchedLocalAreas(offer.localDiscoveryAreaIds ?? [], areas)
  return <Card sx={{ borderColor: 'primary.main' }}><CardContent sx={{ p: { xs: 3, sm: 4 } }}><Stack spacing={2}>
    <Typography variant="overline">A quiet possibility</Typography>
    <Typography variant="h4">{accepted ? 'Interest recorded.' : 'Something matched'}</Typography>
    {accepted ? <Typography>Waiting privately for the next step.</Typography> : <>
      <Typography>Someone satisfies your geographic discovery conditions.</Typography>
      {ownAreas.length > 0 && <><Typography variant="body2" color="text.secondary">Matched through your own areas:</Typography>
        <Stack component="ul" spacing={1} sx={{ mt: 0, pl: 3 }}>{ownAreas.map((area) => <Typography component="li" key={area.id}>{areaLabel(area)}</Typography>)}</Stack></>}
      <Typography variant="caption" color="text.secondary">These are your settings. They reveal no one else’s location or distance.</Typography>
      <Stack direction="row" spacing={2}>
        <Button variant="contained" disabled={action.isPending} onClick={() => action.mutate('accepted')}>Continue</Button>
        <Button disabled={action.isPending} onClick={() => action.mutate('declined')}>Pass</Button>
      </Stack>
    </>}
    {action.isError && <Alert severity="warning">{errorMessage(action.error)}</Alert>}
  </Stack></CardContent></Card>
}
