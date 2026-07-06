import Database from 'better-sqlite3';

type Mode = 'quick' | 'formal' | 'training' | 'unknown';

interface Args {
  databasePath: string;
  mode?: Exclude<Mode, 'unknown'>;
  jobId?: string;
  limit: number;
}

interface SkillRow {
  job_id: string;
  scope_kind: string;
  task_type: string;
  job_status: string;
  agent_mode: Mode | null;
  plan_id: string | null;
  skill_id: string | null;
  skill_version: string | null;
  category: string | null;
  skill_status: string | null;
  provider: string | null;
  model: string | null;
  thinking_mode: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  usage_estimated: number | null;
  error_code: string | null;
}

interface AiRow {
  job_id: string;
  provider: string | null;
  model: string | null;
  thinking_mode: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  status: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    databasePath: process.env.DATABASE_PATH ?? './data/reqclinic.db',
    limit: 50,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--db' && next) {
      args.databasePath = next;
      i += 1;
    } else if (arg === '--mode' && next) {
      if (next === 'quick' || next === 'formal' || next === 'training') {
        args.mode = next;
      } else {
        throw new Error('--mode must be quick, formal, or training.');
      }
      i += 1;
    } else if (arg === '--job' && next) {
      args.jobId = next;
      i += 1;
    } else if (arg === '--limit' && next) {
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('--limit must be a positive number.');
      }
      args.limit = Math.floor(parsed);
      i += 1;
    }
  }

  return args;
}

function modeFromRow(row: Pick<SkillRow, 'agent_mode' | 'scope_kind'>): Mode {
  if (row.agent_mode === 'quick' || row.agent_mode === 'formal' || row.agent_mode === 'training') {
    return row.agent_mode;
  }
  if (row.scope_kind === 'quick_session') return 'quick';
  if (row.scope_kind === 'formal_project') return 'formal';
  if (row.scope_kind === 'training_attempt') return 'training';
  return 'unknown';
}

function tokenTotal(input: number | null, output: number | null): number {
  return (input ?? 0) + (output ?? 0);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = new Database(args.databasePath, { readonly: true, fileMustExist: false });

  const where: string[] = [];
  const params: Record<string, string | number> = { limit: args.limit };
  if (args.jobId) {
    where.push('j.id = @jobId');
    params.jobId = args.jobId;
  }
  if (args.mode) {
    where.push(`(
      ar.mode = @mode
      OR (@mode = 'quick' AND j.scope_kind = 'quick_session')
      OR (@mode = 'formal' AND j.scope_kind = 'formal_project')
      OR (@mode = 'training' AND j.scope_kind = 'training_attempt')
    )`);
    params.mode = args.mode;
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const skillRows = db.prepare(`
    SELECT
      j.id AS job_id,
      j.scope_kind,
      j.task_type,
      j.status AS job_status,
      ar.mode AS agent_mode,
      ar.plan_id,
      sr.skill_id,
      sr.skill_version,
      sr.category,
      sr.status AS skill_status,
      sr.provider,
      sr.model,
      sr.thinking_mode,
      sr.input_tokens,
      sr.output_tokens,
      sr.usage_estimated,
      sr.error_code
    FROM ai_jobs j
    LEFT JOIN agent_runs ar ON ar.ai_job_id = j.id
    LEFT JOIN skill_runs sr ON sr.agent_run_id = ar.id
    ${whereSql}
    ORDER BY j.created_at DESC, ar.started_at ASC, sr.step_index ASC
    LIMIT @limit
  `).all(params) as SkillRow[];

  const jobIds = [...new Set(skillRows.map((row) => row.job_id))];
  const aiRows: AiRow[] = jobIds.length > 0
    ? db.prepare(`
      SELECT
        ai_job_id AS job_id,
        provider,
        model,
        thinking_mode,
        input_tokens,
        output_tokens,
        status
      FROM ai_runs
      WHERE ai_job_id IN (${jobIds.map((_, index) => `@job${index}`).join(', ')})
    `).all(Object.fromEntries(jobIds.map((jobId, index) => [`job${index}`, jobId]))) as AiRow[]
    : [];

  const byMode = new Map<Mode, {
    jobs: Set<string>;
    skills: number;
    inputTokens: number;
    outputTokens: number;
    estimatedSkillRuns: number;
    failedSkillRuns: number;
    schemaGateFailures: number;
    fallbackHints: number;
  }>();

  for (const row of skillRows) {
    const mode = modeFromRow(row);
    const current = byMode.get(mode) ?? {
      jobs: new Set<string>(),
      skills: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedSkillRuns: 0,
      failedSkillRuns: 0,
      schemaGateFailures: 0,
      fallbackHints: 0,
    };
    current.jobs.add(row.job_id);
    if (row.skill_id) current.skills += 1;
    current.inputTokens += row.input_tokens ?? 0;
    current.outputTokens += row.output_tokens ?? 0;
    if (row.usage_estimated) current.estimatedSkillRuns += 1;
    if (row.skill_status === 'failed') current.failedSkillRuns += 1;
    if (/schema/i.test(row.error_code ?? '')) current.schemaGateFailures += 1;
    if (/fallback|回退/i.test(row.error_code ?? '')) current.fallbackHints += 1;
    byMode.set(mode, current);
  }

  const aiTotals = aiRows.reduce(
    (acc, row) => {
      acc.inputTokens += row.input_tokens ?? 0;
      acc.outputTokens += row.output_tokens ?? 0;
      acc.runs += 1;
      if (row.status === 'failed') acc.failedRuns += 1;
      return acc;
    },
    { runs: 0, failedRuns: 0, inputTokens: 0, outputTokens: 0 },
  );

  const report = {
    generated_at: new Date().toISOString(),
    filters: {
      mode: args.mode ?? null,
      job_id: args.jobId ?? null,
      limit: args.limit,
    },
    totals: {
      jobs: jobIds.length,
      skill_runs: skillRows.filter((row) => row.skill_id).length,
      ai_runs: aiTotals.runs,
      input_tokens: aiTotals.inputTokens,
      output_tokens: aiTotals.outputTokens,
      total_tokens: tokenTotal(aiTotals.inputTokens, aiTotals.outputTokens),
      failed_ai_runs: aiTotals.failedRuns,
    },
    by_mode: Object.fromEntries(
      [...byMode.entries()].map(([mode, value]) => [
        mode,
        {
          jobs: value.jobs.size,
          skill_runs: value.skills,
          input_tokens: value.inputTokens,
          output_tokens: value.outputTokens,
          total_tokens: tokenTotal(value.inputTokens, value.outputTokens),
          estimated_skill_runs: value.estimatedSkillRuns,
          failed_skill_runs: value.failedSkillRuns,
          schema_gate_failures: value.schemaGateFailures,
          fallback_hints: value.fallbackHints,
        },
      ]),
    ),
    skill_runs: skillRows.map((row) => ({
      job_id: row.job_id,
      mode: modeFromRow(row),
      task_type: row.task_type,
      plan_id: row.plan_id,
      skill_id: row.skill_id,
      skill_version: row.skill_version,
      category: row.category,
      status: row.skill_status,
      provider: row.provider,
      model: row.model,
      thinking_mode: row.thinking_mode,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      total_tokens: tokenTotal(row.input_tokens, row.output_tokens),
      usage_estimated: Boolean(row.usage_estimated),
      error_code: row.error_code,
    })),
  };

  console.log(JSON.stringify(report, null, 2));
  db.close();
}

main();
