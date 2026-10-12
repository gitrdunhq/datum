export const meta = { name: 'fixture-child' }

const reply = await agent('child prompt', { label: 'child-step' })
return { reply, got: args }
