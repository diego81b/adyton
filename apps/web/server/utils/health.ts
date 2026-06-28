export interface HealthPayload {
  status: 'ok'
  timestamp: string
}

// Pure liveness payload — no event, no IO. Tested directly; the route wraps it.
export function healthPayload(): HealthPayload {
  return { status: 'ok', timestamp: new Date().toISOString() }
}
