import * as fs from 'node:fs';
import * as path from 'node:path';
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

export function loadPublicKey(): string {
  // Priority 1: JWT_PUBLIC_KEY env var (PEM string) — CI and prod (no file dependency)
  if (process.env.JWT_PUBLIC_KEY) return process.env.JWT_PUBLIC_KEY;
  // Priority 2: JWT_PUBLIC_KEY_PATH env var or default file path — dev
  const envPath = process.env.JWT_PUBLIC_KEY_PATH;
  if (envPath && fs.existsSync(envPath)) return fs.readFileSync(envPath, 'utf8');
  const localPath = path.resolve(process.cwd(), '../../secrets/jwt_public.pem');
  return fs.readFileSync(localPath, 'utf8');
}

export function loadPrivateKey(): string {
  // Priority 1: JWT_PRIVATE_KEY env var (PEM string) — CI and prod (no file dependency)
  if (process.env.JWT_PRIVATE_KEY) return process.env.JWT_PRIVATE_KEY;
  // Priority 2: JWT_PRIVATE_KEY_PATH env var or default file path — dev
  const envPath = process.env.JWT_PRIVATE_KEY_PATH;
  if (envPath && fs.existsSync(envPath)) return fs.readFileSync(envPath, 'utf8');
  const localPath = path.resolve(process.cwd(), '../../secrets/jwt_private.pem');
  return fs.readFileSync(localPath, 'utf8');
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
