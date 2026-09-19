import { Button, Card, CardContent, MenuItem, Stack, TextField, Typography } from '@mui/material'
import type { TemplateField } from '../api/intentTemplateClient'
import type { IntentOperator, IntentPredicate } from '../model/Intent'
import { fieldEditorConstraints, operatorLabels } from '../application/fieldSemantics'
import { TemplateFieldEditor } from './TemplateFieldEditor'

export function PredicateEditor({ fields, values, onChange, label }: {
  fields: TemplateField[]; values: IntentPredicate[]; onChange: (values: IntentPredicate[]) => void; label: string
}) {
  return <Stack spacing={2}>
    {values.map((predicate) => {
      const field = fields.find((f) => f.key === predicate.fieldKey)
      const change = (next: IntentPredicate) => onChange(values.map((p) => p.id === predicate.id ? next : p))
      return <Card key={predicate.id}><CardContent><Stack spacing={2}>
        <Typography>{field?.label ?? `${predicate.fieldKey} — no longer available`}</Typography>
        {field && <>
          <TextField select label={`${field.label ?? field.key} comparison`} value={predicate.operator}
            onChange={(event) => change({ ...predicate, operator: event.target.value as IntentOperator })}>
            {!field.operators?.includes(predicate.operator) && <MenuItem value={predicate.operator}>Unavailable comparison</MenuItem>}
            {(field.operators ?? []).map((operator) => <MenuItem key={operator} value={operator}>{operatorLabels[operator]}</MenuItem>)}
          </TextField>
          <TemplateFieldEditor label={`${field.label ?? field.key} target`} constraints={fieldEditorConstraints(field, predicate.operator)} value={predicate.value}
            onChange={(value) => change({ ...predicate, value })} />
        </>}
        <Button onClick={() => onChange(values.filter((p) => p.id !== predicate.id))}>Remove {field?.label ?? predicate.fieldKey} {label.toLowerCase()}</Button>
      </Stack></CardContent></Card>
    })}
    {fields.filter((field) => field.key && field.operators?.length).map((field) => <Button key={field.key} variant="outlined" onClick={() => onChange([...values,
      { id: crypto.randomUUID(), fieldKey: field.key!, operator: field.operators![0] }])}>Add {field.label ?? field.key} {label.toLowerCase()}</Button>)}
  </Stack>
}
