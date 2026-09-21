import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Autocomplete, Box, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { locationClient, type Schema } from '../../api/locationClient'
import type { IntentGeography } from '../../intent/model/Intent'

export function AdministrativeAreaSelector({ onAdd, disabled }: {
  onAdd: (area: Extract<IntentGeography, { type: 'ADMINISTRATIVE_AREA' }>) => void; disabled: boolean
}) {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [type, setType] = useState<'' | 'CITY' | 'DISTRICT'>('')
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), 300)
    return () => clearTimeout(timer)
  }, [input])
  const results = useQuery({
    queryKey: ['administrative-areas', query, type],
    queryFn: ({ signal }) => locationClient.searchAdministrativeAreas(query, type || undefined, signal),
    enabled: query.length > 0 && !disabled, staleTime: 60_000,
  })
  return <Stack spacing={2}>
    <TextField select label="Area type" value={type} disabled={disabled}
      onChange={(event) => setType(event.target.value as typeof type)}>
      <MenuItem value="">Cities and districts</MenuItem><MenuItem value="CITY">City</MenuItem><MenuItem value="DISTRICT">District</MenuItem>
    </TextField>
    <Autocomplete<Schema['AdministrativeAreaResponse']>
      disabled={disabled} value={null} inputValue={input} onInputChange={(_, value) => setInput(value)}
      options={(results.data ?? []).filter((area) => area.id && area.name && area.type)}
      filterOptions={(options) => options} getOptionLabel={(area) => area.name ?? ''}
      isOptionEqualToValue={(option, value) => option.id === value.id} loading={results.isFetching}
      noOptionsText={query ? 'No administrative areas found' : 'Type a city or district name'}
      onChange={(_, area) => {
        if (area?.id && area.name && area.type) {
          onAdd({ type: 'ADMINISTRATIVE_AREA', administrativeAreaId: area.id, displayName: area.name, administrativeAreaType: area.type })
          setInput('')
        }
      }}
      renderOption={(props, area) => {
        const { key, ...rest } = props
        return <Box component="li" key={key} {...rest}><Box><Typography>{area.name}</Typography>
          <Typography variant="caption" color="text.secondary">{area.type === 'CITY' ? 'City' : 'District'}</Typography></Box></Box>
      }}
      renderInput={(params) => <TextField {...params} label="Search a city or district" />}
    />
    {results.isError && <Alert severity="warning">Administrative-area search is unavailable. Please try another search shortly.</Alert>}
  </Stack>
}
