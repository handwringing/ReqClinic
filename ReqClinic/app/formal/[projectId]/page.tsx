import { FormalAnalysisPage } from '@/components/formal/formal-analysis-page';
import {
  FORMAL_CUSTOM_PROJECT_ID,
  FORMAL_STATIC_CASE_IDS,
  QUICK_STATIC_CASE_IDS,
  formalQuickUpgradeProjectId,
  formalStaticProjectId,
} from '@/lib/static-demo-ids';

export function generateStaticParams() {
  return [
    { projectId: FORMAL_CUSTOM_PROJECT_ID },
    ...FORMAL_STATIC_CASE_IDS.map((sourceCaseId) => ({
      projectId: formalStaticProjectId(sourceCaseId),
    })),
    ...QUICK_STATIC_CASE_IDS.map((sourceCaseId) => ({
      projectId: formalQuickUpgradeProjectId(sourceCaseId),
    })),
  ];
}

export default async function FormalPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <FormalAnalysisPage projectId={projectId} />;
}
