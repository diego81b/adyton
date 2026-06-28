import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';

export default defineConfig({
  clientUrl: process.env.DATABASE_URL ?? 'postgres://adyton:devpassword@localhost:5432/adyton',
  entities: ['./dist/src/**/*.entity.js'],
  entitiesTs: ['./src/**/*.entity.ts'],
  extensions: [Migrator],
  migrations: {
    path: './dist/src/migrations',
    pathTs: './src/migrations',
    glob: '!(*.d).{js,ts}',
    transactional: true,
    emit: 'ts',
    snapshot: true,
  },
  debug: process.env.NODE_ENV !== 'production',
});
