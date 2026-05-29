## 4. Backend Architecture (NestJS 10 + Fastify)

### 4.1 NestJS + Fastify Adapter

NestJS ships with Express as its default HTTP platform, but the Fastify adapter is the correct choice for a security-sensitive application that demands both throughput and a disciplined plugin architecture. Fastify benchmarks consistently show 20–35% higher requests-per-second versus Express under identical workloads, primarily because its request/response lifecycle avoids the middleware chain overhead and leverages JSON schema-based serialization through `fast-json-stringify`.

Bootstrap configuration registers four core Fastify plugins before the application starts listening:

```typescript
const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter({ logger: true }),
);

await app.register(fastifyHelmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
      objectSrc: ["'none'"],
    },
  },
});

await app.register(fastifyCors, {
  origin: process.env.ALLOWED_ORIGINS?.split(',') ?? [],
  credentials: true,
});

await app.register(fastifyCookie, {
  secret: process.env.COOKIE_SECRET,
});

await app.register(fastifyRateLimit, {
  max: 100,
  timeWindow: '1 minute',
  redis: redisClient,
});
```

`@fastify/cors` is configured with an explicit allowlist rather than a wildcard, enforcing `credentials: true` to permit the httpOnly refresh token cookie to flow across the frontend origin. `@fastify/rate-limit` is backed by Redis so rate limit state is shared across all application instances.

### 4.2 Module Structure

The application is composed of six top-level feature modules plus one infrastructure provider module.

**AuthModule** is the most complex module in the system. It exposes endpoints for account registration, login, token refresh, logout, and two second-factor flows: TOTP and WebAuthn. Login is a multi-step flow: credentials are validated, then if a second factor is enrolled, the endpoint returns a short-lived challenge token scoped only to the 2FA verification endpoint rather than issuing a full access token. This prevents partial authentication states from being exploited.

**VaultModule** manages the encrypted entry lifecycle. Entries arrive from the client already encrypted; the server stores ciphertext, IV, authentication tag, and a label hash. CRUD operations are scoped strictly to the authenticated user's entries — no cross-user access is architecturally possible because all queries are parameterized by `userId` extracted from the validated JWT.

**UsersModule** exposes profile read and update, the active session list (derived from non-expired `RefreshToken` rows), and account deletion. Deletion is a hard delete that cascades through FK constraints to vault entries, refresh tokens, WebAuthn credentials, and audit logs.

**AuditModule** is not a feature module with its own routes. Instead, it exports `AuditInterceptor`, registered globally, which captures every mutating HTTP request. The interceptor resolves the authenticated `userId`, the target endpoint, the outcome (success or failure), and the client IP address. These are written to the `AuditLog` entity through a separate forked `EntityManager` to avoid contaminating the request's Unit of Work with audit concerns.

**HealthModule** exposes a single `/health` endpoint that performs both a liveness check (process is alive) and a readiness check (PostgreSQL query succeeds, Redis `PING` returns `PONG`).

**CryptoModule** is a pure provider module with no controllers. It exports `CryptoService`, which wraps `argon2` (for server-side password hashing) and `crypto` (Node built-ins for SHA-256 token hashing). The server never touches vault encryption keys — Argon2id here applies only to the authentication password.

### 4.3 Guards and Interceptors

**JwtAuthGuard** extends NestJS's `AuthGuard('jwt')` and uses `@nestjs/passport` with `passport-jwt` configured for RS256 signature verification. The public key is loaded from the environment at startup and cached. On successful verification, the guard extracts `userId` and `email` from the token payload and attaches them to `request.user`. Token expiry is enforced by the JWT library; the guard performs no database lookup on the hot path.

**RefreshGuard** handles the token rotation flow. It reads the `refreshToken` cookie, computes its SHA-256 hash, and queries `RefreshToken` where `tokenHash = hash AND expiresAt > now AND revokedAt IS NULL`. Family-based rotation detection is also implemented here: if a previously rotated token is presented, the entire family is revoked.

