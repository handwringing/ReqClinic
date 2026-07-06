import { QuickConsultPage } from '@/components/quick/quick-consult-page';

export default async function QuickConsultPageRoute({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <QuickConsultPage sessionId={sessionId} />;
}
