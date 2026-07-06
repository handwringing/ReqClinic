import { setup, assign } from 'xstate';

// ===== 正式分析状态机类型 =====

export type FormalGate = 'outcome' | 'evidence_conflict' | 'scope';
export type FormalGateStatus = 'pending' | 'passed' | 'failed';

export interface FormalGateStatuses {
  outcome: FormalGateStatus;
  evidence_conflict: FormalGateStatus;
  scope: FormalGateStatus;
}

export interface FormalContext {
  projectId: string | null;
  currentStage: number;
  currentGate: FormalGate | null;
  gateStatuses: FormalGateStatuses;
  baselineVersion: number;
  reportVersion: number;
  evidenceCount: number;
  conflictCount: number;
}

export type FormalEvent =
  | { type: 'START_INGESTING'; projectId: string }
  | { type: 'COMPLETE_INGESTING'; evidenceCount: number; conflictCount?: number }
  | { type: 'COMPLETE_ELICITING' }
  | { type: 'PASS_GATE'; gate: FormalGate }
  | { type: 'FAIL_GATE'; gate: FormalGate; reason?: string }
  | { type: 'CREATE_BASELINE' }
  | { type: 'APPROVE_BASELINE'; baselineVersion: number }
  | { type: 'COMPILE_REPORT'; reportVersion: number }
  | { type: 'RELEASE_REPORT' }
  | { type: 'START_CHANGE' }
  | { type: 'CONFIRM_CHANGE' }
  | { type: 'ARCHIVE' };

export const initialFormalContext: FormalContext = {
  projectId: null,
  currentStage: 1,
  currentGate: null,
  gateStatuses: {
    outcome: 'pending',
    evidence_conflict: 'pending',
    scope: 'pending',
  },
  baselineVersion: 0,
  reportVersion: 0,
  evidenceCount: 0,
  conflictCount: 0,
};

function resetGateStatuses(): FormalGateStatuses {
  return {
    outcome: 'pending',
    evidence_conflict: 'pending',
    scope: 'pending',
  };
}

// ===== 正式分析状态机 =====
// 七阶段：draft → ingesting → eliciting → reviewing(三关口) → baselined → reporting → released → changing → archived
// 三关口：outcome → evidence_conflict → scope，全部 PASS 后进入 baselined。
// 任意非终态均可通过 ARCHIVE 进入 archived。
export const formalMachine = setup({
  types: {} as { context: FormalContext; events: FormalEvent },
}).createMachine({
  id: 'formal',
  initial: 'draft',
  context: initialFormalContext,
  states: {
    draft: {
      on: {
        START_INGESTING: {
          target: 'ingesting',
          actions: assign({
            projectId: ({ event }) => event.projectId,
            currentStage: 2,
          }),
        },
        ARCHIVE: 'archived',
      },
    },
    ingesting: {
      on: {
        COMPLETE_INGESTING: {
          target: 'eliciting',
          actions: assign({
            evidenceCount: ({ event }) => event.evidenceCount,
            conflictCount: ({ event }) => event.conflictCount ?? 0,
            currentStage: 3,
          }),
        },
        ARCHIVE: 'archived',
      },
    },
    eliciting: {
      on: {
        COMPLETE_ELICITING: {
          target: 'reviewing',
          actions: assign({
            currentStage: 4,
            currentGate: 'outcome',
            gateStatuses: resetGateStatuses,
          }),
        },
        ARCHIVE: 'archived',
      },
    },
    reviewing: {
      initial: 'outcome',
      states: {
        outcome: {
          on: {
            PASS_GATE: {
              target: 'evidence_conflict',
              guard: ({ event }) => event.gate === 'outcome',
              actions: assign({
                gateStatuses: ({ context }) => ({
                  ...context.gateStatuses,
                  outcome: 'passed',
                }),
                currentGate: 'evidence_conflict',
              }),
            },
            FAIL_GATE: {
              guard: ({ event }) => event.gate === 'outcome',
              actions: assign({
                gateStatuses: ({ context }) => ({
                  ...context.gateStatuses,
                  outcome: 'failed',
                }),
              }),
            },
          },
        },
        evidence_conflict: {
          on: {
            PASS_GATE: {
              target: 'scope',
              guard: ({ event }) => event.gate === 'evidence_conflict',
              actions: assign({
                gateStatuses: ({ context }) => ({
                  ...context.gateStatuses,
                  evidence_conflict: 'passed',
                }),
                currentGate: 'scope',
              }),
            },
            FAIL_GATE: {
              guard: ({ event }) => event.gate === 'evidence_conflict',
              actions: assign({
                gateStatuses: ({ context }) => ({
                  ...context.gateStatuses,
                  evidence_conflict: 'failed',
                }),
              }),
            },
          },
        },
        scope: {
          on: {
            PASS_GATE: {
              target: '#formal.baselined',
              guard: ({ event }) => event.gate === 'scope',
              actions: assign({
                gateStatuses: ({ context }) => ({
                  ...context.gateStatuses,
                  scope: 'passed',
                }),
                currentGate: null,
                currentStage: 5,
              }),
            },
            FAIL_GATE: {
              guard: ({ event }) => event.gate === 'scope',
              actions: assign({
                gateStatuses: ({ context }) => ({
                  ...context.gateStatuses,
                  scope: 'failed',
                }),
              }),
            },
          },
        },
      },
      on: {
        ARCHIVE: 'archived',
      },
    },
    baselined: {
      on: {
        CREATE_BASELINE: {
          actions: assign({
            baselineVersion: ({ context }) => context.baselineVersion + 1,
          }),
        },
        APPROVE_BASELINE: {
          target: 'reporting',
          actions: assign({
            baselineVersion: ({ event }) => event.baselineVersion,
            currentStage: 6,
          }),
        },
        ARCHIVE: 'archived',
      },
    },
    reporting: {
      on: {
        COMPILE_REPORT: {
          actions: assign({
            reportVersion: ({ event }) => event.reportVersion,
          }),
        },
        RELEASE_REPORT: {
          target: 'released',
          actions: assign({ currentStage: 7 }),
        },
        ARCHIVE: 'archived',
      },
    },
    released: {
      on: {
        START_CHANGE: 'changing',
        ARCHIVE: 'archived',
      },
    },
    changing: {
      on: {
        CONFIRM_CHANGE: {
          target: 'reviewing',
          actions: assign({
            currentStage: 4,
            currentGate: 'outcome',
            gateStatuses: resetGateStatuses,
          }),
        },
        ARCHIVE: 'archived',
      },
    },
    archived: { type: 'final' },
  },
});
