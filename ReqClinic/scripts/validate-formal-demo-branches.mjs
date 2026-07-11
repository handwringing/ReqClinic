import { listFormalDemoBranchScenarios } from '../lib/formal-demo-branches.ts';

const EXPECTED_MODULES = {
  aster: ['service_journey', 'roles', 'exception', 'scope', 'audit', 'risk', 'report'],
  outsourcing: ['business_goal', 'content_scope', 'lead_flow', 'deliverables', 'acceptance', 'change_rule', 'report'],
  capstone: ['success_criteria', 'demo_flow', 'scoring', 'privacy', 'team_dependency', 'schedule', 'report'],
};

const EXPECTED_DEPTH = 8;
const EXPECTED_ROUTES_PER_CASE = 3 * (2 ** (EXPECTED_DEPTH - 1));

function enumerateRoutes(scenario) {
  const routes = [];
  const visit = (stepId, path, visited) => {
    if (visited.has(stepId)) throw new Error(`${scenario.caseId}: branch cycle at ${stepId}`);
    const step = scenario.steps[stepId];
    if (!step) throw new Error(`${scenario.caseId}: missing step ${stepId}`);
    if (step.choices.length < 2) throw new Error(`${scenario.caseId}: ${stepId} needs at least two choices`);
    if (new Set(step.choices.map((choice) => choice.id)).size !== step.choices.length) {
      throw new Error(`${scenario.caseId}: duplicate choice id in ${stepId}`);
    }
    const nextVisited = new Set(visited).add(stepId);
    for (const choice of step.choices) {
      const nextPath = [...path, { step, choice }];
      if (choice.nextStepId) {
        visit(choice.nextStepId, nextPath, nextVisited);
      } else {
        routes.push(nextPath);
      }
    }
  };
  visit(scenario.startStepId, [], new Set());
  return routes;
}

const summary = [];
for (const scenario of listFormalDemoBranchScenarios()) {
  const routes = enumerateRoutes(scenario);
  if (routes.length !== EXPECTED_ROUTES_PER_CASE) {
    throw new Error(`${scenario.caseId}: expected ${EXPECTED_ROUTES_PER_CASE} routes, received ${routes.length}`);
  }
  for (const route of routes) {
    if (route.length !== EXPECTED_DEPTH) {
      throw new Error(`${scenario.caseId}: expected depth ${EXPECTED_DEPTH}, received ${route.length}`);
    }
    const coveredModules = new Set(route.map(({ step }) => step.moduleId));
    for (const moduleId of EXPECTED_MODULES[scenario.caseId]) {
      if (!coveredModules.has(moduleId)) {
        throw new Error(`${scenario.caseId}: route misses module ${moduleId}`);
      }
    }
  }
  summary.push({ caseId: scenario.caseId, routes: routes.length, depth: EXPECTED_DEPTH });
}

console.log(JSON.stringify({ totalRoutes: summary.reduce((sum, item) => sum + item.routes, 0), cases: summary }));
