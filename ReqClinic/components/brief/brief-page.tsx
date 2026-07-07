'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiClient } from '@/lib/api';
import { ApiClientError } from '@/lib/api/errors';
import type { BriefVersion, BriefView } from '@/lib/api/types';
import {
  ErrorState,
  ToastProvider,
  useToast,
} from '@/components/ui';
import { AppBackground } from '@/components/layout/app-background';
import { buildQuickDemoFixture, getQuickDemoCase } from '@/lib/quick-demo-cases';
import { BriefTopbar } from './brief-topbar';
import { BriefViews } from './brief-views';
import { BriefContent } from './brief-content';

interface BriefPageProps {
  sessionId: string;
}

// 默认展示标题（对应 sample 案例）
const DEFAULT_TITLE = '智能海报生成网站';

const FALLBACK_LATEST_VERSION = 1;
const QUICK_SAMPLE_PREFIX = 'quick-sample-';

function sourceCaseIdFromStaticSession(sessionId: string): string | null {
  return sessionId.startsWith(QUICK_SAMPLE_PREFIX)
    ? sessionId.slice(QUICK_SAMPLE_PREFIX.length)
    : null;
}

function buildInitialBriefState(sessionId: string): {
  briefVersion: BriefVersion;
  versions: BriefVersion[];
  title: string;
  exportContent: string;
  sourceCaseId: string;
} | null {
  const sourceCaseId = sourceCaseIdFromStaticSession(sessionId);
  if (!sourceCaseId) return null;

  const fixture = buildQuickDemoFixture(sourceCaseId);
  const version = fixture.brief_versions[0];
  const execView = fixture.brief_views.exec as BriefView | undefined;
  if (!version) return null;

  const briefVersion: BriefVersion = {
    ...version,
    session_id: sessionId,
  };

  return {
    briefVersion,
    versions: [briefVersion],
    title: fixture.title,
    exportContent: formatBriefViewForExport(execView ?? null),
    sourceCaseId,
  };
}

function formatBriefViewForExport(view: BriefView | null): string {
  if (!view) return '';
  const sections = view.sections ?? [];
  const sectionText = sections
    .map((section) => `## ${section.title}\n\n${section.content}`)
    .join('\n\n');
  const content = view.content?.trim() ?? '';
  if (view.view_type === 'exec' && sectionText.trim()) {
    return [content, sectionText].filter(Boolean).join('\n\n');
  }
  return content || sectionText;
}

export function BriefPage({ sessionId }: BriefPageProps) {
  return (
    <ToastProvider>
      <BriefPageInner sessionId={sessionId} />
    </ToastProvider>
  );
}

