'use client';

/**
 * 方案 A「工作底稿」(frontend-design skill)
 * 美学方向：编辑性、衬线主导，像一张经过审校的工作底稿。
 * 背景：暖白手稿纸 + 横向 ruling 网格 + 标注路径线（带序号节点，呼应"建档→访谈→简报"）。
 * 严格遵守 FSD §2：浅色画布、居中 prompt bar(max 640)、实色卡片、24px 衬线标题、"开始问诊"主按钮、固定签名。
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowRight, FileText, Sparkles, Building2, GraduationCap } from 'lucide-react';

const MAX_LENGTH = 10000;

/* ---------------- 背景：手稿 ruling + 标注路径 ---------------- */
function DraftBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let rafId = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    // 横向 ruling（手稿纸感）：每 32px 一条极淡横线
    const RULE_COLOR = 'rgba(203, 213, 225, 0.28)';
    // 左侧装订线（一条琥珀极淡竖线）
    const GUTTER_COLOR = 'rgba(234, 88, 12, 0.06)';
    // 标注路径
    const ANNOT_COLOR = 'rgba(100, 116, 139, 0.22)';
    const NODE_ACCENT = 'rgba(194, 65, 12, 0.45)';
    const NODE_SLATE = 'rgba(100, 116, 139, 0.30)';

    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height);

      // 横向 ruling
      ctx.strokeStyle = RULE_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = 0; y <= height; y += 32) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(width, y + 0.5);
      }
      ctx.stroke();

      // 装订线（左侧 + 右侧极淡）
      ctx.strokeStyle = GUTTER_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(width * 0.08, 0);
      ctx.lineTo(width * 0.08, height);
      ctx.moveTo(width * 0.92, 0);
      ctx.lineTo(width * 0.92, height);
      ctx.stroke();

      // 标注路径：3 条贝塞尔曲线，带呼吸节点
      const paths = [
        { x1: 0.04, y1: 0.18, cx: 0.26, cy: 0.30, x2: 0.46, y2: 0.14 },
        { x1: 0.54, y1: 0.78, cx: 0.72, cy: 0.62, x2: 0.96, y2: 0.84 },
        { x1: 0.10, y1: 0.90, cx: 0.38, cy: 0.72, x2: 0.62, y2: 0.92 },
      ];
      ctx.lineWidth = 1;
      paths.forEach((p, i) => {
        const breath = 0.012 * Math.sin(t / 9000 + i * 1.7);
        const x1 = p.x1 * width;
        const y1 = p.y1 * height;
        const cx = p.cx * width;
        const cy = (p.cy + breath) * height;
        const x2 = p.x2 * width;
        const y2 = p.y2 * height;

        ctx.strokeStyle = ANNOT_COLOR;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(cx, cy, x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = NODE_SLATE;
        ctx.beginPath();
        ctx.arc(cx, cy, 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = NODE_ACCENT;
        ctx.beginPath();
        ctx.arc(x1, y1, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x2, y2, 2.5, 0, Math.PI * 2);
        ctx.fill();
      });
    };

    resize();
    if (prefersReducedMotion) {
      draw(0);
      return;
    }
    const loop = (t: number) => {
      draw(t);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    const onVis = () => {
      if (document.hidden) {
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
      } else if (!rafId) {
        rafId = requestAnimationFrame(loop);
      }
    };
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', zIndex: 0, pointerEvents: 'none' }}
    />
  );
}

/* ---------------- 序号徽标 ---------------- */
function IndexMark({ n }: { n: string }) {
  return (
    <span
      className="font-mono text-[11px] font-semibold tracking-wider"
      style={{ color: 'var(--accent-600)' }}
      aria-hidden="true"
    >
      {n}
    </span>
  );
}

