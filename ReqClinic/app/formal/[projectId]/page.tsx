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
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams?: Promise<{ source?: string }>;
}) {
  const { projectId } = await params;
  const source = (await searchParams)?.source;
  return <FormalAnalysisPage projectId={projectId} routeSource={source} />;
}
