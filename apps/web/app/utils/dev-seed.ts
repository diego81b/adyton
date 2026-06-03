// DEV-ONLY sample data. Used by a button on /vault that is gated behind
// `import.meta.dev`, so this never reaches production. Lets you exercise the list,
// filters, search, cards, and copy before the Step 2 create modal exists. Each draft
// goes through the real useVaultStore().createEntry (full encrypt -> POST -> decrypt).
import { VaultEntryType } from '@adyton/shared';
import type { EntryDraft } from './vault-crypto';

export const SAMPLE_DRAFTS: EntryDraft[] = [
  {
    type: VaultEntryType.LOGIN,
    label: 'GitHub',
    username: 'alice@example.com',
    password: 'gh_pat_demo_8f2a1c',
    url: 'https://github.com',
    notes: 'Work account',
  },
  {
    type: VaultEntryType.LOGIN,
    label: 'AWS Console',
    username: 'admin@company.com',
    password: 'aws-demo-pw-2026',
    url: 'https://console.aws.amazon.com',
  },
  {
    type: VaultEntryType.ENV_FILE,
    label: 'api-service PROD',
    environment: 'production',
    envContent:
      'DATABASE_URL=postgres://user:pass@db:5432/app\n' +
      'REDIS_URL=redis://:secret@redis:6379\n' +
      'JWT_SECRET=demo-jwt-secret\n' +
      '# comment line\n' +
      'STRIPE_KEY="sk_live_demo"\n' +
      'SENDGRID_API_KEY=SG.demo',
  },
  {
    type: VaultEntryType.ENV_FILE,
    label: 'api-service STAGING',
    environment: 'staging',
    envContent: 'DATABASE_URL=postgres://stg\nFEATURE_FLAG=true',
  },
  {
    type: VaultEntryType.SECRET,
    label: 'STRIPE_SECRET_KEY',
    secretKey: 'STRIPE_SECRET_KEY',
    secretValue: 'sk_live_51HdemoXYZ0123456789',
    secretDescription: 'Live payments key',
    environment: 'production',
  },
  {
    type: VaultEntryType.SECRET,
    label: 'NTFY_TOKEN',
    secretKey: 'NTFY_TOKEN',
    secretValue: 'tk_demo_dev_token',
    environment: 'development',
  },
  {
    type: VaultEntryType.SECURE_NOTE,
    label: 'Server SSH Keys',
    notes: '-----BEGIN OPENSSH PRIVATE KEY-----\ndemo\n-----END OPENSSH PRIVATE KEY-----',
  },
  {
    type: VaultEntryType.CREDIT_CARD,
    label: 'Personal Visa',
    cardNumber: '4111111111114242',
    cardExpiry: '08/28',
    cardCvv: '123',
    cardholderName: 'Mario Rossi',
  },
  {
    type: VaultEntryType.IDENTITY,
    label: 'Mario Rossi',
    firstName: 'Mario',
    lastName: 'Rossi',
    email: 'mario.rossi@example.com',
    phone: '+39 333 1234567',
  },
];
