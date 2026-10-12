export const meta = { name: 'fixture-go' }

phase('fixture start')
log('fixture running')

const free = await agent('free prompt', { label: 'free-form', model: 'fast' })
const checked = await agent('checked prompt', {
  label: 'checked',
  model: 'fast',
  schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
})

const raw = await shell(args.script, { cwd: args.cwd, timeoutMs: 5000 })
const rows = JSON.parse(raw.stdout)
const sh = { exit_code: rows[0].exit_code, stdout: rows[0].stdout }

const par = await parallel([
  () => agent('par prompt', { label: 'par-ok' }),
  () => {
    throw new Error('fixture-rejected-thunk')
  },
])

const child = await workflow({ name: 'fixture-child' }, { n: 2 })

return { free, checked, shell: sh, parallel: par, child }
