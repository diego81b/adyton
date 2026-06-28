import * as fs from 'node:fs';
import * as path from 'node:path';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  sub: string;
  email: string;
  twoFactorPassed: boolean;
}

export interface JwtUser {
  userId: string;
  email: string;
}

/**
 * Normalize a key string coming from an env var or file into a usable PEM.
 *
 * Coolify/CI env vars routinely mangle multiline PEMs: newlines get collapsed,
 * or the value arrives with literal `\n` escapes. To survive both, the key may
 * be provided as:
 *   - a raw PEM (with real newlines) — read straight from a file
 *   - a PEM with literal `\n` escapes — env var that lost real newlines
 *   - a base64-encoded PEM (mangle-proof single value, e.g. `openssl base64 -A`)
 *
 * Heuristic: if the string already contains `BEGIN`, treat it as PEM and
 * un-escape literal `\n`; otherwise base64-decode it. The result is asserted to
 * be a PEM so a bad value fails loudly here, not as an opaque 500 at sign time.
 */
function normalizePem(raw: string, label: string): string {
  const trimmed = raw.trim();
  const pem = trimmed.includes('BEGIN')
    ? trimmed.replace(/\\n/g, '\n')
    : Buffer.from(trimmed, 'base64').toString('utf8');
  if (!pem.includes('BEGIN')) {
    throw new Error(`${label} is not a valid PEM (neither raw/escaped PEM nor base64-encoded PEM)`);
  }
  return pem;
}

export function loadPublicKey(): string {
  let raw: string;
  // Priority 1: JWT_PUBLIC_KEY env var (PEM or base64-PEM) — CI and prod (no file dependency)
  if (process.env.JWT_PUBLIC_KEY) {
    raw = process.env.JWT_PUBLIC_KEY;
  } else {
    // Priority 2: JWT_PUBLIC_KEY_PATH env var or default file path — dev
    const envPath = process.env.JWT_PUBLIC_KEY_PATH;
    const filePath =
      envPath && fs.existsSync(envPath)
        ? envPath
        : path.resolve(process.cwd(), '../../secrets/dev/jwt_public.pem');
    raw = fs.readFileSync(filePath, 'utf8');
  }
  const pem = normalizePem(raw, 'JWT_PUBLIC_KEY');
  createPublicKey(pem); // fail fast on a malformed key at boot, not at first request
  return pem;
}

export function loadPrivateKey(): string {
  let raw: string;
  // Priority 1: JWT_PRIVATE_KEY env var (PEM or base64-PEM) — CI and prod (no file dependency)
  if (process.env.JWT_PRIVATE_KEY) {
    raw = process.env.JWT_PRIVATE_KEY;
  } else {
    // Priority 2: JWT_PRIVATE_KEY_PATH env var or default file path — dev
    const envPath = process.env.JWT_PRIVATE_KEY_PATH;
    const filePath =
      envPath && fs.existsSync(envPath)
        ? envPath
        : path.resolve(process.cwd(), '../../secrets/dev/jwt_private.pem');
    raw = fs.readFileSync(filePath, 'utf8');
  }
  const pem = normalizePem(raw, 'JWT_PRIVATE_KEY');
  createPrivateKey(pem); // fail fast on a malformed key at boot, not at first request
  return pem;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: loadPublicKey(),
      algorithms: ['RS256'],
    });
  }

  validate(payload: JwtPayload): JwtUser {
    return { userId: payload.sub, email: payload.email };
  }
}
