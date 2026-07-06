import { env } from './config/env';
import { createDb } from './db/client';
import { runMigrations } from './db/migrate';
import { buildApp } from './app';
import { createAiProvider } from './ai/provider-factory';
import { AiRunRepo } from './repo/ai-run-repo';
import { JobRepo } from './repo/job-repo';
import { JobWorker } from './queue/worker';
import { generateId } from './shared/id';
import { now } from './shared/time';

async function main(): Promise<void> {
  const appDb = createDb(env.DATABASE_PATH);
  runMigrations(appDb.raw);
  ensureDevelopmentAgreement(appDb.raw);

  const app = await buildApp({ db: appDb });
  const provider = createAiProvider();
  const worker = new JobWorker(
    appDb,
    provider,
    new AiRunRepo(appDb.db),
    new JobRepo(appDb.db),
    {
      pollIntervalMs: env.NODE_ENV === 'development' ? 100 : undefined,
    },
  );
  worker.start();

  const shutdown = async () => {
    worker.stop();
    await app.close();
    appDb.raw.close();
  };
  process.once('SIGINT', () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0));
  });

  await app.listen({ port: env.PORT, host: '0.0.0.0' });

  const addresses = app.addresses();
  const targets = addresses
    .map((a) => `${a.address}:${a.port}`)
    .join(', ');
  app.log.info(`ReqClinic backend listening on ${targets}`);
}

function ensureDevelopmentAgreement(db: ReturnType<typeof createDb>['raw']): void {
  const active = db
    .prepare("SELECT id FROM agreement_versions WHERE status = 'active' LIMIT 1")
    .get();
  if (active) return;
  const ts = now();
  db.prepare(
    `INSERT INTO agreement_versions
      (id, version, status, change_type, effective_at, content_ref, created_at)
     VALUES (?, ?, 'active', 'minor', ?, ?, ?)`,
  ).run(
    generateId('agrv'),
    'dev-1.0.0',
    ts,
    'dev://reqclinic-active-agreement',
    ts,
  );
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
