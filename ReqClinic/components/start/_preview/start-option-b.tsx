'use client';

/**
 * 方案 B「问诊流动」(frontend-skill skill)
 * 美学方向：克制、留白主导、第一屏如海报；品牌名最响，单一强调色。
 * 背景：极淡点阵网格 + 缓慢流动的暖琥珀光带 + 诊断路径线（实线 + 呼吸节点），表达"问诊流动感"。
 * 严格遵守 FSD §2：浅色画布、居中 prompt bar(max 640)、实色卡片、24px 衬线标题、"开始问诊"主按钮、固定签名。
 * 注：frontend-skill 默认"无卡片"，但 FSD §2.4 明确要求三张实色卡片；FSD 为 governing spec，此处保留卡片但极简化处理。
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowRight, Sparkles, Building2, GraduationCap, Activity } from 'lucide-react';

const MAX_LENGTH = 10000;

/* ---------------- 背景：点阵 + 光带 + 流动诊断路径 ---------------- */
function FlowBackground() {
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

    const DOT_COLOR = 'rgba(203, 213, 225, 0.35)';
    const GLOW_COLOR = 'rgba(234, 88, 12, 0.05)';
    const GLOW_TRANSPARENT = 'rgba(234, 88, 12, 0)';
    const PATH_COLOR = 'rgba(148, 163, 184, 0.22)';
    const NODE_ACCENT = 'rgba(234, 88, 12, 0.50)';
    const NODE_SLATE = 'rgba(100, 116, 139, 0.28)';
    const BAND_PERIOD = 140_000;
    const BAND_HALF = 160;

    const drawDots = () => {
      ctx.fillStyle = DOT_COLOR;
      const step = 28;
      for (let x = step / 2; x < width; x += step) {
        for (let y = step / 2; y < height; y += step) {
          ctx.beginPath();
          ctx.arc(x, y, 0.9, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    const drawGlowBand = (t: number) => {
      const phase = (t % BAND_PERIOD) / BAND_PERIOD;
      const bandY = height * (0.5 + 0.32 * Math.sin(phase * Math.PI * 2));
      const top = bandY - BAND_HALF;
      const bottom = bandY + BAND_HALF;
      const grad = ctx.createLinearGradient(0, top, 0, bottom);
      grad.addColorStop(0, GLOW_TRANSPARENT);
      grad.addColorStop(0.5, GLOW_COLOR);
      grad.addColorStop(1, GLOW_TRANSPARENT);
      ctx.fillStyle = grad;
      ctx.fillRect(0, top, width, BAND_HALF * 2);
    };

    const drawPaths = (t: number) => {
      const paths = [
        { x1: 0.08, y1: 0.30, cx: 0.30, cy: 0.20, x2: 0.50, y2: 0.34 },
        { x1: 0.50, y1: 0.34, cx: 0.70, cy: 0.48, x2: 0.92, y2: 0.40 },
        { x1: 0.06, y1: 0.72, cx: 0.34, cy: 0.84, x2: 0.60, y2: 0.66 },
        { x1: 0.60, y1: 0.66, cx: 0.80, cy: 0.58, x2: 0.94, y2: 0.74 },
      ];
      ctx.lineWidth = 1;
      paths.forEach((p, i) => {
        const breath = 0.014 * Math.sin(t / 11000 + i * 1.3);
        const x1 = p.x1 * width;
        const y1 = p.y1 * height;
        const cx = p.cx * width;
        const cy = (p.cy + breath) * height;
        const x2 = p.x2 * width;
        const y2 = p.y2 * height;

        ctx.strokeStyle = PATH_COLOR;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(cx, cy, x2, y2);
        ctx.stroke();

        ctx.fillStyle = NODE_SLATE;
        ctx.beginPath();
        ctx.arc(cx, cy, 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = NODE_ACCENT;
        ctx.beginPath();
        ctx.arc(x1, y1, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x2, y2, 2.6, 0, Math.PI * 2);
        ctx.fill();
      });
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height);
      drawDots();
      drawGlowBand(t);
      drawPaths(t);
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
      className="w-full rounded-lg bg-[var(--bg-surface)] p-8 shadow-1"
      style={{ maxWidth: 640, border: '1px solid var(--border-default)' }}
    >
      {/* 海报式标题：品牌名最响 */}
      <div className="text-center">
        <h1
          className="font-display text-[32px] font-bold leading-tight"
          style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}
        >
          需求问诊室
        </h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-tertiary)' }}>
          需求分析 is all you need
        </p>
      </div>

      {/* 输入区 */}
      <div className="mt-7">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, MAX_LENGTH))}
          onCompositionStart={() => (composingRef.current = true)}
          onCompositionEnd={() => (composingRef.current = false)}
          onKeyDown={handleKeyDown}
          placeholder="你现在希望把什么事情说清楚？"
          className="w-full resize-none rounded-md p-3 text-sm leading-relaxed outline-none transition-colors"
          style={{
            minHeight: 116,
            border: '1px solid var(--border-default)',
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)',
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--border-focus)')}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border-default)')}
        />
        <div className="mt-1.5 flex items-center justify-between px-0.5">
          <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            Ctrl/Cmd + Enter 提交
          </span>
          <span className="font-mono text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            {input.length}/{MAX_LENGTH}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        aria-disabled={!canSubmit}
        className="mt-4 h-10 w-full rounded-md text-sm font-semibold transition-all duration-normal"
        style={{
          backgroundColor: canSubmit ? 'var(--accent-500)' : 'var(--slate-100)',
          color: canSubmit ? '#ffffff' : 'var(--text-disabled)',
          border: '1px solid ' + (canSubmit ? 'var(--accent-600)' : 'var(--border-default)'),
          cursor: canSubmit ? 'pointer' : 'not-allowed',
        }}
      >
        开始问诊
      </button>
    </section>
  );
}