function BriefPageInner({ sessionId }: BriefPageProps) {
  const router = useRouter();
  const initialBrief = buildInitialBriefState(sessionId);
  const hasInitialBrief = initialBrief !== null;
  const [briefVersion, setBriefVersion] = useState<BriefVersion | null>(initialBrief?.briefVersion ?? null);
  const [versions, setVersions] = useState<BriefVersion[]>(initialBrief?.versions ?? []);
  const [currentVersion, setCurrentVersion] = useState<number>(FALLBACK_LATEST_VERSION);
  const [briefTitle, setBriefTitle] = useState(initialBrief?.title ?? DEFAULT_TITLE);
  const [quickSessionVersion, setQuickSessionVersion] = useState(1);
  const [isSampleSession, setIsSampleSession] = useState(initialBrief !== null);
  const [sourceCaseId, setSourceCaseId] = useState<string | null>(initialBrief?.sourceCaseId ?? null);
  const [exportContent, setExportContent] = useState<string>(initialBrief?.exportContent ?? '');
  const [loading, setLoading] = useState(initialBrief === null);
  const [upgrading, setUpgrading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const requestIdRef = useRef<string | undefined>(undefined);
  const { showToast } = useToast();

  const loadBrief = useCallback(
    async (version?: number) => {
      if (!hasInitialBrief) setLoading(true);
      setError(null);
      try {
        const api = getApiClient();
        // 1. 获取版本列表和当前会话标题
        const [versionList, currentSession] = await Promise.all([
          api.listQuickSessionBriefVersions(sessionId),
          api.getQuickSession(sessionId).catch(() => null),
        ]);
        setVersions(versionList);
        if (currentSession) {
          setQuickSessionVersion(currentSession.version ?? 1);
          setIsSampleSession(currentSession.source_kind === 'sample');
          setSourceCaseId(currentSession.source_case_id ?? null);
          setBriefTitle(
            getQuickDemoCase(currentSession.source_case_id)?.title ??
              currentSession.original_input ??
              DEFAULT_TITLE,
          );
        } else {
          setIsSampleSession(false);
          setSourceCaseId(null);
        }

        // 2. 确定最新版本
        let latestVersion: number;
        if (versionList.length > 0) {
          latestVersion = versionList.reduce(
            (max, v) => Math.max(max, v.version),
            0,
          );
        } else {
          latestVersion = FALLBACK_LATEST_VERSION;
        }
        const targetVersion = version ?? latestVersion;
        setCurrentVersion(targetVersion);

        // 3. 获取简报元数据
        const [brief, detailView] = await Promise.all([
          api.getQuickSessionBriefVersion(
            sessionId,
            targetVersion,
          ),
          api.getBriefView({
            session_id: sessionId,
            brief_version: targetVersion,
            view_type: 'exec',
          }).catch(() => null),
        ]);
        setBriefVersion(brief);
        setExportContent(formatBriefViewForExport(detailView));
      } catch (e) {
        const err = e as Error & { requestId?: string };
        requestIdRef.current = err.requestId;
        setError(err);
      } finally {
        setLoading(false);
      }
    },
    [hasInitialBrief, sessionId],
  );

  useEffect(() => {
    void loadBrief();
  }, [loadBrief]);

  // 导出始终使用“详细报告”，避免概述页和下载内容不一致。
  const handleViewDataChange = useCallback((view: BriefView) => {
    if (view.view_type !== 'exec') return;
    setExportContent(formatBriefViewForExport(view));
  }, []);

  const handleVersionChange = (version: number) => {
    if (version === currentVersion) return;
    void loadBrief(version);
  };

  const handleUpgrade = async () => {
    if (upgrading) return;
    setUpgrading(true);
    try {
      const result = await getApiClient().upgradeQuickSession({
        session_id: sessionId,
        title: briefTitle,
        brief_version: currentVersion,
        expected_quick_session_version: quickSessionVersion,
        source_kind: isSampleSession ? 'sample' : 'quick_upgrade',
        source_case_id: sourceCaseId,
      });
      if (result.project_id) {
        router.push(`/formal/${result.project_id}?source=${isSampleSession ? 'sample' : 'quick_upgrade'}`);
        return;
      }
      showToast({
        type: 'info',
        title: '正在生成正式项目地图',
        description: '稍后进入正式项目工作台继续深化。',
      });
    } catch (e) {
      const err = e as Error;
      if (e instanceof ApiClientError && e.code === 'VERSION_CONFLICT') {
        showToast({
          type: 'info',
          title: '简报内容刚刚更新',
          description: '我已重新读取最新内容，你可以再点击一次升级正式项目。',
        });
        await loadBrief();
        return;
      }
      showToast({
        type: 'error',
        title: '升级暂时没有完成',
        description: err.message || '请稍后重试，或先继续查看当前简报。',
      });
    } finally {
      setUpgrading(false);
    }
  };

  if (loading && !briefVersion) {
    return (
      <div className="app-content">
        <AppBackground />
        <div className="app-state-box" style={{ minHeight: '100vh' }}>
          <Loader2 className="h-5 w-5 animate-spin icon" strokeWidth={1.5} />
          <span className="desc">正在加载简报…</span>
        </div>
      </div>
    );
  }

  if (error && !briefVersion) {
    return (
      <div className="app-content">
        <AppBackground />
        <div className="app-state-box" style={{ minHeight: '100vh' }}>
          <ErrorState
            title="简报加载失败"
            description={error.message}
            requestId={requestIdRef.current}
            onRetry={() => void loadBrief()}
          />
        </div>
      </div>
    );
  }

  if (!briefVersion) {
    return null;
  }

  return (
    <div className="app-content">
      <AppBackground />

      <BriefTopbar
        title={briefTitle}
        version={currentVersion}
        generatedAt={briefVersion.generated_at}
        status={briefVersion.is_incomplete ? 'draft' : 'ready'}
        sessionId={sessionId}
        briefContent={exportContent}
        onUpgrade={handleUpgrade}
        upgradePending={upgrading}
        isSampleSession={isSampleSession}
      />

      {briefVersion.is_incomplete && (
        <div
          role="alert"
          className="app-chip app-chip-rose"
          style={{
            display: 'flex',
            width: '100%',
            borderRadius: 0,
            padding: '10px 40px',
            justifyContent: 'flex-start',
            gap: 8,
          }}
        >
          <AlertTriangle
            className="h-4 w-4 shrink-0"
            strokeWidth={1.5}
            aria-hidden="true"
          />
          <span style={{ fontSize: 13, fontWeight: 500, letterSpacing: '0.02em' }}>
            当前简报还缺关键信息，建议补齐后再导出或用于沟通。
          </span>
        </div>
      )}

      <main
        className="mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-10"
        style={{ maxWidth: 'var(--content-max-width)' }}
      >
        <BriefViews
          sessionId={sessionId}
          version={currentVersion}
          onViewDataChange={handleViewDataChange}
        />

        <BriefContent
          sessionId={sessionId}
          briefVersion={briefVersion}
          versions={versions}
          currentVersion={currentVersion}
          onVersionChange={handleVersionChange}
          demoFlowCompleted={isSampleSession && !briefVersion.is_incomplete}
        />
      </main>
    </div>
  );
}
