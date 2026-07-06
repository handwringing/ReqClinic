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
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  return <TrainingPage attemptId={attemptId} />;
}
