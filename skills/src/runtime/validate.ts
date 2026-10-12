// Minimal JSON-schema subset check for stage replies: root object, required
// fields, and the primitive types a stage schema uses. Pure; returns one
// problem string per violation, empty when the value conforms.

type SchemaLike = {
  properties?: Record<string, { type?: string }>
  required?: readonly string[]
}

function typeMatches(type: string, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    default:
      // Types this checker does not know are not enforced.
      return true
  }
}

export function validateAgainstSchema(schema: object, value: unknown): string[] {
  if (!typeMatches('object', value)) return ['value: expected object']
  const { properties = {}, required = [] } = schema as SchemaLike
  const record = value as Record<string, unknown>
  const problems: string[] = []
  for (const field of required) {
    if (record[field] === undefined) problems.push(`${field}: missing`)
  }
  for (const [field, spec] of Object.entries(properties)) {
    const present = record[field]
    if (present === undefined || spec.type === undefined) continue
    if (!typeMatches(spec.type, present)) problems.push(`${field}: expected ${spec.type}`)
  }
  return problems
}
