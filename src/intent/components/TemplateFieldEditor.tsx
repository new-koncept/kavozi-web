import { useState } from 'react'
import { Alert, Autocomplete, Button, Chip, MenuItem, Stack, TextField } from '@mui/material'
import type { Constraints } from '../api/intentTemplateClient'
import { formatIntentValue, type IntentFieldValue } from '../model/Intent'
import { supportsEditor } from '../application/fieldSemantics'

export function TemplateFieldEditor({ label, constraints: c, value, onChange }: {
  label: string; constraints?: Constraints; value?: IntentFieldValue; onChange: (value: IntentFieldValue | undefined) => void
}) {
  const [item, setItem] = useState('')
  if (!c || !supportsEditor(c)) return <Alert severity="warning">{label}: this field needs additional template metadata before it can be edited.</Alert>
  if (value && (value.type !== c.kind || (c.kind === 'SET' && value.type === 'SET' && value.elementType !== c.elementType))) {
    return <Alert severity="warning" action={<Button onClick={() => onChange(undefined)}>Clear saved value</Button>}>{label}: the template type changed. Saved value: {formatIntentValue(value)}</Alert>
  }
  const clear = <Button size="small" onClick={() => onChange(undefined)} disabled={!value}>Clear {label}</Button>
  const numberProps = c.kind === 'NUMBER' || c.kind === 'RANGE' ? { min: c.min, max: c.max, step: c.step ?? 'any' } : {}
  let input
  switch (c.kind) {
    case 'BOOLEAN': input = <TextField select label={label} value={value?.type === 'BOOLEAN' ? String(value.value) : ''}
      onChange={(event) => onChange(event.target.value === '' ? undefined : { type: 'BOOLEAN', value: event.target.value === 'true' })}>
      <MenuItem value="">Not specified</MenuItem><MenuItem value="true">Yes</MenuItem><MenuItem value="false">No</MenuItem></TextField>; break
    case 'NUMBER': input = <TextField label={label} type="number" value={value?.type === 'NUMBER' && Number.isFinite(value.value) ? value.value : ''}
      helperText={c.unit} slotProps={{ htmlInput: numberProps }} onChange={(e) => onChange(e.target.value === '' ? undefined : { type: 'NUMBER', value: Number(e.target.value) })} />; break
    case 'TEXT': input = <TextField label={label} multiline minRows={2} value={value?.type === 'TEXT' ? value.value : ''}
      helperText={c.maxLength ? `Up to ${c.maxLength} characters` : undefined}
      slotProps={{ htmlInput: { minLength: c.minLength, maxLength: c.maxLength } }}
      onChange={(e) => onChange(e.target.value === '' ? undefined : { type: 'TEXT', value: e.target.value })} />; break
    case 'CODE': {
      const selected = value?.type === 'CODE' ? value.value : ''
      const options = c.options?.filter((option) => option.value !== undefined) ?? []
      input = <TextField select label={label} value={selected} onChange={(e) => onChange(e.target.value ? { type: 'CODE', value: e.target.value } : undefined)}>
        <MenuItem value="">Not specified</MenuItem>
        {selected && !options.some((o) => o.value === selected) && <MenuItem value={selected}>Unavailable: {selected}</MenuItem>}
        {options.map((option) => <MenuItem key={option.value} value={option.value}>{option.label ?? option.value}</MenuItem>)}
      </TextField>; break
    }
    case 'RANGE': input = <Stack direction="row" spacing={2}>
      {(['lower', 'upper'] as const).map((bound) => <TextField key={bound} label={`${label} — ${bound === 'lower' ? 'from' : 'to'}`} type="number"
        value={value?.type === 'RANGE' ? value[bound] ?? '' : ''} helperText={c.unit} slotProps={{ htmlInput: numberProps }}
        onChange={(e) => onChange({ ...(value?.type === 'RANGE' ? value : { type: 'RANGE' }), [bound]: e.target.value === '' ? undefined : Number(e.target.value) })} />)}
    </Stack>; break
    case 'SET': {
      const values = value?.type === 'SET' ? value.values : []
      const set = (values: (string | number | boolean)[]) => onChange({ type: 'SET', elementType: c.elementType!, values })
      if (c.elementType === 'CODE' || c.elementType === 'REFERENCE' || c.elementType === 'BOOLEAN') {
        const options: (string | boolean)[] = c.elementType === 'BOOLEAN' ? [true, false] : (c.options ?? []).flatMap((o) => o.value === undefined ? [] : [o.value])
        input = <Autocomplete multiple options={options} value={values.filter((v): v is string | boolean => typeof v !== 'number')}
          getOptionLabel={(option) => typeof option === 'boolean' ? option ? 'Yes' : 'No' : c.options?.find((o) => o.value === option)?.label ?? `Unavailable: ${option}`}
          onChange={(_, next) => set(next)} renderInput={(params) => <TextField {...params} label={label} helperText={c.maxItems ? `Up to ${c.maxItems} selections` : undefined} />} />
      } else {
        input = <Stack spacing={1}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <TextField fullWidth label={label} type={c.elementType === 'NUMBER' ? 'number' : c.elementType === 'INSTANT' ? 'datetime-local' : 'text'} value={item}
              slotProps={{ inputLabel: c.elementType === 'INSTANT' ? { shrink: true } : undefined }} onChange={(e) => setItem(e.target.value)} />
            <Button disabled={!item.trim() || (c.elementType === 'INSTANT' && !Number.isFinite(Date.parse(item))) || (c.maxItems !== undefined && values.length >= c.maxItems)} onClick={() => {
              const next = c.elementType === 'NUMBER' ? Number(item) : c.elementType === 'INSTANT' ? new Date(item).toISOString() : item.trim()
              if (!values.includes(next)) set([...values, next])
              setItem('')
            }}>Add</Button>
          </Stack>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>{values.map((v, i) => <Chip key={i} label={String(v)} onDelete={() => set(values.filter((_, index) => index !== i))} />)}</Stack>
        </Stack>
      }
      break
    }
  }
  return <Stack spacing={0.5}>{input}<span>{clear}</span></Stack>
}
