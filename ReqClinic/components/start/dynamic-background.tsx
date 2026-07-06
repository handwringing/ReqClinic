'use client';

/**
 * 浅色极光 editorial 背景（参考 04 设计语言）：
 * - 三色柔和晕染（金/鼠尾草绿/玫瑰）以 multiply 在暖纸底上沉色
 * - 颗粒噪点叠加质感
 * - prefers-reduced-motion: reduce 时极光静止
 * - 纯 CSS 实现，无 Canvas 开销，标签页隐藏自动暂停（CSS animation 不可见时不渲染）
 */
export function DynamicBackground() {
  return (
    <>
      <div className="aurora-stage" aria-hidden="true">
        <div className="aurora a1" />
        <div className="aurora a2" />
        <div className="aurora a3" />
      </div>
      <div className="grain" aria-hidden="true" />
    </>
  );
}
