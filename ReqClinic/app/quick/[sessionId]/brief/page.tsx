import { BriefPage } from '@/components/brief/brief-page';

export default async function Brief({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <BriefPage sessionId={sessionId} />;
}
