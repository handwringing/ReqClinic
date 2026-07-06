import { setup, assign } from 'xstate';

// ===== 快速问诊状态机类型 =====

export type QuickSourceKind = 'sample' | 'custom';
export type QuickTopicChangeAction = 'append' | 'new_session' | 'defer';
export type QuickReviewAction = 'accept' | 'modify' | 'return' | 'uncertain';

export interface QuickUnknownsCount {
  blocking: number;
  nonBlocking: number;
}

export interface QuickContext {
  sessionId: string | null;
  sourceKind: QuickSourceKind;
  sourceCaseId: string | null;
  originalInput: string;
  currentStep: number;
  understandingVersion: number;
  briefVersion: number;
  unknownsCount: QuickUnknownsCount;
  topicChangeAction: QuickTopicChangeAction | null;
}

export type QuickEvent =
  | {
      type: 'START_CLARIFYING';
      sessionId: string;
      sourceKind: QuickSourceKind;
      sourceCaseId?: string | null;
      originalInput: string;
    }
  | {
      type: 'COMPLETE_CLARIFYING';
      understandingVersion: number;
      unknownsCount: QuickUnknownsCount;
    }
  | { type: 'REVIEW_UNDERSTANDING'; action: QuickReviewAction }
  | { type: 'SELECT_OPTION'; optionId: string; briefVersion: number }
  | { type: 'UPGRADE' }
  | { type: 'ARCHIVE' }
  | { type: 'ABANDON' }
  | { type: 'TOPIC_CHANGE'; action: QuickTopicChangeAction };

export const initialQuickContext: QuickContext = {
  sessionId: null,
  sourceKind: 'custom',
  sourceCaseId: null,
  originalInput: '',
  currentStep: 1,
  understandingVersion: 0,
  briefVersion: 0,
  unknownsCount: { blocking: 0, nonBlocking: 0 },
  topicChangeAction: null,
};

// ===== 快速问诊状态机 =====
// 流程：draft → clarifying → understanding_review → option_review → brief_ready → (upgraded | archived)
// 任意非终态均可通过 ABANDON 进入 abandoned。
export const quickMachine = setup({
  types: {} as { context: QuickContext; events: QuickEvent },
}).createMachine({
  id: 'quick',
  initial: 'draft',
  context: initialQuickContext,
  states: {
    draft: {
      on: {
        START_CLARIFYING: {
          target: 'clarifying',
          actions: assign({
            sessionId: ({ event }) => event.sessionId,
            sourceKind: ({ event }) => event.sourceKind,
            sourceCaseId: ({ event }) => event.sourceCaseId ?? null,
            originalInput: ({ event }) => event.originalInput,
            currentStep: 2,
          }),
        },
        ABANDON: 'abandoned',
      },
    },
    clarifying: {
      on: {
        COMPLETE_CLARIFYING: {
          target: 'understanding_review',
          actions: assign({
            understandingVersion: ({ event }) => event.understandingVersion,
            unknownsCount: ({ event }) => event.unknownsCount,
            currentStep: 3,
          }),
        },
        TOPIC_CHANGE: {
          target: 'clarifying',
          actions: assign({
            topicChangeAction: ({ event }) => event.action,
          }),
        },
        ABANDON: 'abandoned',
      },
    },
    understanding_review: {
      on: {
        REVIEW_UNDERSTANDING: [
          {
            target: 'option_review',
            guard: ({ event }) =>
              event.action === 'accept' || event.action === 'modify',
            actions: assign({ currentStep: 4 }),
          },
          {
            target: 'clarifying',
            guard: ({ event }) => event.action === 'return',
            actions: assign({ currentStep: 2 }),
          },
          {
            target: 'brief_ready',
            guard: ({ event }) => event.action === 'uncertain',
            actions: assign({ currentStep: 5 }),
          },
        ],
        ABANDON: 'abandoned',
      },
    },
    option_review: {
      on: {
        SELECT_OPTION: {
          target: 'brief_ready',
          actions: assign({
            briefVersion: ({ event }) => event.briefVersion,
            currentStep: 5,
          }),
        },
        ABANDON: 'abandoned',
      },
    },
    brief_ready: {
      on: {
        UPGRADE: 'upgraded',
        ARCHIVE: 'archived',
        ABANDON: 'abandoned',
      },
    },
    upgraded: { type: 'final' },
    archived: { type: 'final' },
    abandoned: { type: 'final' },
  },
});
