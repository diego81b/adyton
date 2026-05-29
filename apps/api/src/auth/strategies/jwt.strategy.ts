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
  const envPath = process.env.JWT_PUBLIC_KEY_PATH;
  if (envPath && fs.existsSync(envPath)) return fs.readFileSync(envPath, 'utf8');
  const localPath = path.resolve(process.cwd(), '../../secrets/jwt_public.pem');
  return fs.readFileSync(localPath, 'utf8');
}

export function loadPrivateKey(): string {
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
