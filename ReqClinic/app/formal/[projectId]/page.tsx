import { FormalAnalysisPage } from '@/components/formal/formal-analysis-page';

export default async function FormalPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ source?: string }>;
}) {
  const { projectId } = await params;
  const { source } = await searchParams;
  return <FormalAnalysisPage projectId={projectId} routeSource={source} />;
}
