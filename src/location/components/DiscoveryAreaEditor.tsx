import { useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Divider, Stack, TextField, Typography } from '@mui/material'
import type { LocationMetadata } from '../application/metadata'
import { validateAreas } from '../application/discoveryAreaService'
import { areaLabel, formatRadius, type LocalDiscoveryArea } from '../model/local'
import { AdministrativeAreaSelector } from './AdministrativeAreaSelector'

export function DiscoveryAreaEditor({ initialAreas, metadata, busy, onSave }: {
  initialAreas: LocalDiscoveryArea[]; metadata: LocationMetadata; busy: boolean
  onSave: (areas: LocalDiscoveryArea[]) => void
}) {
  const [areas, setAreas] = useState(initialAreas)
  const [radius, setRadius] = useState(Math.min(metadata.maxRadiusMeters, Math.max(metadata.minRadiusMeters, 5000)))
  const full = areas.length >= metadata.maxDiscoveryAreas
  const validRadius = Number.isFinite(radius) && radius >= metadata.minRadiusMeters && radius <= metadata.maxRadiusMeters
  const valid = validateAreas(areas, metadata)
  const add = (area: LocalDiscoveryArea) => setAreas((current) => current.length < metadata.maxDiscoveryAreas ? [...current, area] : current)
  return <Card><CardContent sx={{ p: { xs: 2.5, sm: 4 } }}><Stack spacing={3}>
    <Box><Typography variant="overline" color="text.secondary">Your discovery areas</Typography>
      <Typography variant="h5">Where are you open to discovery?</Typography>
      <Typography color="text.secondary" sx={{ mt: 1 }}>Choose the areas that feel right. Matching happens privately.</Typography></Box>
    {areas.map((area) => <Stack key={area.id} direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
      <Typography>{areaLabel(area)}</Typography>
      <Button disabled={busy} size="small" aria-label={`Remove ${areaLabel(area)}`} onClick={() => setAreas(areas.filter((item) => item.id !== area.id))}>Remove</Button>
    </Stack>)}
    {metadata.supportedAreaTypes.includes('RADIUS') && <Stack spacing={2}>
      <Typography sx={{ fontWeight: 600 }}>Search around me</Typography>
      <TextField label="Radius (meters)" type="number" value={Number.isNaN(radius) ? '' : radius}
        disabled={busy || full} onChange={(event) => setRadius(event.target.value === '' ? NaN : Number(event.target.value))}
        error={!validRadius} helperText={`${formatRadius(metadata.minRadiusMeters)} – ${formatRadius(metadata.maxRadiusMeters)}${validRadius ? ` · Selected: ${formatRadius(radius)}` : ''}`}
        slotProps={{ htmlInput: { min: metadata.minRadiusMeters, max: metadata.maxRadiusMeters, step: 'any' } }} />
      <Button variant="outlined" disabled={busy || full || !validRadius} onClick={() => add({ id: crypto.randomUUID(), kind: 'radius', meters: radius })}>Add radius area</Button>
    </Stack>}
    {metadata.supportedAreaTypes.includes('ADMINISTRATIVE_AREA') && <><Divider /><AdministrativeAreaSelector disabled={busy || full} onAdd={add} /></>}
    {full && <Typography variant="body2" color="text.secondary">You have reached the limit of {metadata.maxDiscoveryAreas} areas.</Typography>}
    {!valid && <Alert severity="warning">Update your areas to match the current service limits.</Alert>}
    <Button variant="contained" size="large" disabled={busy || !valid} onClick={() => onSave(areas)}>{busy ? 'Saving your areas…' : 'Save discovery areas'}</Button>
    <Typography variant="caption" color="text.secondary">Saving replaces your complete discovery configuration. Save an empty list to clear it.</Typography>
  </Stack></CardContent></Card>
}
