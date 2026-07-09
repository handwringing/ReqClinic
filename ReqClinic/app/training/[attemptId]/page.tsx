import { TrainingPage } from '@/components/training/training-page';
import {
  TRAINING_STATIC_CASE_IDS,
  trainingRetryAttemptId,
  trainingStaticAttemptId,
} from '@/lib/static-demo-ids';

export function generateStaticParams() {
  return [
    ...TRAINING_STATIC_CASE_IDS.map((caseId) => ({
      attemptId: trainingStaticAttemptId(caseId),
    })),
    ...TRAINING_STATIC_CASE_IDS.map((caseId) => ({
      attemptId: trainingRetryAttemptId(caseId),
    })),
  ];
}

export default async function TrainingAttemptPage({
  params,
  searchParams,
}: {
  params: Promise<{ attemptId: string }>;
  searchParams?: Promise<{ source?: string }>;
}) {
  const { attemptId } = await params;
  const source = (await searchParams)?.source;
  return <TrainingPage attemptId={attemptId} routeSource={source} />;
}