/* ---------------- Prompt Bar ---------------- */
function PromptBar() {
  const [input, setInput] = useState('');
  const composingRef = useRef(false);
  const canSubmit = input.trim().length > 0;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    // 预览：不调用 API
  }, [canSubmit]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (composingRef.current) return;
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <section
      className="w-full rounded-lg bg-[var(--bg-surface)] p-7 shadow-1"
      style={{ maxWidth: 640, border: '1px solid var(--border-default)' }}
    >
      {/* 标题区：序号 + 衬线标题 + 副标题 + 细 rule */}
      <div className="flex items-baseline gap-3">
        <IndexMark n="§ 00" />
        <h1
          className="font-display text-3xl font-bold"
          style={{ color: 'var(--text-primary)', letterSpacing: '-0.01em' }}
        >
          需求问诊室
        </h1>
      </div>
      <p className="mt-1.5 pl-12 font-display text-[15px] italic" style={{ color: 'var(--text-secondary)' }}>
        需求分析 is all you need
      </p>
      <div className="mt-4 h-px w-full" style={{ background: 'var(--border-default)' }} />

      {/* 输入区 */}
      <label className="mt-4 block font-mono text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
        原始想法 · 1–10000 字
      </label>
      <div className="relative mt-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, MAX_LENGTH))}
          onCompositionStart={() => (composingRef.current = true)}
          onCompositionEnd={() => (composingRef.current = false)}
          onKeyDown={handleKeyDown}
          placeholder="你现在希望把什么事情说清楚？"
          className="w-full resize-none rounded-md p-3 text-sm leading-relaxed outline-none transition-colors"
          style={{
            minHeight: 120,
            border: '1px solid var(--border-default)',
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)',
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--border-focus)')}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border-default)')}
        />
        <span className="pointer-events-none absolute bottom-1.5 right-2 font-mono text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          {input.length}/{MAX_LENGTH}
        </span>
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        aria-disabled={!canSubmit}
        className="mt-4 h-10 w-full rounded-md text-sm font-semibold transition-colors"
        style={{
          backgroundColor: canSubmit ? 'var(--accent-500)' : 'var(--slate-100)',
          color: canSubmit ? '#ffffff' : 'var(--text-disabled)',
          border: '1px solid ' + (canSubmit ? 'var(--accent-600)' : 'var(--border-default)'),
          cursor: canSubmit ? 'pointer' : 'not-allowed',
        }}
      >
        开始问诊
      </button>
      <p className="mt-2 text-center text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
        Enter 换行 · Ctrl/Cmd + Enter 提交
      </p>
    </section>
  );
}

/* ---------------- 示例卡片 ---------------- */
interface CardDef {
  index: string;
  title: string;
  subtitle: string;
  icon: typeof Sparkles;
  hint: string;
}

const CARDS: CardDef[] = [
  { index: '01', title: '智能海报生成网站', subtitle: '从一句话到需求简报', icon: Sparkles, hint: '快速问诊示例' },
  { index: '02', title: 'Aster 园区访客预约', subtitle: '七阶段完整分析', icon: Building2, hint: '正式分析示例' },
  { index: '03', title: '练习需求沟通', subtitle: '角色扮演训练', icon: GraduationCap, hint: '表达训练' },
];

function ExampleCards() {
  return (
    <div className="grid w-full grid-cols-1 gap-3 md:grid-cols-3" style={{ maxWidth: 640 }}>
      {CARDS.map((c) => {
        const Icon = c.icon;
        return (
          <button
            key={c.index}
            type="button"
            className="group rounded-lg bg-[var(--bg-surface)] p-4 text-left shadow-1 transition-all duration-normal hover:-translate-y-0.5 hover:shadow-2"
            style={{ border: '1px solid var(--border-default)' }}
          >
            <div className="flex items-center justify-between">
              <Icon className="h-5 w-5" style={{ color: 'var(--accent-600)' }} strokeWidth={1.5} aria-hidden="true" />
              <IndexMark n={c.index} />
            </div>
            <div className="mt-3 text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              {c.title}
            </div>
            <div className="mt-1 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
              {c.subtitle}
            </div>
            <div className="mt-3 h-px w-full" style={{ background: 'var(--border-default)' }} />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{c.hint}</span>
              <ArrowRight
                className="h-3.5 w-3.5 transition-transform duration-normal group-hover:translate-x-0.5"
                style={{ color: 'var(--accent-600)' }}
                strokeWidth={1.5}
                aria-hidden="true"
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- 签名 ---------------- */
function Signature() {
  const steps = ['输入想法', '追问澄清', '形成需求简报'];
  return (
    <div className="flex items-center justify-center gap-3" aria-label="输入想法，追问澄清，形成需求简报">
      {steps.map((s, i) => (
        <span key={s} className="flex items-center gap-3">
          <span className="font-display text-sm italic" style={{ color: 'var(--text-tertiary)' }}>{s}</span>
          {i < steps.length - 1 && (
            <ArrowRight size={13} strokeWidth={1.5} style={{ color: 'var(--accent-500)' }} aria-hidden="true" />
          )}
        </span>
      ))}
    </div>
  );
}

/* ---------------- 页面 ---------------- */
export function StartOptionA() {
  return (
    <div style={{ position: 'relative', minHeight: '100vh' }}>
      <DraftBackground />
      {/* 预览标识 */}
      <div
        className="fixed left-4 top-4 z-10 flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', color: 'var(--text-tertiary)' }}
      >
        <FileText className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
        方案 A · 工作底稿
      </div>
      <main
        style={{
          position: 'relative',
          zIndex: 1,
          maxWidth: 'var(--content-max-width)',
          margin: '0 auto',
          padding: '72px 24px 80px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 36,
        }}
      >
        <PromptBar />
        <ExampleCards />
        <Signature />
      </main>
    </div>
  );
}
