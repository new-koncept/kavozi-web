import { MenuItem, Stack, TextField, Typography } from '@mui/material'
import type { LocationMetadata } from '../../location/application/metadata'
import { AdministrativeAreaSelector } from '../../location/components/AdministrativeAreaSelector'
import { RadiusInput } from '../../location/components/RadiusInput'
import type { IntentGeography } from '../model/Intent'

export function GeographyEditor({ value, onChange, metadata }: {
  value?: IntentGeography; onChange: (value: IntentGeography | undefined) => void; metadata: LocationMetadata
}) {
  return <Stack spacing={2}>
    <TextField select label="Where" value={value?.type ?? ''} onChange={(event) => onChange(event.target.value === 'RADIUS'
      ? { type: 'RADIUS', radiusMeters: NaN } : event.target.value === 'ADMINISTRATIVE_AREA'
        ? { type: 'ADMINISTRATIVE_AREA', administrativeAreaId: '', displayName: '', administrativeAreaType: 'CITY' } : undefined)}>
      <MenuItem value="">Choose a geography</MenuItem>
      {metadata.supportedGeographyTypes.includes('RADIUS') && <MenuItem value="RADIUS">Around me</MenuItem>}
      {metadata.supportedGeographyTypes.includes('ADMINISTRATIVE_AREA') && <MenuItem value="ADMINISTRATIVE_AREA">City or district</MenuItem>}
    </TextField>
    {value?.type === 'RADIUS' && <RadiusInput metadata={metadata} value={value.radiusMeters} onChange={(radiusMeters) => onChange({ type: 'RADIUS', radiusMeters })} />}
    {value?.type === 'ADMINISTRATIVE_AREA' && <>
      {value.displayName && <Typography>{value.displayName}</Typography>}
      <AdministrativeAreaSelector disabled={false} onAdd={onChange} />
    </>}
  </Stack>
}
