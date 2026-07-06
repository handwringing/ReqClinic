import { createHash } from 'node:crypto';
import type { Baseline, BaselineItem } from '../db/schema/review';

/**
 * Report compiler (§10.3).
 *
 * Reads an approved baseline and its frozen items, then produces a fixed set of
 * 15 content-block contracts grouped into 8 chapters, plus the HTML template,
 * the report input schema hash, the data hash and the chapter-coverage map.
 *
 * The compiler is deterministic: the same baseline + domain config always
 * yields the same hashes, chapters and HTML. Reports never read from current
 * mutable rows — only from the named baseline and its frozen entity versions.
 */

export const COMPILER_VERSION = 'compiler-v1.0.0';
export const CORE_SCHEMA_VERSION = '1.0.0';

export interface DomainConfig {
  domainProfileId: string;
  domainProfileVersion: number;
  domainPackVersions: string[];
  promptVersions?: string[];
  modelVersions?: string[];
}

export interface ContentBlock {
  code: string;
  chapter: string;
  required: boolean;
  /** Baseline entity_type that feeds this block; null when derived/aggregate. */
  entityType: string | null;
}

export interface CompiledChapter {
  id: string;
  title: string;
  required: boolean;
  blocks: string[];
  sourceCount: number;
  status: 'complete' | 'partial' | 'missing';
  missingReason: string | null;
}

export interface ChapterCoverage {
  status: 'complete' | 'partial' | 'missing';
  required: boolean;
  source_count: number;
  missing_reason: string | null;
}

export interface GateDefect {
  gate_code: string;
  severity: 'blocking' | 'warning';
  blocking: boolean;
  message: string;
  entity_refs: string[];
  resolution_hint: string | null;
}

export interface CompiledReport {
  dataHash: string;
  reportInputSchemaHash: string;
  coreSchemaVersion: string;
  compilerVersion: string;
  chapters: CompiledChapter[];
  chapterCoverage: Record<string, ChapterCoverage>;
  html: string;
  gateDefects: GateDefect[];
}

/**
 * The 15 content-block contracts and their chapter grouping. Order matters:
 * blocks are emitted in this sequence inside the HTML.
 */
export const CONTENT_BLOCKS: readonly ContentBlock[] = [
  { code: 'executive_summary', chapter: 'executive_summary', required: true, entityType: null },
  { code: 'context_background', chapter: 'context', required: true, entityType: null },
  { code: 'stakeholders', chapter: 'context', required: true, entityType: 'stakeholder' },
  { code: 'outcomes', chapter: 'outcomes', required: true, entityType: 'outcome' },
  { code: 'requirements', chapter: 'requirements', required: true, entityType: 'requirement' },
  { code: 'acceptance_criteria', chapter: 'requirements', required: true, entityType: 'acceptance' },
  { code: 'drivers', chapter: 'drivers_and_risks', required: true, entityType: 'driver' },
  { code: 'risks', chapter: 'drivers_and_risks', required: true, entityType: null },
  { code: 'decisions', chapter: 'decisions', required: true, entityType: 'decision' },
  { code: 'conflicts', chapter: 'decisions', required: true, entityType: 'conflict' },
  { code: 'evidence_index', chapter: 'evidence', required: true, entityType: 'evidence' },
  { code: 'assumptions', chapter: 'appendix', required: false, entityType: null },
  { code: 'constraints', chapter: 'appendix', required: false, entityType: null },
  { code: 'glossary', chapter: 'appendix', required: false, entityType: null },
  { code: 'appendix', chapter: 'appendix', required: false, entityType: null },
];

const CHAPTER_TITLES: Record<string, string> = {
  executive_summary: '执行摘要',
  context: '背景与干系人',
  outcomes: '预期成果',
  requirements: '需求与验收标准',
  drivers_and_risks: '驱动因素与风险',
  decisions: '决策与冲突',
  evidence: '证据索引',
  appendix: '附录',
};

function countByEntityType(items: BaselineItem[], entityType: string | null): number {
  if (entityType === null) return items.length;
  return items.filter((i) => i.entityType === entityType).length;
}

/**
 * Compile a report from an approved baseline and its frozen items.
 *
 * Throws when the baseline is not `approved` — reports may only be compiled
 * from a named, approved baseline.
 */
