'use client';

import { ArrowLeft, FileText, PlayCircle, SendHorizontal, Sparkles, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { ProductBrandText } from '@/components/common/product-brand';
import { AppBackground } from '@/components/layout/app-background';
import { getApiClient } from '@/lib/api';
import { hasModelApiAccess, looksLikeRequirementInput, REQUIREMENT_INPUT_HINT } from '@/lib/intake-guards';
import { PRODUCT_TERMS } from '@/lib/product-language';

const FORMAL_DEMO_CASES = [
  {
    id: 'aster',
    label: '园区访客通行',
    title: '园区访客预约与通行',
    badge: '参考案例',
    description:
      '园区希望替代纸质访客登记。访客提前预约后，到现场用凭证码扫码通行；安保需要能核验、处理异常并留下记录。项目计划在下个月峰会前上线第一版。',
    roles: '园区运营负责人：确认目标与上线范围；安保主管：确认现场流程；前台行政：提供访客登记材料',
    materials: '现有纸质登记表、峰会访客流程说明、安保访谈纪要',
    constraints: '第一版必须覆盖 3 个出入口；人脸识别不进入第一版；峰会前需要可演示版本',
  },
  {
    id: 'outsourcing',
    label: '企业官网外包',
    title: '企业官网外包采购',
    badge: '参考案例',
    description:
      '公司计划找外包团队重做企业官网。官网需要展示产品、案例、公司介绍并收集客户线索；希望在签约前把工作范围、交付物、验收标准和排除项说清楚，减少返工和报价争议。',
    roles: '市场负责人：确认品牌与内容；销售负责人：确认线索表单；外包项目经理：确认交付计划；法务：确认合同边界',
    materials: '旧官网链接、品牌手册、产品介绍文档、3 个标杆官网链接',
    constraints: '首版 6 周内上线；文案由甲方提供；不包含拍摄、品牌重做、长期运维和会员系统',
  },
  {
    id: 'capstone',
    label: '多人毕业设计',
    title: '智能面试助手毕业设计',
    badge: '参考案例',
    description:
      '三人小组要做一个智能面试助手毕业设计，目标是在答辩时展示可运行系统。第一版需要覆盖模拟面试、回答记录、评分反馈和答辩说明，但不能采集真实面试数据。',
    roles: '组长：范围和答辩材料；前端同学：交互与页面；后端同学：接口与数据库；算法同学：模型调用与评分提示词；指导老师：关键节点确认',
    materials: '开题报告、课程要求、答辩评分标准、竞品截图',
    constraints: '中期检查前完成闭环演示；不做录音；演示数据必须脱敏或模拟；模型成本需要可控',
  },
];

export function FormalNewPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [roles, setRoles] = useState('');
  const [materials, setMaterials] = useState('');
  const [constraints, setConstraints] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [launchingDemoId, setLaunchingDemoId] = useState<string | null>(null);
  const [errorText, setErrorText] = useState('');
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const demoPanelRef = useRef<HTMLElement | null>(null);

  const generatedTitle = useMemo(() => {
    const text = description.trim();
    if (!text) return '待命名项目';
    return text.length > 18 ? `${text.slice(0, 18)}...` : text;
  }, [description]);

  const createProject = async () => {
    const cleanDescription = description.trim();
    if (submitting) return;
    if (!cleanDescription) {
      setErrorText('先写一段项目描述，说明要做什么和第一版交付给谁。');
      return;
    }
    setSubmitting(true);
    setErrorText('');
    let keepSubmitting = false;
    try {
      const modelReady = await hasModelApiAccess();
      if (!modelReady) {
        setModelDialogOpen(true);
        return;
      }
      if (!looksLikeRequirementInput(cleanDescription)) {
        setErrorText(REQUIREMENT_INPUT_HINT);
        return;
      }
      const api = getApiClient();
      const accepted = await api.createProject({
        title: title.trim() || generatedTitle,
        initial_request: [
          cleanDescription,
          roles.trim() ? `相关人员：${roles.trim()}` : '',
          materials.trim() ? `已有材料：${materials.trim()}` : '',
          constraints.trim() ? `约束：${constraints.trim()}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        description: cleanDescription,
        candidate_roles: roles.trim()
          ? roles.split(/[；;\n]/).map((item) => item.trim()).filter(Boolean)
          : [],
        candidate_constraints: constraints.trim()
          ? constraints.split(/[；;\n]/).map((item) => item.trim()).filter(Boolean)
          : [],
        source_kind: 'custom',
      });
      const projectId = accepted.project_id ?? accepted.job_id;
      keepSubmitting = true;
      router.push(`/formal/${projectId}`);
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : '创建项目失败');
    } finally {
      if (!keepSubmitting) setSubmitting(false);
    }
  };

  const startDemoProject = async (demo: (typeof FORMAL_DEMO_CASES)[number]) => {
    if (launchingDemoId !== null) return;
    setLaunchingDemoId(demo.id);
    setErrorText('');
    try {
      const accepted = await getApiClient().createProject({
        title: demo.title,
        initial_request: [
          demo.description,
          `相关人员：${demo.roles}`,
          `已有材料：${demo.materials}`,
          `约束：${demo.constraints}`,
        ].join('\n'),
        description: demo.description,
        candidate_roles: demo.roles.split(/[；;\n]/).map((item) => item.trim()).filter(Boolean),
        candidate_constraints: demo.constraints.split(/[；;\n]/).map((item) => item.trim()).filter(Boolean),
        source_kind: 'sample',
        source_case_id: demo.id,
      });
      const projectId = accepted.project_id ?? accepted.job_id;
      router.push(`/formal/${projectId}?source=sample`);
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : '打开示例失败');
      setLaunchingDemoId(null);
    }
  };

  const scrollToExamples = () => {
    setModelDialogOpen(false);
    demoPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="formal-entry-page" style={{ position: 'relative', minHeight: '100vh' }}>
      <AppBackground />
      <header className="app-topbar">
        <div className="brand-mark" style={{ gap: 12 }}>
          <button
            type="button"
            className="app-nav-back"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            返回
          </button>
          <span
            aria-hidden="true"
            style={{ width: 1, height: 16, background: 'var(--aurora-hair-strong)' }}
          />
          <button
            type="button"
            className="brand-mark brand-home-link"
            onClick={() => router.push('/')}
            aria-label="返回首页"
          >
            <span className="dot" />
            <ProductBrandText />
          </button>
        </div>
        <div aria-hidden="true" />
      </header>

      <main className="app-content app-mode-stage">
        <div className="formal-entry-layout">
        <section className="app-mode-dialog formal-entry-form" aria-label="项目起点输入">
          <div className="app-mode-dialog-head">
            <div className="app-label" style={{ justifyContent: 'center', marginBottom: 12 }}>
              <FileText className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              项目起点输入
            </div>
            <h1 className="app-title app-title-lg">
              进入<span className="accent">需求地图</span>
            </h1>
            <p
              style={{
                marginTop: 10,
                color: 'var(--aurora-ink-soft)',
                fontSize: 14,
                lineHeight: 1.7,
              }}
            >
              先写下项目背景、参与人员、已有材料和限制。进入工作台后，问诊助手会围绕需求地图继续追问，不需要一次写完整。
            </p>
          </div>

          <div className="app-form-stack">
            <label className="app-form-stack">
              <span className="app-label">
                项目描述 <span className="req">*</span>
              </span>
              <textarea
                className="app-textarea"
                name="project_description"
                aria-label="项目描述"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={5}
                placeholder="用几句话说明项目要做什么、背景是什么、第一版大致要交付给谁。"
                style={{ minHeight: 132 }}
              />
            </label>

            <div className="app-form-grid">
              <label className="app-form-stack">
                <span className="app-label">项目名称</span>
                <input
                  className="app-input"
                  name="project_title"
                  aria-label="项目名称"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="可留空，由系统按描述生成候选名称。"
                />
              </label>
              <label className="app-form-stack">
                <span className="app-label">
                  <Users className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
                  相关人员 / 角色
                </span>
                <textarea
                  className="app-textarea"
                  name="project_roles"
                  aria-label="相关人员 / 角色"
                  value={roles}
                  onChange={(event) => setRoles(event.target.value)}
                  rows={3}
                  placeholder="角色、姓名或组织、责任、确认人。可按分号或换行分开。"
                  style={{ minHeight: 92 }}
                />
              </label>
            </div>

            <div className="app-form-grid">
              <label className="app-form-stack">
                <span className="app-label">已有材料</span>
                <textarea
                  className="app-textarea"
                  name="project_materials"
                  aria-label="已有材料"
                  value={materials}
                  onChange={(event) => setMaterials(event.target.value)}
                  rows={3}
                  placeholder="文件名、链接、会议纪要或已有说明。"
                  style={{ minHeight: 92 }}
                />
              </label>
              <label className="app-form-stack">
                <span className="app-label">项目约束</span>
                <textarea
                  className="app-textarea"
                  name="project_constraints"
                  aria-label="项目约束"
                  value={constraints}
                  onChange={(event) => setConstraints(event.target.value)}
                  rows={3}
                  placeholder="时间、预算、合规、技术、范围说明。"
                  style={{ minHeight: 92 }}
                />
              </label>
            </div>

            {errorText && (
              <div
                role="alert"
                className="app-chip app-chip-rose"
                style={{ alignSelf: 'flex-start', borderRadius: 4, padding: '8px 12px' }}
              >
                {errorText}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="app-label">进入后由问诊助手继续拆解需求地图</span>
              <button
                type="button"
                className="app-btn-primary"
                disabled={submitting}
                onClick={() => void createProject()}
                aria-busy={submitting || undefined}
              >
                <SendHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                {submitting ? '正在进入...' : '创建项目'}
              </button>
            </div>

            <div className="app-token-row" aria-label="工作台说明">
              <span className="inline-reference-token">
                <Sparkles className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
                <span className="inline-reference-token__label">助手会在工作台继续追问</span>
              </span>
              <span className="inline-reference-token">
                <FileText className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
                <span className="inline-reference-token__label">当前说明后续还能调整</span>
              </span>
            </div>
          </div>
        </section>

        <section ref={demoPanelRef} className="formal-demo-panel" aria-label="正式项目参考案例">
          <div>
            <div className="app-label" style={{ marginBottom: 10 }}>
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              参考案例
            </div>
            <h2 className="app-title app-title-md">查看参考工作台</h2>
            <p className="formal-demo-panel__desc">
              直接查看一份已经整理好的需求地图，快速了解正式项目工作台的分析方式。
            </p>
          </div>

          <div className="formal-demo-list">
            {FORMAL_DEMO_CASES.map((demo) => {
              const isBusy = launchingDemoId === demo.id;
              return (
                <button
                  key={demo.id}
                  type="button"
                  className="app-card app-card-pad formal-demo-card"
                  disabled={launchingDemoId !== null}
                  onClick={() => void startDemoProject(demo)}
                >
                  <div>
                    <div className="app-token-row" style={{ marginBottom: 12 }}>
                      <span className="app-chip app-chip-muted">{demo.badge}</span>
                      <span className="app-chip">{demo.label}</span>
                    </div>
                    <h3 className="app-title app-title-sm">{demo.title}</h3>
                    <p>{demo.description}</p>
                  </div>
                  <span className="formal-demo-card__action">
                    <PlayCircle className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                    {isBusy ? '正在打开...' : '打开示例'}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
        </div>
      </main>

      {modelDialogOpen && (
        <div className="model-key-modal" role="dialog" aria-modal="true" aria-labelledby="formal-model-title">
          <div className="model-key-panel">
            <div className="model-key-kicker">{PRODUCT_TERMS.modelUnavailableKicker}</div>
            <h2 id="formal-model-title">暂时不能创建自定义正式项目</h2>
            <p>
              当前环境还没有可用的模型服务，暂时不能从你输入的内容生成需求地图。你可以先查看参考案例，了解正式项目工作台的分析方式。
            </p>
            <div className="model-key-actions">
              <button type="button" className="model-key-secondary" onClick={() => setModelDialogOpen(false)}>
                留在这里
              </button>
              <button type="button" className="model-key-primary" onClick={scrollToExamples}>
                {PRODUCT_TERMS.viewExamples}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
