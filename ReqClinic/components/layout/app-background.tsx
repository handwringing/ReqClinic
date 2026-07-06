'use client';

/**
 * 全局极光背景层：所有内页共用。
 * - 三色柔和晕染（金/鼠尾草绿/玫瑰）以 multiply 在暖纸底上沉色
 * - 颗粒噪点 + 顶部细线
 * - prefers-reduced-motion: reduce 时极光静止
 */
export function AppBackground() {
  return (
    <>
      <div className="app-aurora-stage" aria-hidden="true">
        <div className="app-aurora a1" />
        <div className="app-aurora a2" />
        <div className="app-aurora a3" />
      </div>
      <div className="app-grain" aria-hidden="true" />
      <div className="app-topline" aria-hidden="true" />
    </>
  );
}
