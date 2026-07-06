import { eq, desc, max } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import {
  formalMapSnapshots,
  formalTurns,
  type FormalMapSnapshot,
  type FormalTurn,
} from '../db/schema/formal';
import { generateId } from '../shared/id';
import { now } from '../shared/time';

export type FormalMapSnapshotStatus = 'draft' | 'ready' | 'fallback';
export type FormalMapSourceKind = 'direct' | 'quick_upgrade' | 'conversation_update' | 'fallback';

export interface CreateFormalMapSnapshotInput {
  projectId: string;
  status: FormalMapSnapshotStatus;
  sourceKind: FormalMapSourceKind;
  sourceQuickSessionId?: string | null;
  sourceBriefVersionId?: string | null;
  aiJobId?: string | null;
  snapshot: unknown;
  inputHash: string;
}

export interface CreateFormalTurnInput {
  projectId: string;
  role: 'ai' | 'user';
  content: string;
  messageType: 'question' | 'answer' | 'status';
  boundRefs?: unknown[];
}

export class FormalMapRepo {
  constructor(private db: DrizzleDB) {}

  createSnapshot(input: CreateFormalMapSnapshotInput): FormalMapSnapshot {
    const last = this.db
      .select({ m: max(formalMapSnapshots.version) })
      .from(formalMapSnapshots)
      .where(eq(formalMapSnapshots.projectId, input.projectId))
      .get();
    const version = (last?.m ?? 0) + 1;
    return this.db
      .insert(formalMapSnapshots)
      .values({
        id: generateId('fms'),
        projectId: input.projectId,
        version,
        status: input.status,
        sourceKind: input.sourceKind,
        sourceQuickSessionId: input.sourceQuickSessionId ?? null,
        sourceBriefVersionId: input.sourceBriefVersionId ?? null,
        aiJobId: input.aiJobId ?? null,
        snapshotJson: JSON.stringify(input.snapshot ?? {}),
        inputHash: input.inputHash,
        createdAt: now(),
      })
      .returning()
      .get();
  }

  findLatestSnapshot(projectId: string): FormalMapSnapshot | null {
    const row = this.db
      .select()
      .from(formalMapSnapshots)
      .where(eq(formalMapSnapshots.projectId, projectId))
      .orderBy(desc(formalMapSnapshots.version))
      .limit(1)
      .get();
    return row ?? null;
  }

  listTurns(projectId: string, limit = 200): FormalTurn[] {
    return this.db
      .select()
      .from(formalTurns)
      .where(eq(formalTurns.projectId, projectId))
      .orderBy(formalTurns.turnIndex)
      .limit(limit)
      .all();
  }

  createTurn(input: CreateFormalTurnInput): FormalTurn {
    const last = this.db
      .select({ m: max(formalTurns.turnIndex) })
      .from(formalTurns)
      .where(eq(formalTurns.projectId, input.projectId))
      .get();
    const turnIndex = (last?.m ?? -1) + 1;
    return this.db
      .insert(formalTurns)
      .values({
        id: generateId('ftr'),
        projectId: input.projectId,
        turnIndex,
        role: input.role,
        content: input.content,
        messageType: input.messageType,
        boundRefsJson: JSON.stringify(input.boundRefs ?? []),
        createdAt: now(),
      })
      .returning()
      .get();
  }

  appendAiTurnOnce(projectId: string, content: string, messageType: 'question' | 'status' = 'question'): FormalTurn | null {
    const latest = this.db
      .select()
      .from(formalTurns)
      .where(eq(formalTurns.projectId, projectId))
      .orderBy(desc(formalTurns.turnIndex))
      .limit(1)
      .get();
    if (latest?.role === 'ai' && latest.content === content) return null;
    return this.createTurn({
      projectId,
      role: 'ai',
      content,
      messageType,
    });
  }
}

export function parseFormalSnapshot(row: FormalMapSnapshot | null): unknown | null {
  if (!row) return null;
  try {
    return JSON.parse(row.snapshotJson);
  } catch {
    return null;
  }
}

export function parseFormalTurnRefs(row: FormalTurn): unknown[] {
  try {
    const parsed = JSON.parse(row.boundRefsJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
