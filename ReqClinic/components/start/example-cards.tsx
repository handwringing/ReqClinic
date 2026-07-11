'use client';

import Link from 'next/link';
import { PRODUCT_MODE_COPY } from '@/lib/product-language';

export type StartMode = 'quick' | 'formal' | 'training';

interface ExampleCardDef {
  num: string;
  mode: StartMode;
  href: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  cta: string;
}

/** 04 风格 SVG 图标（细线 1.25 stroke） */
function PosterIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z" />
      <path d="M5 19v.01M19 5v.01" />
    </svg>
  );
}
function VisitorIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="1" />
      <path d="M9 22v-4h6v4M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01" />
    </svg>
  );
}
function TrainingIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
      <path d="M6 12v5c3 3 9 3 12 0v-5" />
    </svg>
  );
}

export interface ExampleCardsProps {
  selectedMode: StartMode | null;
  onSelectMode?: (mode: StartMode) => void;
}

export function ExampleCards({ selectedMode, onSelectMode }: ExampleCardsProps) {
  const cards: ExampleCardDef[] = [
    {
      num: '01',
      mode: 'quick',
      href: '/quick',
      title: PRODUCT_MODE_COPY.quick.title,
      subtitle: PRODUCT_MODE_COPY.quick.description,
      icon: <PosterIcon />,
      cta: PRODUCT_MODE_COPY.quick.cta,
    },
    {
      num: '02',
      mode: 'formal',
      href: '/formal/new',
      title: PRODUCT_MODE_COPY.formal.title,
      subtitle: PRODUCT_MODE_COPY.formal.description,
      icon: <VisitorIcon />,
      cta: PRODUCT_MODE_COPY.formal.cta,
    },
    {
      num: '03',
      mode: 'training',
      href: '/training/cases',
      title: PRODUCT_MODE_COPY.training.title,
      subtitle: PRODUCT_MODE_COPY.training.description,
      icon: <TrainingIcon />,
      cta: PRODUCT_MODE_COPY.training.cta,
    },
  ];

  return (
    <div className="examples">
      {cards.map((card) => {
        const isSelected = selectedMode === card.mode;
        return (
          <Link
            key={card.num}
            href={card.href}
            prefetch
            onClick={() => onSelectMode?.(card.mode)}
            className="ex-card"
            style={
              isSelected
                ? {
                    boxShadow: 'inset 0 0 0 1px var(--aurora-gold), var(--aurora-shadow-soft)',
                  }
                : undefined
            }
            aria-label={`${card.title} - ${card.subtitle}`}
          >
            <span className="ex-num">{card.num}</span>
            <div className="ex-icon">{card.icon}</div>
            <div className="ex-title">{card.title}</div>
            <div className="ex-sub">{card.subtitle}</div>
            <div className="ex-cta">
              {card.cta} <span>→</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