**TwoFactorGuard** is applied selectively on endpoints requiring a fully authenticated session. It reads `twoFactorPassed: boolean` from the JWT payload. If the user has TOTP or WebAuthn enabled and the flag is false, the guard rejects the request with 403.

**AuditInterceptor** implements `NestInterceptor` and uses `rxjs` `tap` to observe both the successful response and any thrown exception. Writing audit records in `tap` keeps audit logic decoupled from business logic.

**TransformInterceptor** strips `@Property({ hidden: true })` fields that MikroORM would otherwise serialize, ensuring fields like `passwordHash`, `totpSecretEncrypted`, and `tokenHash` never appear in any API response.

### 4.4 REST API Endpoint Design

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | None | Register new account, return access token + set refresh cookie |
| POST | `/auth/login` | None | Credential validation, return challenge token if 2FA enrolled |
| POST | `/auth/2fa/totp/verify` | Challenge token | Verify TOTP code, issue full access + refresh tokens |
| POST | `/auth/2fa/totp/setup` | JWT | Generate TOTP secret, return QR URI |
| POST | `/auth/2fa/totp/enable` | JWT | Confirm setup with valid code, set `totpEnabled = true` |
| POST | `/auth/2fa/totp/disable` | JWT + 2FA | Disable TOTP, revoke all sessions |
| POST | `/auth/webauthn/register/begin` | JWT | Return WebAuthn registration options (challenge) |
| POST | `/auth/webauthn/register/complete` | JWT | Verify and store credential |
| POST | `/auth/webauthn/authenticate/begin` | None | Return authentication options for a given email |
| POST | `/auth/webauthn/authenticate/complete` | None | Verify assertion, issue tokens |
| POST | `/auth/refresh` | Refresh cookie | Rotate refresh token, issue new access token |
| POST | `/auth/logout` | JWT | Revoke current refresh token |
| POST | `/auth/logout/all` | JWT + 2FA | Revoke all refresh tokens for user |
| GET | `/groups` | JWT | List user's groups (owned + member of) |
| POST | `/groups` | JWT | Create group — client sends `encryptedGroupKey` + `groupKeyIv` (groupKey generated client-side) |
| GET | `/groups/:id` | JWT | Group detail + member list |
| PATCH | `/groups/:id` | JWT + 2FA | Update group name/color/icon |
| DELETE | `/groups/:id` | JWT + 2FA | Delete group and all its secrets |
| GET | `/groups/:id/secrets` | JWT + 2FA | List secrets in group (cursor paginated; filter by `secretType`) |
| POST | `/groups/:id/secrets` | JWT + 2FA | Create secret (PASSWORD or FILE) |
| GET | `/groups/:groupId/secrets/:id` | JWT + 2FA | Get single secret |
| PUT | `/groups/:groupId/secrets/:id` | JWT + 2FA | Full update — increments `version`, snapshots old blob |
| PATCH | `/groups/:groupId/secrets/:id` | JWT + 2FA | Partial update (metadata only, e.g. environment tag) |
| DELETE | `/groups/:groupId/secrets/:id` | JWT + 2FA | Delete secret (cascades to versions) |
| GET | `/groups/:groupId/secrets/:id/versions` | JWT + 2FA | List version metadata (no encrypted content) |
| GET | `/groups/:groupId/secrets/:id/versions/:v` | JWT + 2FA | Get specific encrypted version blob |
| POST | `/groups/:groupId/secrets/:id/restore/:v` | JWT + 2FA | Restore version v (creates new head, history retained) |
| POST | `/groups/:id/rotate-key` | JWT + 2FA (OWNER/ADMIN) | Remove member + atomic re-key: new groupKey, all secrets re-encrypted, remaining memberships updated |
| GET | `/auth/challenge` | None | Issue PoW challenge (optional, when ENABLE_POW=true) |
| GET | `/auth/devices` | JWT | List trusted devices for current user |
| POST | `/auth/devices/register` | JWT | Register current browser as trusted device (consumes one-time token) |
| DELETE | `/auth/devices/:id` | JWT | Revoke specific trusted device |
| DELETE | `/auth/devices` | JWT + 2FA | Revoke all trusted devices (emergency) |
| GET | `/users/me` | JWT | Get profile (email, kdfSalt, 2FA status) |
| PATCH | `/users/me` | JWT + 2FA | Update email or auth password |
| GET | `/users/me/sessions` | JWT | List active refresh token sessions |
| DELETE | `/users/me/sessions/:id` | JWT | Revoke specific session |
| DELETE | `/users/me` | JWT + 2FA | Delete account and all associated data |
| GET | `/health` | None | Liveness + readiness check |

