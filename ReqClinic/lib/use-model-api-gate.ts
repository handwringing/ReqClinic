'use client';

import { useCallback, useEffect, useState } from 'react';
import { hasModelApiAccess, warmModelApiAccess } from '@/lib/intake-guards';

interface UseModelApiGateOptions {
  skip?: boolean;
}

export function useModelApiGate({ skip = false }: UseModelApiGateOptions = {}) {
  const [modelDialogOpen, setModelDialogOpen] = useState(false);

  useEffect(() => {
    if (!skip) warmModelApiAccess();
  }, [skip]);

  const requireModelApi = useCallback(async () => {
    if (skip) return true;
    const modelReady = await hasModelApiAccess();
    if (!modelReady) setModelDialogOpen(true);
    return modelReady;
  }, [skip]);

  return {
    modelDialogOpen,
    requireModelApi,
    dismissModelDialog: () => setModelDialogOpen(false),
  };
}
