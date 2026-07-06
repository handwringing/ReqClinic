import { describe, expect, it } from 'vitest';
import {
  ALL_TRAINING_SKILLS,
  TRAINING_ALLOWED_WRITE_TARGETS,
  TRAINING_COMPOSITION_FEEDBACK_REPORT,
  TRAINING_COACHING_NEXT_HINT,
  TRAINING_FORBIDDEN_WRITE_TARGETS,
  TRAINING_ROLEPLAY_ANSWER,
  TRAINING_ROUTING_CASE_CONTEXT,
  TRAINING_STRUCTURING_COVERAGE_UPDATE,
  TRAINING_VALIDATION_QUESTION_QUALITY,
  isTrainingWriteAllowed,
} from '../../src/agent/skills';
import {
  AGENT_PLANS,
  TRAINING_PRACTICE_PLAN,
  resolveAgentPlan,
} from '../../src/agent/agent-plans';
import { defaultSkillRegistry } from '../../src/agent/skill-registry';
import { SKILL_CATEGORIES } from '../../src/agent/types';
import { StubProvider } from '../../src/ai/stub-provider';

/**
 * Task 1.4 — Training practice AgentPlan + Skill Manifest tests.
 *
 * Verifies that:
 *   1. The 6 training Skill Manifests declare all required fields and are
 *      registered in the default SkillRegistry.
 *   2. `isTrainingWriteAllowed` enforces the training write allow-list
 *      (training tables only; real project / quick / formal tables blocked).
 *   3. `TRAINING_PRACTICE_PLAN` has 6 steps and accepts only the
 *      `training_response` and `training_feedback` task types.
 *   4. `resolveAgentPlan` selects `TRAINING_PRACTICE_PLAN` for the
 *      `training_attempt` scope.
 *   5. `StubProvider` returns deterministic, structurally-valid outputs for
 *      `training_response` and `training_feedback` (§11.1 / §11.2 compliance).
 */
