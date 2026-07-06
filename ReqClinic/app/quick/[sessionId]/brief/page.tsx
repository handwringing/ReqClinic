import { BriefPage } from '@/components/brief/brief-page';
import { QUICK_STATIC_CASE_IDS, quickStaticSessionId } from '@/lib/static-demo-ids';

export function generateStaticParams() {
  return QUICK_STATIC_CASE_IDS.map((sourceCaseId) => ({
    sessionId: quickStaticSessionId(sourceCaseId),
  }));
}

export default async function Brief({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <BriefPage sessionId={sessionId} />;
}
