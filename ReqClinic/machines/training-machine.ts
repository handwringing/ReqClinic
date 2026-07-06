import { setup, assign } from 'xstate';

// ===== 表达训练状态机类型 =====

export interface TrainingContext {
  attemptId: string | null;
  caseId: string | null;
  questionCount: number;
  hasFeedback: boolean;
  previousAttempts: number;
}

export type TrainingEvent =
  | { type: 'SELECT_CASE'; caseId: string }
  | { type: 'START_ATTEMPT'; attemptId: string }
  | { type: 'ASK_QUESTION' }
  | { type: 'SUBMIT_SUMMARY' }
  | { type: 'FEEDBACK_READY' }
  | { type: 'RETRY' }
  | { type: 'COMPLETE' };

export const initialTrainingContext: TrainingContext = {
  attemptId: null,
  caseId: null,
  questionCount: 0,
  hasFeedback: false,
  previousAttempts: 0,
};

// ===== 表达训练状态机 =====
// 流程：not_started → case_selected → interviewing → summarizing → feedback_ready → (completed | interviewing)
// RETRY 直接回到 interviewing，并累加 previousAttempts。
export const trainingMachine = setup({
  types: {} as { context: TrainingContext; events: TrainingEvent },
}).createMachine({
  id: 'training',
  initial: 'not_started',
  context: initialTrainingContext,
  states: {
    not_started: {
      on: {
        SELECT_CASE: {
          target: 'case_selected',
          actions: assign({
            caseId: ({ event }) => event.caseId,
          }),
        },
      },
    },
    case_selected: {
      on: {
        START_ATTEMPT: {
          target: 'interviewing',
          actions: assign({
            attemptId: ({ event }) => event.attemptId,
            questionCount: 0,
            hasFeedback: false,
          }),
        },
      },
    },
    interviewing: {
      on: {
        ASK_QUESTION: {
          actions: assign({
            questionCount: ({ context }) => context.questionCount + 1,
          }),
        },
        SUBMIT_SUMMARY: 'summarizing',
      },
    },
    summarizing: {
      on: {
        FEEDBACK_READY: {
          target: 'feedback_ready',
          actions: assign({ hasFeedback: true }),
        },
      },
    },
    feedback_ready: {
      on: {
        RETRY: {
          target: 'interviewing',
          actions: assign({
            previousAttempts: ({ context }) => context.previousAttempts + 1,
            questionCount: 0,
            hasFeedback: false,
          }),
        },
        COMPLETE: 'completed',
      },
    },
    completed: { type: 'final' },
  },
});
