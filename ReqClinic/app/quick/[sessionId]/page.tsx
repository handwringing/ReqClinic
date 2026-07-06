import { QuickConsultPage } from '@/components/quick/quick-consult-page';
import { QUICK_STATIC_CASE_IDS, quickStaticSessionId } from '@/lib/static-demo-ids';

export function generateStaticParams() {
  return QUICK_STATIC_CASE_IDS.map((sourceCaseId) => ({
    sessionId: quickStaticSessionId(sourceCaseId),
  }));
}

export default async function QuickConsultPageRoute({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <QuickConsultPage sessionId={sessionId} />;
}
