import { ProjectionError } from '../application/intentDiscoveryProjection'
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Alert, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material'
import { errorMessage } from '../../api/locationClient'
import type { LocationMetadata } from '../../location/application/metadata'
import type { Template } from '../api/intentTemplateClient'
import { formatIntentValue, type Intent, type IntentFieldValue } from '../model/Intent'
import { fieldEditorConstraints } from '../application/fieldSemantics'
import { IntentError, intentService } from '../application/intentService'
import { validateIntent } from '../application/intentValidator'
import { GeographyEditor } from './GeographyEditor'
import { TemplateFieldEditor } from './TemplateFieldEditor'
import { PredicateEditor } from './PredicateEditor'

export function IntentEditor({ initial, template, metadata, onDone }: {
  initial: Intent; template: Template; metadata: LocationMetadata; onDone: () => void
}) {
  const [intent, setIntent] = useState(initial)
  const [submitted, setSubmitted] = useState(false)
  const validation = validateIntent(intent, template, metadata)
  const fields = template.fields ?? []
  const save = useMutation({ mutationKey: ['intent-write'], mutationFn: () => intentService.save(intent, metadata), onSuccess: onDone })
  const changeValue = (section: 'claims' | 'encounterOptions', key: string, value?: IntentFieldValue) => {
    const values = { ...intent[section] }
    if (value === undefined) delete values[key]; else values[key] = value
    setIntent({ ...intent, [section]: values })
  }
  const valueSection = (role: 'CLAIM' | 'ENCOUNTER_OPTION', section: 'claims' | 'encounterOptions', title: string) => {
    const allowed = fields.filter((field) => field.roles?.includes(role))
    const removed = Object.keys(intent[section]).filter((key) => !allowed.some((field) => field.key === key))
    if (!allowed.length && !removed.length) return null
    return <Card><CardContent><Stack spacing={2}><Typography variant="h5">{title}</Typography>
      {allowed.map((field, index) => <TemplateFieldEditor key={field.key ?? index} label={`${field.label ?? field.key ?? 'Unnamed field'}${field.required ? ' (required)' : ''}`}
        constraints={fieldEditorConstraints(field)} value={intent[section][field.key ?? '']}
        onChange={(value) => { if (field.key) changeValue(section, field.key, value) }} />)}
      {removed.map((key) => <Alert key={key} severity="warning" action={<Button onClick={() => changeValue(section, key)}>Remove saved field</Button>}>
        {key} is no longer available. Saved value: {formatIntentValue(intent[section][key])}</Alert>)}
    </Stack></CardContent></Card>
  }
  const agent = template.agentConfiguration
  const issueLabel = (path: string) => {
    const [section, key] = path.split('.')
    const fieldKey = section === 'requirements' || section === 'preferences'
      ? intent[section].find((predicate) => predicate.id === key)?.fieldKey : key
    return fields.find((field) => field.key === fieldKey)?.label ?? fieldKey
      ?? ({ title: 'Intent title', geography: 'Where', agentInstruction: agent?.label ?? 'Agent instruction', template: 'Template', requirements: 'Must match', preferences: 'Nice to have' }[section] ?? 'Intent')
  }
  return <Stack component="form" spacing={3} onSubmit={(event) => { event.preventDefault(); setSubmitted(true); if (validation.valid) save.mutate() }}>
    <Typography variant="h4">{template.name}</Typography><Typography color="text.secondary">{template.description}</Typography>
    <TextField label="Intent title" value={intent.title} onChange={(e) => setIntent({ ...intent, title: e.target.value })} />
    <Card><CardContent><Stack spacing={2}><Typography variant="h5">Where</Typography>
      <GeographyEditor metadata={metadata} value={intent.geography} onChange={(geography) => setIntent({ ...intent, geography })} />
    </Stack></CardContent></Card>
    {valueSection('CLAIM', 'claims', 'About me')}
    {(fields.some((field) => field.roles?.includes('REQUIREMENT')) || intent.requirements.length > 0) && <Card><CardContent><Stack spacing={2}>
      <Typography variant="h5">Must match</Typography>
      <Typography variant="body2" color="text.secondary">Discovery checks location and hard requirements in both directions before an anonymous offer. Preferences and agent reasoning are not evaluated.</Typography>
      <PredicateEditor fields={fields.filter((field) => field.roles?.includes('REQUIREMENT'))} values={intent.requirements} label="Requirement" onChange={(requirements) => setIntent({ ...intent, requirements })} />
    </Stack></CardContent></Card>}
    {(fields.some((field) => field.roles?.includes('PREFERENCE')) || intent.preferences.length > 0) && <Card><CardContent><Stack spacing={2}>
      <Typography variant="h5">Nice to have</Typography><Typography color="text.secondary">Non-blocking preferences for a future agent to explore. They never prevent activation.</Typography>
      <PredicateEditor fields={fields.filter((field) => field.roles?.includes('PREFERENCE'))} values={intent.preferences} label="Preference" onChange={(preferences) => setIntent({ ...intent, preferences })} />
    </Stack></CardContent></Card>}
    {valueSection('ENCOUNTER_OPTION', 'encounterOptions', "What I'm open to")}
    {agent?.enabled ? <Card><CardContent><Stack spacing={2}>
      <Typography variant="h5">Fine-tune with your agent</Typography><Typography>{agent.prompt}</Typography>
      <TextField multiline minRows={4} label={agent.label ?? 'Agent instruction'} value={intent.agentInstruction ?? ''}
        helperText={agent.maxLength !== undefined ? `${intent.agentInstruction?.length ?? 0} / ${agent.maxLength}` : undefined}
        slotProps={{ htmlInput: { maxLength: agent.maxLength } }} onChange={(event) => setIntent({ ...intent, agentInstruction: event.target.value || undefined })} />
      <Typography variant="caption" color="text.secondary">Private context stored on this device. It is not sent, used as a hard filter, or executed by an AI.</Typography>
    </Stack></CardContent></Card> : intent.agentInstruction && <Alert severity="warning" action={<Button onClick={() => setIntent({ ...intent, agentInstruction: undefined })}>Remove instruction</Button>}>
      The current template no longer supports agent instructions. Saved instruction: {intent.agentInstruction}</Alert>}
    {(submitted || initial.updatedAt !== initial.createdAt) && validation.issues.map((issue, index) => <Alert severity={issue.warning ? 'info' : 'warning'} key={index}>{issueLabel(issue.path)}: {issue.message}</Alert>)}
    {save.isError && <Alert severity="error">{(save.error instanceof IntentError || save.error instanceof ProjectionError) ? save.error.message : errorMessage(save.error)}</Alert>}
    <Stack direction="row" spacing={2}><Button type="submit" variant="contained" disabled={save.isPending}>Save intent</Button><Button onClick={onDone} disabled={save.isPending}>Cancel</Button></Stack>
  </Stack>
}
