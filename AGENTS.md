# ReqClinic Project Rules

These rules apply to the entire repository, including the Next.js frontend, mock flows, backend integration, documentation, and browser verification.

## Product Behavior

- Quick consultation, formal projects, and expression training must remain distinct user workflows.
- Reference cases must work without model access as controlled dynamic demonstrations: users choose from bounded, predefined directions, and arbitrary text must not create untested sample states.
- Expression-training samples follow the same controlled-demo rule: offer multiple predefined questions so users can choose a branch or order, but do not expose an editable composer. Free-text questioning belongs only to a non-sample training attempt.
- User choices must visibly affect the next question and at least one downstream artifact such as understanding cards, map nodes, options, reports, role responses, or feedback.
- Guided reference flows must show the current step and total steps, keep exactly one primary next action beside its prerequisite, and explain why that action is unavailable.
- In multi-pane guided flows, one surface owns each action. Do not expose duplicate or contradictory controls for an operation that the selected branch already performs automatically.
- Custom flows must keep their real API behavior. Do not replace production behavior with local sample rules.
- Formal custom projects must not use a fixed question count as a completion condition. Continue from unresolved map coverage, enter review only when the current key questions are covered, and still allow later supplements.
- Formal report access must come from the formal guidance state returned by the service. Do not unlock it merely because a snapshot or local fallback report exists.
- Formal reports must use the same reading hierarchy as quick-consultation reports: a full reading surface, `普通概述 / 专业报告` view switching, and copy/download actions in the report header. Do not regress the formal report to a small centered modal.
- Quick reference cases cannot be upgraded into formal projects. Block the action in the UI and API/mock boundary, explain that the case is controlled, and offer the formal-project entry instead.
- Before starting a custom AI-dependent flow, check model availability and present the user-facing unavailable dialog before accepting work that cannot continue.

## User-Facing Copy

- Conversation bubbles speak directly. Do not prefix a question with narration such as `问诊助手先问：`, `系统将：`, or `示例会：`.
- Do not expose developer or state-machine language such as `mock`, `sample`, `custom`, `API Key`, internal status names, agent names, or implementation mechanics.
- Guidance describes the user's current action and outcome, not how the interface is implemented.
- Guidance names the actual control and result. Do not rely on relative directions such as "above", "below", or "on the right" when the target can be named directly.
- Reference-case copy must read like a real scenario. Technical determinism belongs in code and tests, not in visible prose.
- When behavior becomes free-form or dynamic, update nearby instructions so they no longer promise a fixed step-by-step path.

## Motion and Layout

- Preserve meaningful entrance, question-change, message, loading, map, and feedback motion across all three workflows.
- Motion must represent a state change and must have a `prefers-reduced-motion` fallback.
- Dynamic labels, buttons, counters, cards, nodes, and toolbars must not resize or shift the surrounding layout unexpectedly.
- Do not allow incoherent overlap, clipped primary controls, hidden send actions, or document-level horizontal scrolling.
- The themed page background must cover the entire scrollable document at every required viewport; root-canvas white bands below long content are a layout failure.
- Wide workbench screens should use available space for readable panes without stretching text lines or leaving critical actions isolated at the edges.

## Required Browser Matrix

For any change affecting layout, copy, navigation, motion, examples, or a primary workflow, verify the affected route at these viewports:

| Name | Viewport | Purpose |
| --- | --- | --- |
| Mobile | `390 x 844` | Narrow touch layout and tab switching |
| Desktop | `1280 x 900` | Standard laptop/workbench layout |
| Ultrawide | `2048 x 1024` | Required 2:1 workbench proportion |

When reproducing the July 11 ultrawide reference screenshot, also use its exact viewport: `2551 x 1276`.

At every required viewport:

- Wait at least 800 ms after the last transition before taking the settled screenshot.
- Assert `document.documentElement.scrollWidth <= document.documentElement.clientWidth` unless horizontal scrolling is an explicit local tool behavior.
- Check console errors, text clipping, control overlap, fixed-footer/input visibility, and the primary next action.
- Exercise the state after interaction, not only the initial render.
- For dynamic reference cases, verify at least two predefined choices produce different visible outcomes and that arbitrary composer text cannot be submitted.
- For expression-training samples, verify at least two predefined questions produce different role responses or feedback, the selected question disappears from the remaining choices, and no editable composer is present.

## Case Coverage

- Do not call case verification complete from a subset.
- Quick sample verification means all IDs in `QUICK_STATIC_CASE_IDS`.
- Formal sample verification means all IDs in `FORMAL_STATIC_CASE_IDS` and every complete route in each changed branch family, not only the first choice or one representative path.
- Enumerate every formal sample route with `npm run test:formal-branches`; browser verification must cover every first-level domain branch plus the required viewport matrix.
- Training sample verification means all IDs in `TRAINING_STATIC_CASE_IDS`.
- Record the exact case/viewport matrix and distinguish source checks from real browser interaction.

## Change Discipline

- Preserve unrelated dirty-worktree changes.
- Keep sample-only behavior behind `source_kind === 'sample'` or the equivalent static-case boundary.
- Run TypeScript, lint, production build, and `git diff --check` after frontend flow changes.
- Next.js build rewrites to `next-env.d.ts` are generated noise; restore the development reference before finalizing unless the project intentionally changes it.
