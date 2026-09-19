import { TextField } from '@mui/material'
import type { LocationMetadata } from '../application/metadata'
import { formatRadius } from '../model/local'

export function RadiusInput({ value, onChange, metadata, disabled = false }: {
  value: number; onChange: (value: number) => void; metadata: LocationMetadata; disabled?: boolean
}) {
  const valid = Number.isFinite(value) && value >= metadata.minRadiusMeters && value <= metadata.maxRadiusMeters
  return <TextField label="Radius (meters)" type="number" value={Number.isFinite(value) ? value : ''}
    disabled={disabled} onChange={(event) => onChange(event.target.value === '' ? NaN : Number(event.target.value))}
    error={Number.isFinite(value) && !valid}
    helperText={`${formatRadius(metadata.minRadiusMeters)} – ${formatRadius(metadata.maxRadiusMeters)}${valid ? ` · Selected: ${formatRadius(value)}` : ''}`}
    slotProps={{ htmlInput: { min: metadata.minRadiusMeters, max: metadata.maxRadiusMeters, step: 'any' } }} />
}
