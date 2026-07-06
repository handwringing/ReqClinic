import { TrainingPage } from '@/components/training/training-page';

export default async function TrainingAttemptPage({
  params,
  searchParams,
}: {
  params: Promise<{ attemptId: string }>;
  searchParams: Promise<{ source?: string }>;
}) {
  const { attemptId } = await params;
  const { source } = await searchParams;
  return <TrainingPage attemptId={attemptId} routeSource={source} />;
}
