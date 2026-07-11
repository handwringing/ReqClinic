import type { MockRouteRegistry } from '../registry';
import type { MockSessionStore } from '../session-store';
import type { UUID, Baseline, ReportSnapshot, PaginatedResponse } from '@/lib/api/types';
import { generateUUID } from '@/lib/utils/id';
import { ApiClientError, ErrorCodes } from '@/lib/api/errors';
import { asterFixture } from './_fixtures';

// 基线与报告 Mock：基线创建/批准、报告编译（异步）、获取/发布/下载。

const DEFAULT_REPORT_CHAPTERS = [
  '执行摘要',
  '背景与目标',
  '利益相关方',
  '范围与边界',
  '成果与驱动',
  '需求清单',
  '验收标准',
  '冲突与决策',
  '关口评审',
  '风险与约束',
  '领域画像',
  '变更影响',
];

function getBaselines(store: MockSessionStore): Baseline[] {
  return store.get<Baseline[]>('baselines') ?? [];
}
function setBaselines(store: MockSessionStore, baselines: Baseline[]): void {
  store.set('baselines', baselines);
}

function getReports(store: MockSessionStore): ReportSnapshot[] {
  return store.get<ReportSnapshot[]>('reports') ?? [];
}
function setReports(store: MockSessionStore, reports: ReportSnapshot[]): void {
  store.set('reports', reports);
}

function fxReport(id: UUID): ReportSnapshot | null {
  const fx = asterFixture();
  const fxReport = fx?.report;
  const chapters =
    fxReport?.chapters ??
    DEFAULT_REPORT_CHAPTERS.map((title, i) => ({
      index: i + 1,
      title,
      content: `第${i + 1}章 ${title}：详见 Aster 访客通行项目基线内容。`,
    }));
  return {
    id,
    project_id: fxReport?.project_id ?? '00000000-0000-4000-8000-000000000100',
    report_number: fxReport?.report_number ?? 'RR-2026-001',
    version: fxReport?.version ?? 1,
    audience: fxReport?.audience ?? 'management',
    status: fxReport?.status ?? 'ready',
    data_fingerprint: fxReport?.data_fingerprint ?? 'sha256:mock-fingerprint',
    template_version: fxReport?.template_version ?? '2026.07.01',
    domain_profile_version: fxReport?.domain_profile_version,
    chapters,
    gate_defects: fxReport?.gate_defects ?? [],
    chapter_coverage: fxReport?.chapter_coverage ?? 1,
    compiled_at: fxReport?.compiled_at ?? new Date().toISOString(),
  };
}

export function registerReportHandlers(registry: MockRouteRegistry, store: MockSessionStore): void {
  registry.register('listBaselines', async (request: { project_id: UUID }) => {
    const local = getBaselines(store).filter((b) => b.project_id === request.project_id);
    return local;
  });

  registry.register('createBaseline', async (request: { project_id: UUID }) => {
    const baselines = getBaselines(store);
    const version = baselines.filter((b) => b.project_id === request.project_id).length + 1;
    const baseline: Baseline = {
      id: generateUUID(),
      project_id: request.project_id,
      version,
      created_at: new Date().toISOString(),
      status: 'draft',
    };
    baselines.push(baseline);
    setBaselines(store, baselines);
    return baseline;
  });

  registry.register(
    'approveBaseline',
    async (request: { id: UUID; expected_version: number }) => {
      const baselines = getBaselines(store);
      const idx = baselines.findIndex((b) => b.id === request.id);
      if (idx < 0) {
        throw new ApiClientError(404, 'NOT_FOUND', '基线不存在', generateUUID());
      }
      if (baselines[idx].version !== request.expected_version) {
        throw new ApiClientError(409, 'VERSION_CONFLICT', '版本冲突', generateUUID());
      }
      baselines[idx] = {
        ...baselines[idx],
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: '00000000-0000-4000-8000-000000000099',
      };
      setBaselines(store, baselines);
      return baselines[idx];
    }
  );

  registry.register('compileReport', async () => {
    return { job_id: generateUUID(), status: 'accepted' as const };
  });

  registry.register(
    'listReports',
    async (request: { project_id: UUID; limit?: number; offset?: number }) => {
      let reports = getReports(store).filter((r) => r.project_id === request.project_id);
      if (reports.length === 0) {
        const fx = fxReport(generateUUID());
        if (fx) reports = [fx];
      }
      const limit = request.limit ?? 20;
      const offset = request.offset ?? 0;
      const items = reports.slice(offset, offset + limit);
      return { items, total: reports.length, limit, offset } as PaginatedResponse<ReportSnapshot>;
    }
  );

  registry.register('getReport', async (request: { id: UUID }) => {
    const local = getReports(store).find((r) => r.id === request.id);
    if (local) return local;
    const fx = fxReport(request.id);
    if (fx) return fx;
    throw new ApiClientError(404, 'NOT_FOUND', '报告不存在', generateUUID());
  });

  registry.register(
    'releaseReport',
    async (request: { id: UUID; expected_version: number }) => {
      const reports = getReports(store);
      const idx = reports.findIndex((r) => r.id === request.id);
      let report: ReportSnapshot;
      if (idx >= 0) {
        report = reports[idx];
        if (report.version !== request.expected_version) {
          throw new ApiClientError(409, 'VERSION_CONFLICT', '版本冲突', generateUUID());
        }
      } else {
        const fx = fxReport(request.id);
        if (!fx) {
          throw new ApiClientError(404, 'NOT_FOUND', '报告不存在', generateUUID());
        }
        report = fx;
        reports.push(report);
      }
      // 门禁检查：若存在 blocking 缺陷则拒绝发布。
      const hasBlocking = report.gate_defects.some((d) => d.status === 'fail' && d.gate.startsWith('G'));
      if (hasBlocking) {
        throw new ApiClientError(
          409,
          ErrorCodes.BLOCKING_CONFLICT,
          '还有关键门禁问题未处理，暂时无法发布报告',
          generateUUID()
        );
      }
      report.status = 'released';
      report.released_at = new Date().toISOString();
      setReports(store, reports);
      return report;
    }
  );

  registry.register('downloadReport', async (request: { id: UUID; format: string }) => {
    const content = `# Aster 访客通行需求报告（${request.format.toUpperCase()}）\n报告 ID：${request.id}\n由需求问诊室生成。`;
    const encoded =
      typeof btoa !== 'undefined'
        ? btoa(unescape(encodeURIComponent(content)))
        : Buffer.from(content).toString('base64');
    return { download_url: `data:text/plain;charset=utf-8;base64,${encoded}` };
  });

  registry.register('downloadProjectReport', async (request: { project_id: UUID; report_id: UUID }) => {
    const content = `# 项目 ${request.project_id} 需求报告\n报告 ID：${request.report_id}\n由需求问诊室生成。`;
    const encoded =
      typeof btoa !== 'undefined'
        ? btoa(unescape(encodeURIComponent(content)))
        : Buffer.from(content).toString('base64');
    return `data:application/pdf;base64,${encoded}`;
  });
}