export function compileReport(
  baseline: Baseline,
  items: BaselineItem[],
  domainConfig: DomainConfig,
): CompiledReport {
  if (baseline.status !== 'approved') {
    throw new Error(
      `Cannot compile report from non-approved baseline ${baseline.id} (status=${baseline.status})`,
    );
  }

  // Group blocks into chapters (8 chapters from 15 blocks).
  const chapterMap = new Map<string, ContentBlock[]>();
  for (const block of CONTENT_BLOCKS) {
    const list = chapterMap.get(block.chapter) ?? [];
    list.push(block);
    chapterMap.set(block.chapter, list);
  }

  const chapters: CompiledChapter[] = [];
  const chapterCoverage: Record<string, ChapterCoverage> = {};

  for (const [chapterId, blocks] of chapterMap) {
    const required = blocks.some((b) => b.required);
    // Source count = max coverage across the chapter's typed blocks; aggregate
    // blocks (entityType null) fall back to total item count.
    const sourceCount = Math.max(
      ...blocks.map((b) => countByEntityType(items, b.entityType)),
    );
    let status: 'complete' | 'partial' | 'missing';
    let missingReason: string | null = null;
    if (sourceCount === 0) {
      status = required ? 'missing' : 'complete';
      missingReason = required ? '该章节缺少来源数据' : null;
    } else {
      status = 'complete';
    }

    chapters.push({
      id: chapterId,
      title: CHAPTER_TITLES[chapterId] ?? chapterId,
      required,
      blocks: blocks.map((b) => b.code),
      sourceCount,
      status,
      missingReason,
    });
    chapterCoverage[chapterId] = {
      status,
      required,
      source_count: sourceCount,
      missing_reason: missingReason,
    };
  }

  // Report input schema hash: digest of the block contract (stable).
  const reportInputSchemaHash =
    'sha256:' +
    createHash('sha256')
      .update(JSON.stringify(CONTENT_BLOCKS.map((b) => [b.code, b.chapter, b.required])))
      .digest('hex');

  // Gate defects: a required chapter with no source data is a blocking defect.
  const gateDefects: GateDefect[] = chapters
    .filter((c) => c.required && c.status === 'missing')
    .map((c) => ({
      gate_code: 'chapter_coverage',
      severity: 'blocking' as const,
      blocking: true,
      message: `章节「${c.title}」缺少来源数据`,
      entity_refs: c.blocks,
      resolution_hint: `为 ${c.blocks.join(', ')} 补充实体版本后重新编译`,
    }));

  const html = renderHtml(baseline, chapters, domainConfig);

  return {
    dataHash: baseline.dataHash,
    reportInputSchemaHash,
    coreSchemaVersion: CORE_SCHEMA_VERSION,
    compilerVersion: COMPILER_VERSION,
    chapters,
    chapterCoverage,
    html,
    gateDefects,
  };
}

function renderHtml(
  baseline: Baseline,
  chapters: CompiledChapter[],
  domainConfig: DomainConfig,
): string {
  const body = chapters
    .map((c) => {
      const blocks = c.blocks
        .map((b) => `      <section class="block" data-block="${b}"><h3>${b}</h3></section>`)
        .join('\n');
      return `    <chapter id="${c.id}" data-status="${c.status}">
      <h2>${c.title}</h2>
${blocks}
    </chapter>`;
    })
    .join('\n');
  return `<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>ReqClinic Report — baseline ${baseline.baselineVersion}</title>
    <meta name="generator" content="${COMPILER_VERSION}" />
    <meta name="data-hash" content="${baseline.dataHash}" />
    <meta name="domain-profile" content="${domainConfig.domainProfileId}@${domainConfig.domainProfileVersion}" />
  </head>
  <body>
${body}
  </body>
</html>`;
}

/**
 * Synthesize a deterministic PDF byte stream for a released report.
 *
 * Stage B has no real renderer; this produces a minimal valid `%PDF-1.4`
 * stub whose bytes are a pure function of the report's data hash and version,
 * so `downloadReport` can regenerate the exact stream that was hashed at
 * release time without persisting the file content.
 */
export function synthesizeReportPdf(report: {
  dataHash: string;
  reportVersion: number;
}): Buffer {
  const body = `%PDF-1.4\n% ReqClinic report v${report.reportVersion}\n% data-hash: ${report.dataHash}\n%%EOF\n`;
  return Buffer.from(body, 'utf-8');
}

/** SHA-256 of a buffer, prefixed with `sha256:`. */
export function sha256Of(buf: Buffer): string {
  return 'sha256:' + createHash('sha256').update(buf).digest('hex');
}
