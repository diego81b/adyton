import { FastifyReply } from 'fastify';

// Cookie path must include the global prefix (setGlobalPrefix('api')): the refresh
// and logout routes live at /api/auth/*, so a '/auth' path would never be sent.
export const REFRESH_COOKIE_PATH = '/api/auth';

export function setRefreshCookie(res: FastifyReply, token: string): void {
  res.setCookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: (process.env.COOKIE_SAMESITE ?? 'lax') as 'lax' | 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: 7 * 24 * 60 * 60,
  });
}

export function clearRefreshCookie(res: FastifyReply): void {
  res.setCookie('refreshToken', '', { httpOnly: true, path: REFRESH_COOKIE_PATH, maxAge: 0 });
}
