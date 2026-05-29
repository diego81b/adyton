## 11. Security Guarantees & Assurance Level

### 11.1 What the System Guarantees (and What It Does Not)

The security of this system rests on a layered model. Each layer has a defined guarantee and a defined residual risk. Understanding the boundary of each guarantee is more useful than a vague claim of "high security."

#### Layer 1: Vault Content Confidentiality (AES-256-GCM)

**Guarantee:** A party with full read access to the database (PostgreSQL dump, backup theft, or database server compromise) cannot recover any vault entry content — passwords, `.env` files, secrets — without the user's master password.

**Why:** AES-256 has a keyspace of 2^256 ≈ 1.16 × 10^77. No known classical computing attack reduces this below approximately 2^128 (best-known theoretical attacks exploit algebraic structure but remain computationally infeasible). The US NSA classifies AES-256 as sufficient for TOP SECRET information. Current estimates suggest a classical computer checking 10^18 keys per second would require ≈ 10^51 years to exhaust the AES-256 keyspace.

The GCM authentication tag (128-bit) provides additional integrity: any modification to the ciphertext (including a single bit flip) causes decryption to throw an exception. The client will detect server-side tampering before rendering any content.

**Residual risk:** This guarantee holds only as long as the derived key remains secret. If the master password is weak or compromised, this guarantee collapses.

#### Layer 2: Key Derivation Hardness (Argon2id)

**Guarantee:** Even if an attacker obtains the `User.passwordHash` (Argon2id hash of the authentication password, stored in DB), offline brute-force is computationally expensive.

**Quantitative analysis at m=65536, t=3, p=1:**

| Attack platform | Throughput | Time to exhaust 10^9 candidates |
|----------------|------------|----------------------------------|
| Modern CPU (single core) | ~0.5 attempts/sec | ~63 years |
| High-end GPU (RTX 4090, 24GB VRAM) | ~370 attempts/sec* | ~86 years |
| 100-GPU cluster | ~37,000 attempts/sec | ~0.86 years |

*GPU throughput is limited by the 64MB RAM requirement per Argon2id instance. A 24GB VRAM GPU can run at most 370 parallel instances (24,576 MB / 64 MB = 384, minus overhead).

**Important qualifier:** This analysis applies to the authentication password hash. It does not directly apply to cracking the vault encryption key, because that key is derived from the master password using Argon2id client-side and never transmitted. An attacker cracking the `passwordHash` from the DB gets authentication access (ability to log in), not vault decryption access — unless the user chose the same string for both authentication password and master password (which is the expected and acceptable use case for a single-user system).

With a master password of 12 truly random characters from a 70-character set (uppercase, lowercase, digits, symbols): 70^12 ≈ 1.38 × 10^22 combinations. At 37,000 attempts/second on the 100-GPU cluster above: 1.38 × 10^22 / 37,000 ≈ 3.7 × 10^17 seconds ≈ 11.8 billion years. The master password is effectively the only thing protecting the vault.

**Residual risk:** A dictionary word, common phrase, or password reused from another breach is crackable in minutes regardless of Argon2id parameters. The user's password hygiene is the binding constraint.

#### Layer 3: Transport Security (TLS + HSTS)

**Guarantee:** Network interception of traffic between client and server is computationally infeasible when TLS 1.2/1.3 is in use with a valid certificate and HSTS is established in the browser.

**Residual risk (first visit):** Before the browser has stored the HSTS directive from a prior visit, an attacker on the same network (e.g. public Wi-Fi) can intercept the first HTTP request and redirect to a fake HTTP site (SSL stripping). After the first successful HTTPS visit, HSTS prevents this. Submitting to the HSTS preload list eliminates this first-visit window.

#### Layer 4: Session Security (JWT + httpOnly Cookie)

**Guarantee:** An XSS payload that runs arbitrary JavaScript in the browser cannot steal the refresh token (httpOnly cookie, inaccessible to JS) or the derived encryption key (`CryptoKey` with `extractable: false`, opaque to JS).

**Residual risk:** An XSS payload that runs during an active vault session could trigger API calls (read all vault entries) on behalf of the authenticated user. The ciphertext returned would be decrypted by the browser using the in-memory key — the attacker's XSS code could intercept the decrypted plaintext before it reaches the DOM. This is why the CSP policy blocking inline scripts and restricting `script-src` to `'self'` is a critical, non-negotiable control.

#### Layer 5: Two-Factor Authentication

**Guarantee (WebAuthn):** A phishing site at any domain other than the registered `rpId` cannot obtain a valid WebAuthn assertion. This property is enforced by the authenticator hardware or platform — it is cryptographic, not behavioral. An attacker cannot relay a WebAuthn assertion in real time.

**Guarantee (TOTP):** A correctly entered TOTP code proves the user has the TOTP secret. TOTP does **not** provide phishing resistance — see Section 11.2 for AiTM attacks.

### 11.2 Standards Alignment

| Standard | Assessment |
|----------|------------|
| OWASP ASVS Level 2 | Targeted and achievable with this architecture. Level 2 is appropriate for applications handling sensitive personal data. |
| OWASP Top 10 (2021) | A01 (Access Control): scoped by JWT userId. A02 (Crypto Failures): AES-256-GCM + Argon2id. A03 (Injection): MikroORM parameterized queries. A05 (Misconfiguration): Helmet + CSP. A07 (Auth Failures): rate limiting + 2FA. A09 (Logging Failures): AuditLog entity. |
| NIST SP 800-63B | Authentication Assurance Level 2 (AAL2) with 2FA enabled. AAL3 (hardware key required) with WebAuthn + hardware authenticator. |
| NIST SP 800-175B | AES-256-GCM: approved algorithm. Argon2id: recommended KDF for password hashing (2022 NIST update). RS256: approved for JWT signing. |
| GDPR / DSGVO | Encrypted at rest (Art. 25, 32). Audit logs with IP/agent (Art. 30 Records of Processing). Hard account deletion (Art. 17). |

### 11.3 What the System Explicitly Does NOT Guarantee

- **Endpoint security:** If the user's device has malware or a keylogger, the master password is captured before Argon2id. No server-side control can compensate for a compromised client.
- **Physical VPS security:** If the host provider has physical access to the VPS RAM, a DRAM cold-boot attack could extract the derived key during an active session. This is a theoretical risk for most hosting environments.
- **Post-quantum resistance:** AES-256 is considered resistant to Grover's algorithm (providing ~128 bits of security against a quantum adversary). RSA-4096 (used for JWT signing) is vulnerable to Shor's algorithm. A cryptographically relevant quantum computer does not exist today, but migration to CRYSTALS-Dilithium (post-quantum signature) for JWT signing should be planned on a 5–10 year horizon.
- **Browser extension security:** The extension has elevated permissions by design. A compromised browser (malicious extensions, compromised browser binary) can undermine all client-side security properties.

---