describe('Task 1.4 — training practice plan & skill manifests', () => {
  // ── Skill manifest field completeness ───────────────────────────────────

  describe('training skill manifest fields', () => {
    const SKILLS = [
      ['TRAINING_ROUTING_CASE_CONTEXT', TRAINING_ROUTING_CASE_CONTEXT],
      ['TRAINING_ROLEPLAY_ANSWER', TRAINING_ROLEPLAY_ANSWER],
      ['TRAINING_STRUCTURING_COVERAGE_UPDATE', TRAINING_STRUCTURING_COVERAGE_UPDATE],
      ['TRAINING_VALIDATION_QUESTION_QUALITY', TRAINING_VALIDATION_QUESTION_QUALITY],
      ['TRAINING_COACHING_NEXT_HINT', TRAINING_COACHING_NEXT_HINT],
      ['TRAINING_COMPOSITION_FEEDBACK_REPORT', TRAINING_COMPOSITION_FEEDBACK_REPORT],
    ] as const;

    it.each(SKILLS)('declares all required SkillManifest fields for %s', (_name, manifest) => {
      expect(manifest.skillId).toMatch(/^training\./);
      expect(manifest.skillVersion).toBe('1.0.0');
      expect(SKILL_CATEGORIES).toContain(manifest.category);
      expect(manifest.supportedModes).toEqual(['training']);
      expect(manifest.inputSchemaVersion.length).toBeGreaterThan(0);
      expect(manifest.outputSchemaVersion.length).toBeGreaterThan(0);
      expect(manifest.promptVersion.length).toBeGreaterThan(0);
      expect(Array.isArray(manifest.allowedStateTransitions)).toBe(true);
      expect(Array.isArray(manifest.allowedWrites)).toBe(true);
      expect(Array.isArray(manifest.requiredDomainPacks)).toBe(true);
      expect(Array.isArray(manifest.validators)).toBe(true);
    });

    it('exposes exactly 6 training skills in ALL_TRAINING_SKILLS', () => {
      expect(ALL_TRAINING_SKILLS).toHaveLength(6);
      const ids = ALL_TRAINING_SKILLS.map((s) => s.skillId);
      expect(ids).toEqual([
        'training.routing.case_context',
        'training.roleplay.answer',
        'training.structuring.coverage_update',
        'training.validation.question_quality',
        'training.coaching.next_hint',
        'training.composition.feedback_report',
      ]);
    });

    it('covers all 6 skill categories exactly once', () => {
      const categories = ALL_TRAINING_SKILLS.map((s) => s.category);
      expect(categories.sort()).toEqual(
        [
          'composition',
          'decisioning',
          'elicitation',
          'routing',
          'structuring',
          'validation',
        ],
      );
    });

    it('registers all 6 training skills in the default SkillRegistry', () => {
      for (const skill of ALL_TRAINING_SKILLS) {
        const manifest = defaultSkillRegistry.get(skill.skillId, skill.skillVersion);
        expect(manifest).toBe(skill);
      }
    });

    it('routing and coaching skills declare no allowed writes', () => {
      expect(TRAINING_ROUTING_CASE_CONTEXT.allowedWrites).toEqual([]);
      expect(TRAINING_COACHING_NEXT_HINT.allowedWrites).toEqual([]);
    });

    it('roleplay skill may write training_questions.disclosure_rule_hit and training_role_answers', () => {
      expect(TRAINING_ROLEPLAY_ANSWER.allowedWrites).toEqual([
        'training_questions.disclosure_rule_hit',
        'training_role_answers',
      ]);
    });

    it('composition.feedback_report skill may write training_feedback', () => {
      expect(TRAINING_COMPOSITION_FEEDBACK_REPORT.allowedWrites).toEqual(['training_feedback']);
    });
  });

  // ── Write allow-list enforcement ────────────────────────────────────────

  describe('isTrainingWriteAllowed', () => {
    it('allows writes to training_feedback', () => {
      expect(isTrainingWriteAllowed('training_feedback')).toBe(true);
    });

    it('allows writes to training_questions.disclosure_rule_hit', () => {
      expect(isTrainingWriteAllowed('training_questions.disclosure_rule_hit')).toBe(true);
    });

    it('allows writes to training_questions.quality_label', () => {
      expect(isTrainingWriteAllowed('training_questions.quality_label')).toBe(true);
    });

    it('allows writes to training_role_answers', () => {
      expect(isTrainingWriteAllowed('training_role_answers')).toBe(true);
    });

    it('rejects writes to projects (real project data)', () => {
      expect(isTrainingWriteAllowed('projects')).toBe(false);
    });

    it('rejects writes to quick_sessions (quick consult data)', () => {
      expect(isTrainingWriteAllowed('quick_sessions')).toBe(false);
    });

    it('rejects writes to formal_map_snapshots (formal project data)', () => {
      expect(isTrainingWriteAllowed('formal_map_snapshots')).toBe(false);
    });

    it('rejects writes to requirements, baselines, review_actions, changes', () => {
      expect(isTrainingWriteAllowed('requirements')).toBe(false);
      expect(isTrainingWriteAllowed('baselines')).toBe(false);
      expect(isTrainingWriteAllowed('review_actions')).toBe(false);
      expect(isTrainingWriteAllowed('changes')).toBe(false);
    });

    it('rejects writes to unknown tables', () => {
      expect(isTrainingWriteAllowed('unknown_table')).toBe(false);
    });

    it('TRAINING_ALLOWED_WRITE_TARGETS and TRAINING_FORBIDDEN_WRITE_TARGETS are disjoint', () => {
      for (const forbidden of TRAINING_FORBIDDEN_WRITE_TARGETS) {
        expect(TRAINING_ALLOWED_WRITE_TARGETS.has(forbidden)).toBe(false);
      }
    });
  });

  // ── TRAINING_PRACTICE_PLAN structure ───────────────────────────────────

  describe('TRAINING_PRACTICE_PLAN', () => {
    it('declares planId training_practice and version 1.0.0', () => {
      expect(TRAINING_PRACTICE_PLAN.planId).toBe('training_practice');
      expect(TRAINING_PRACTICE_PLAN.planVersion).toBe('1.0.0');
      expect(TRAINING_PRACTICE_PLAN.mode).toBe('training');
    });

    it('accepts training_response and training_feedback task types', () => {
      expect(TRAINING_PRACTICE_PLAN.taskTypes).toEqual([
        'training_response',
        'training_feedback',
      ]);
    });

    it('has exactly 6 steps pointing at registered training skills', () => {
      expect(TRAINING_PRACTICE_PLAN.steps).toHaveLength(6);
      for (const step of TRAINING_PRACTICE_PLAN.steps) {
        const manifest = defaultSkillRegistry.get(step.skillId, step.skillVersion);
        expect(manifest.skillId).toBe(step.skillId);
        expect(manifest.skillVersion).toBe(step.skillVersion);
        expect(manifest.supportedModes).toContain('training');
      }
    });

    it('is included in AGENT_PLANS', () => {
      expect(AGENT_PLANS).toContain(TRAINING_PRACTICE_PLAN);
    });
  });

  // ── resolveAgentPlan selection ─────────────────────────────────────────

  describe('resolveAgentPlan', () => {
    it('selects TRAINING_PRACTICE_PLAN for training_attempt/training_response', () => {
      const plan = resolveAgentPlan({
        scopeKind: 'training_attempt',
        taskType: 'training_response',
      });
      expect(plan).toBe(TRAINING_PRACTICE_PLAN);
    });

    it('selects TRAINING_PRACTICE_PLAN for training_attempt/training_feedback', () => {
      const plan = resolveAgentPlan({
        scopeKind: 'training_attempt',
        taskType: 'training_feedback',
      });
      expect(plan).toBe(TRAINING_PRACTICE_PLAN);
    });

    it('throws for an unknown training task type', () => {
      expect(() =>
        resolveAgentPlan({
          scopeKind: 'training_attempt',
          taskType: 'training_unknown',
        }),
      ).toThrow(/No agent plan/);
    });
  });

  // ── StubProvider determinism for training task types ───────────────────

  describe('StubProvider training outputs', () => {
    const provider = new StubProvider();

    it('returns a deterministic training_response structure on repeated calls', async () => {
      const a = await provider.invoke({ taskType: 'training_response', payload: {} });
      const b = await provider.invoke({ taskType: 'training_response', payload: {} });
      expect(a).toEqual(b);

      const output = a.output as {
        result_type: string;
        role_answer: {
          content: string;
          tone: string;
          disclosed_rule_ids: string[];
          safe_to_show: boolean;
        };
        coach_projection: {
          next_hint: string;
          question_quality_note: string;
          visible_progress_label: string;
        };
      };

      expect(output.result_type).toBe('training_response');
      expect(typeof output.role_answer.content).toBe('string');
      expect(output.role_answer.content.length).toBeGreaterThan(0);
      expect(output.role_answer.tone).toBe('customer');
      expect(Array.isArray(output.role_answer.disclosed_rule_ids)).toBe(true);
      expect(output.role_answer.safe_to_show).toBe(true);
      expect(typeof output.coach_projection.next_hint).toBe('string');
      expect(output.coach_projection.next_hint.length).toBeGreaterThan(0);
      expect(typeof output.coach_projection.question_quality_note).toBe('string');
      expect(typeof output.coach_projection.visible_progress_label).toBe('string');
    });

    it('returns a deterministic training_feedback structure on repeated calls', async () => {
      const a = await provider.invoke({ taskType: 'training_feedback', payload: {} });
      const b = await provider.invoke({ taskType: 'training_feedback', payload: {} });
      expect(a).toEqual(b);

      const output = a.output as {
        result_type: string;
        score: { total: number; max: number; label: string };
        dimensions: Array<{
          dimension: string;
          score: number;
          max: number;
          evidence: string;
          improvement: string;
        }>;
        missed_high_value_questions: string[];
        improvement_examples: Array<{
          before: string;
          after: string;
          reason: string;
        }>;
        summary_review: {
          accuracy: string;
          missing_points: string[];
          unsupported_claims: string[];
          improved_summary: string;
        };
      };

      expect(output.result_type).toBe('training_feedback');
      expect(typeof output.score.total).toBe('number');
      expect(typeof output.score.max).toBe('number');
      expect(output.score.total).toBeLessThanOrEqual(output.score.max);
      expect(typeof output.score.label).toBe('string');
      expect(output.dimensions.length).toBeGreaterThan(0);
      for (const dim of output.dimensions) {
        expect(typeof dim.evidence).toBe('string');
        expect(typeof dim.improvement).toBe('string');
      }
      expect(output.missed_high_value_questions.length).toBeGreaterThan(0);
      expect(output.improvement_examples.length).toBeGreaterThan(0);
      expect(typeof output.summary_review.accuracy).toBe('string');
      expect(Array.isArray(output.summary_review.missing_points)).toBe(true);
      expect(Array.isArray(output.summary_review.unsupported_claims)).toBe(true);
      expect(typeof output.summary_review.improved_summary).toBe('string');
    });

    it('does not leak answer-key or developer terms in training_response', async () => {
      const result = await provider.invoke({ taskType: 'training_response', payload: {} });
      const text = JSON.stringify(result.output);
      // §11.1: 角色回答不得使用"作为 AI"之类说法
      expect(text).not.toContain('作为 AI');
      expect(text).not.toContain('作为一个人工智能');
      // 不得泄露评分维度
      expect(text).not.toContain('answer_key');
      expect(text).not.toContain('rubric');
    });

    it('does not claim capability certification in training_feedback', async () => {
      const result = await provider.invoke({ taskType: 'training_feedback', payload: {} });
      const text = JSON.stringify(result.output);
      // §11.2: 不把本轮分数说成能力认证
      expect(text).not.toContain('能力认证');
      expect(text).not.toContain('证书');
      // 不使用开发者术语
      expect(text).not.toContain('schema_gate');
      expect(text).not.toContain('agent_run');
    });
  });
});