Key request/response shapes:

```typescript
// POST /groups — Request (client generates groupKey, encrypts it with userKey)
{
  "name": "Work",
  "color": "#6366f1",
  "icon": "briefcase",
  "encryptedGroupKey": "base64-aes-gcm-ciphertext",
  "groupKeyIv": "base64-12-bytes"
}

// POST /groups/:id/secrets — Request
// AAD for encryptedData:     `${groupId}:${secretId}` (use server-assigned ID from 201 response; or client-generated UUID)
// AAD for encryptedMetadata: `${groupId}:${secretId}:meta`
{
  "encryptedData": "base64-aes-gcm-ciphertext",   // AES-GCM(groupKey, plaintext, aad=`groupId:secretId`)
  "iv": "base64-12-bytes",
  "authTag": "base64-16-bytes",
  "secretType": "PASSWORD",                        // or "FILE"
  "labelHash": "sha256-hex",
  "encryptedMetadata": "base64-aes-gcm-ciphertext", // AES-GCM(groupKey, metadata, aad=`groupId:secretId:meta`)
  "metadataIv": "base64-12-bytes"                   // null if no metadata
}

// POST /groups/:id/secrets — Response 201
{
  "id": "uuid",
  "secretType": "PASSWORD",
  "labelHash": "sha256-hex",
  "version": 1,
  "metadata": { "domain": "github.com" },
  "createdAt": "2025-01-01T00:00:00.000Z",
  "updatedAt": "2025-01-01T00:00:00.000Z"
}

// GET /groups/:id/secrets?cursor=base64cursor&limit=50&type=PASSWORD — Response 200
{
  "data": [ /* array of secret summaries (no encryptedData) */ ],
  "nextCursor": "base64-encoded-next-cursor | null",
  "hasMore": true
}
```

### 4.5 Validation Pipeline

All incoming data passes through NestJS's `ValidationPipe` registered globally with strict settings:

```typescript
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
  }),
);
```

`whitelist: true` strips any properties not declared in the DTO. `forbidNonWhitelisted: true` rejects requests that include undeclared properties with a 400 — this prevents parameter pollution attacks.

```typescript
export class CreateVaultEntryDto {
  @IsNotEmpty()
  @IsBase64()
  encryptedData: string;

  @IsNotEmpty()
  @IsBase64()
  @MaxLength(24) // 12 bytes base64-encoded
  iv: string;

  @IsNotEmpty()
  @IsBase64()
  @MaxLength(24) // 16 bytes base64-encoded
  authTag: string;

  @IsEnum(EntryType)
  entryType: EntryType;

  @IsNotEmpty()
  @IsBase64()
  @MaxLength(64)
  labelHash: string;
}
```

### 4.6 Error Handling

A global exception filter normalizes all errors into a consistent response envelope:

```typescript
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'object') {
        message = (exceptionResponse as any).message ?? message;
      }
    }

    // In production, never expose exception details for 5xx errors
    if (statusCode >= 500 && process.env.NODE_ENV === 'production') {
      message = 'Internal server error';
    }

    response.status(statusCode).send({ statusCode, message });
  }
}
```

For authentication failures the server returns identical 401 responses for "user not found" and "wrong password" to prevent user enumeration.

---

