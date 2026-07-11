'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ProductBrandText } from '@/components/common/product-brand';
import { PRODUCT_BRAND } from '@/lib/product-language';
import { DynamicBackground } from './dynamic-background';
import { ExampleCards } from './example-cards';

/**
 * 起始页只负责三种模式分流：快速问诊进入案例问诊页，
 * 正式项目和表达训练直接进入各自首个可操作页面。
 */
export function StartPage() {
  const router = useRouter();

  useEffect(() => {
    const warmPrimaryRoutes = () => {
      router.prefetch('/quick');
      router.prefetch('/formal/new');
      router.prefetch('/training/cases');
    };

    const timerId = globalThis.setTimeout(warmPrimaryRoutes, 200);
    return () => globalThis.clearTimeout(timerId);
  }, [router]);

  return (
    <div className="start-aurora">
      <DynamicBackground />
      <div className="topline" />

      <div className="topbar">
        <Link
          href="/"
          prefetch={false}
          className="brand-mark brand-home-link"
          aria-label="返回首页"
        >
          <span className="dot" />
          <ProductBrandText />
        </Link>
        <div aria-hidden="true" />
      </div>

      <div className="hero">
        <div className="eyebrow">智能引导式需求问诊</div>
        <h1 className="aurora-title">
          <span className="accent">需求</span>问诊室
        </h1>
        <p className="tagline">
          {PRODUCT_BRAND.sloganZh} <em>{PRODUCT_BRAND.sloganEn}</em>
        </p>
      </div>

      <div className="examples-head">选择一个起点</div>
      <ExampleCards selectedMode={null} />
    </div>
  );
}