/* ---------------- 示例卡片（极简） ---------------- */
interface CardDef {
  title: string;
  subtitle: string;
  icon: typeof Sparkles;
  tag: string;
}

const CARDS: CardDef[] = [
  { title: '智能海报生成网站', subtitle: '从一句话到需求简报', icon: Sparkles, tag: '快速问诊' },
  { title: 'Aster 园区访客预约', subtitle: '七阶段完整分析', icon: Building2, tag: '正式分析' },
  { title: '练习需求沟通', subtitle: '角色扮演训练', icon: GraduationCap, tag: '表达训练' },
];

function ExampleCards() {
  return (
    <div className="grid w-full grid-cols-1 gap-3 md:grid-cols-3" style={{ maxWidth: 640 }}>
      {CARDS.map((c) => {
        const Icon = c.icon;
        return (
          <button
            key={c.title}
            type="button"
            className="group rounded-lg bg-[var(--bg-surface)] p-5 text-left shadow-1 transition-all duration-normal hover:-translate-y-0.5 hover:shadow-2"
            style={{ border: '1px solid var(--border-default)' }}
          >
            <Icon className="h-5 w-5" style={{ color: 'var(--accent-600)' }} strokeWidth={1.5} aria-hidden="true" />
            <div className="mt-3 text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              {c.title}
            </div>
            <div className="mt-1 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
              {c.subtitle}
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{ background: 'var(--bg-subtle)', color: 'var(--text-tertiary)' }}
              >
                {c.tag}
              </span>
              <ArrowRight
                className="h-3.5 w-3.5 opacity-0 transition-all duration-normal group-hover:translate-x-0.5 group-hover:opacity-100"
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
    <div className="flex items-center justify-center gap-2.5" aria-label="输入想法，追问澄清，形成需求简报">
      {steps.map((s, i) => (
        <span key={s} className="flex items-center gap-2.5">
          <span className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>{s}</span>
          {i < steps.length - 1 && (
            <ArrowRight size={13} strokeWidth={1.5} style={{ color: 'var(--accent-500)' }} aria-hidden="true" />
          )}
        </span>
      ))}
    </div>
  );
}

/* ---------------- 页面 ---------------- */
export function StartOptionB() {
  return (
    <div style={{ position: 'relative', minHeight: '100vh' }}>
      <FlowBackground />
      {/* 预览标识 */}
      <div
        className="fixed left-4 top-4 z-10 flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', color: 'var(--text-tertiary)' }}
      >
        <Activity className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
        方案 B · 问诊流动
      </div>
      <main
        style={{
          position: 'relative',
          zIndex: 1,
          maxWidth: 'var(--content-max-width)',
          margin: '0 auto',
          padding: '88px 24px 96px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 40,
        }}
      >
        <PromptBar />
        <ExampleCards />
        <Signature />
      </main>
    </div>
  );
}
