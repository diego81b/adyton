import { describe, expect, it } from 'vitest'
import { healthPayload } from '../../../server/utils/health'

describe('healthPayload', () => {
  it('returns ok status', () => {
    expect(healthPayload().status).toBe('ok')
  })

  it('returns a round-trippable ISO timestamp', () => {
    const { timestamp } = healthPayload()
    expect(new Date(timestamp).toISOString()).toBe(timestamp)
  })
})
