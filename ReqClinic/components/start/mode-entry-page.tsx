'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { StartMode } from './example-cards';
import { QuickModePage } from './quick-mode-page';

// 兼容 Next dev server 热更新缓存中的旧引用；产品路由不再使用这个组件。
export function ModeEntryPage({ mode }: { mode: Exclude<StartMode, 'formal'> }) {
  const router = useRouter();

  useEffect(() => {
    if (mode === 'training') router.replace('/training/cases');
  }, [mode, router]);

  if (mode === 'training') return null;
  return <QuickModePage />;
}
