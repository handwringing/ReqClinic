import type { SkillManifest } from './types';
import { FORMAL_SKILL_MANIFESTS } from './formal-schemas';
import { ALL_TRAINING_SKILLS } from './skills';

export const CORE_SKILLS: readonly SkillManifest[] = [
  {
    skillId: 'quick.routing.domain_risk',
    skillVersion: '1.0.0',
    category: 'routing',
    supportedModes: ['quick'],
    inputSchemaVersion: 'quick_routing_input.v1',
    outputSchemaVersion: 'quick_routing_output.v1',
    promptVersion: 'qr-prompt-v1',
    allowedStateTransitions: ['draft->clarifying', 'clarifying->clarifying'],
    allowedWrites: ['quick_sessions.coverage_slots_json'],
    requiredDomainPacks: ['general'],
    validators: ['schema', 'domain_pack_registered', 'safe_general_fallback'],
  },
  {
    skillId: 'quick.elicitation.next_question',
    skillVersion: '1.0.0',
    category: 'elicitation',
    supportedModes: ['quick'],
    inputSchemaVersion: 'quick_elicitation_input.v1',
    outputSchemaVersion: 'quick_elicitation_output.v1',
    promptVersion: 'qe-prompt-v1',
    allowedStateTransitions: ['clarifying->clarifying', 'clarifying->understanding_review'],
    allowedWrites: ['quick_turns', 'quick_sessions.coverage_slots_json'],
    requiredDomainPacks: ['general'],
    validators: ['schema', 'coverage_slot_known', 'no_user_self_planning'],
  },
  {
    skillId: 'quick.structuring.understanding_patch',
    skillVersion: '1.0.0',
    category: 'structuring',
    supportedModes: ['quick'],
    inputSchemaVersion: 'quick_structuring_input.v1',
    outputSchemaVersion: 'quick_structuring_output.v1',
    promptVersion: 'qs-prompt-v1',
    allowedStateTransitions: ['clarifying->clarifying', 'understanding_review->understanding_review'],
    allowedWrites: ['quick_turns', 'quick_unknowns', 'quick_sessions.coverage_slots_json'],
    requiredDomainPacks: ['general'],
    validators: ['schema', 'bound_card_visible', 'bound_card_snapshot_versioned'],
  },
  {
    skillId: 'quick.validation.coverage_gate',
    skillVersion: '1.0.0',
    category: 'validation',
    supportedModes: ['quick'],
    inputSchemaVersion: 'quick_validation_input.v1',
    outputSchemaVersion: 'quick_validation_output.v1',
    promptVersion: 'qv-prompt-v1',
    allowedStateTransitions: ['clarifying->clarifying', 'clarifying->understanding_review'],
    allowedWrites: ['quick_unknowns', 'quick_sessions.status'],
    requiredDomainPacks: ['general'],
    validators: ['schema', 'blocking_unknown_preserved', 'coverage_threshold'],
  },
  {
    skillId: 'quick.decisioning.options',
    skillVersion: '1.0.0',
    category: 'decisioning',
    supportedModes: ['quick'],
    inputSchemaVersion: 'quick_decisioning_input.v1',
    outputSchemaVersion: 'quick_decisioning_output.v1',
    promptVersion: 'qd-prompt-v1',
    allowedStateTransitions: ['understanding_review->option_review', 'option_review->option_review'],
    allowedWrites: ['option_preferences', 'brief_versions.snapshot_json'],
    requiredDomainPacks: ['general'],
    validators: ['schema', 'no_formal_decision', 'preference_not_approval'],
  },
  {
    skillId: 'quick.composition.brief_views',
    skillVersion: '1.0.0',
    category: 'composition',
    supportedModes: ['quick'],
    inputSchemaVersion: 'quick_composition_input.v1',
    outputSchemaVersion: 'quick_composition_output.v1',
    promptVersion: 'qc-prompt-v1',
    allowedStateTransitions: ['option_review->brief_ready', 'brief_ready->brief_ready'],
    allowedWrites: ['brief_versions', 'brief_exports'],
    requiredDomainPacks: ['general'],
    validators: ['schema', 'single_brief_snapshot', 'no_new_fact_per_view'],
  },
  ...FORMAL_SKILL_MANIFESTS.map((skill) => ({
    ...skill,
    supportedModes: ['formal' as const],
    allowedStateTransitions: ['Draft->Draft', 'Draft->Eliciting', 'Eliciting->Eliciting'],
    allowedWrites: ['formal_map_snapshots', 'formal_turns'],
    requiredDomainPacks: ['general'],
    validators: ['schema', 'manual_gate_preserved', 'no_formal_baseline_write'],
  })),
  {
    skillId: 'formal.routing.reserved',
    skillVersion: '0.1.0',
    category: 'routing',
    supportedModes: ['formal'],
    inputSchemaVersion: 'formal_routing_input.v0',
    outputSchemaVersion: 'formal_routing_output.v0',
    promptVersion: 'fr-prompt-v0',
    allowedStateTransitions: ['Draft->Eliciting', 'Eliciting->Reviewing'],
    allowedWrites: [],
    requiredDomainPacks: ['general'],
    validators: ['schema', 'human_confirmed_baseline'],
  },
  ...ALL_TRAINING_SKILLS,
];

export class SkillRegistry {
  private readonly manifests = new Map<string, SkillManifest>();

  constructor(skills: readonly SkillManifest[] = CORE_SKILLS) {
    for (const skill of skills) {
      const key = skillKey(skill.skillId, skill.skillVersion);
      if (this.manifests.has(key)) {
        throw new Error(`Duplicate skill manifest: ${key}`);
      }
      this.manifests.set(key, skill);
    }
  }

  get(skillId: string, skillVersion: string): SkillManifest {
    const manifest = this.manifests.get(skillKey(skillId, skillVersion));
    if (!manifest) {
      throw new Error(`Unknown skill manifest: ${skillId}@${skillVersion}`);
    }
    return manifest;
  }

  list(): SkillManifest[] {
    return Array.from(this.manifests.values());
  }
}

export function skillKey(skillId: string, skillVersion: string): string {
  return `${skillId}@${skillVersion}`;
}

export const defaultSkillRegistry = new SkillRegistry();
