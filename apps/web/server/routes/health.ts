import { defineEventHandler } from 'h3'
import { healthPayload } from '../utils/health'

// Lightweight liveness probe for Docker/Traefik healthchecks.
// No auth, no DB, no API call — just confirms the Nitro server is serving.
export default defineEventHandler(() => healthPayload())
