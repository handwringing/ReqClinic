// Fixture 加载器。
// Fixture JSON 文件由另一个并行任务创建，可能在运行 tsc 时尚未存在。
// 使用动态 require（路径含变量）避免 tsc 静态模块解析失败；运行时若文件缺失则回退到 null。

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const cache = new Map<string, unknown>();

/**
 * 按目录与文件名加载 fixture。路径含变量，tsc 不会静态解析。
 * 返回 null 表示 fixture 尚未创建，调用方应回退到生成式默认数据。
 */
export function loadFixture(folder: string, file: string): any {
  const key = `${folder}/${file}`;
  if (cache.has(key)) return cache.get(key);
  let data: any = null;
  if (typeof require !== 'undefined') {
    try {
      data = require('../../fixtures/' + folder + '/' + file);
    } catch {
      data = null;
    }
  }
  cache.set(key, data);
  return data;
}

/** 智能海报网站案例 fixture（快速问诊案例路径）。 */
export function aiPosterFixture(): any {
  const scenario = loadFixture('ai-poster-website', 'scenario.json');
  const qa = loadFixture('ai-poster-website', 'clarifying-qa.json');
  const understanding = loadFixture('ai-poster-website', 'understanding.json');
  const unknowns = loadFixture('ai-poster-website', 'unknowns.json');
  const options = loadFixture('ai-poster-website', 'options.json');
  const simple = loadFixture('ai-poster-website', 'brief-simple.json');
  const exec = loadFixture('ai-poster-website', 'brief-exec.json');

  const briefViews = {
    simple,
    exec,
  };
  const generatedAt =
    simple?.generated_at ??
    exec?.generated_at;

  return {
    ...scenario,
    messages: qa?.turns ?? [],
    understanding,
    coverage: understanding?.coverage_slots,
    unknowns: [
      ...(unknowns?.blocking_unknowns ?? []),
      ...(unknowns?.non_blocking_unknowns ?? []),
    ],
    options: options?.options ?? [],
    brief_versions: generatedAt
      ? [
          {
            version: simple?.brief_version ?? 1,
            session_id: scenario?.session?.id ?? scenario?.session_id,
            generated_at: generatedAt,
            is_incomplete: simple?.is_incomplete ?? false,
            blocking_unknowns_count: simple?.blocking_unknowns_count ?? 0,
            non_blocking_unknowns_count: simple?.non_blocking_unknowns_count ?? 0,
          },
        ]
      : [],
    brief_views: briefViews,
  };
}

/** Aster 访客通行正式项目 fixture。 */
export function asterFixture(): any {
  return loadFixture('aster-visitor-access', 'scenario.json');
}

/** 表达训练案例 fixture。 */
export function trainingFixture(): any {
  return loadFixture('training', 'cases.json');
}
