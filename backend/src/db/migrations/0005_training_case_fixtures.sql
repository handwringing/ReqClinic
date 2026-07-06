INSERT OR REPLACE INTO `training_cases` (
  `id`, `case_id`, `version`, `title`, `difficulty`,
  `scenario_json`, `disclosure_rules_json`, `rubric_json`, `status`, `created_at`
) VALUES (
  'tcase_expr_conv_rate_v1',
  'conv_rate',
  '1',
  '提升转化率的运营诉求访谈',
  'easy',
  '{"category":"运营指标","description":"某电商团队提出要提升首页访客到下单的转化率。你需要通过追问确认指标口径、目标幅度、责任人、适用场景和验收方式。","role_label":"运营负责人","practice_goal":"练习把宽泛的增长诉求问成可衡量、可验收的指标目标。","visible_constraints":["对方不会主动说明指标口径","对方不会主动说明责任分工"],"persona":{"role":"运营负责人","communication_style":"务实、回答简短","knowledge_level":"熟悉业务指标但不会主动展开需求边界"}}',
  '[{"id":"rule_metric","trigger_intent":"询问指标定义或衡量口径","allowed_answer":"我们主要看首页访客最终完成下单的比例，也就是首页访客到下单的转化率。","related_fact_ids":["metric"]},{"id":"rule_target","trigger_intent":"询问目标数值、时间范围或优先级","allowed_answer":"希望 8 周内从 2.8% 提升到 3.3%，但老板更关心新客首单。","related_fact_ids":["target"]},{"id":"rule_owner","trigger_intent":"询问负责人、协作方或确认人","allowed_answer":"运营负责人确认目标，商品、设计和数据同学都要配合。","related_fact_ids":["owner"]},{"id":"rule_boundary","trigger_intent":"询问统计边界、排除项或不做范围","allowed_answer":"暂时不改支付链路，不把异常流量、退款订单和员工测试订单计入转化。","related_fact_ids":["boundary"]},{"id":"rule_acceptance","trigger_intent":"询问验收方式或数据来源","allowed_answer":"以数据看板的周报为准，连续两周达到 3.3% 才算有效。","related_fact_ids":["acceptance"]}]',
  '{"evaluation_dimensions":["目标","对象","场景","边界","验收"],"rubric":[{"dimension":"目标","max_score":20,"evidence_rule":"问清指标定义、目标数值、时间范围或优先级。"},{"dimension":"对象","max_score":20,"evidence_rule":"问清责任人、确认人和协作方。"},{"dimension":"场景","max_score":20,"evidence_rule":"问清首页访客、首单、新老客或关键流量来源。"},{"dimension":"边界","max_score":20,"evidence_rule":"问清不改范围、排除项和统计边界。"},{"dimension":"验收","max_score":20,"evidence_rule":"问清数据来源、验收周期和达成标准。"}]}',
  'active',
  '2026-07-05T00:00:00.000Z'
);
--> statement-breakpoint
INSERT OR REPLACE INTO `training_cases` (
  `id`, `case_id`, `version`, `title`, `difficulty`,
  `scenario_json`, `disclosure_rules_json`, `rubric_json`, `status`, `created_at`
) VALUES (
  'tcase_expr_renewal_flow_v1',
  'renewal_flow',
  '1',
  '会员续费流程优化访谈',
  'medium',
  '{"category":"服务流程","description":"一家健身房的会员续费率持续下降。你需要追问前台、顾问、教练和店长在到期前后的触点分工，定位最影响续费的流程断点。","role_label":"会员运营负责人","practice_goal":"练习把流程问题问清楚，覆盖触点、责任、例外情况和完成标准。","visible_constraints":["对方不会主动说明各岗位分工","对方不会主动说明流失节点"],"persona":{"role":"会员运营负责人","communication_style":"偏业务口语，愿意给流程细节","knowledge_level":"了解门店流程但不熟悉系统设计"}}',
  '[{"id":"rule_goal","trigger_intent":"询问目标或当前问题指标","allowed_answer":"我们希望把到期会员 30 天内续费率从 42% 提到 50%。","related_fact_ids":["goal"]},{"id":"rule_touchpoint","trigger_intent":"询问会员在哪些触点流失或停止回应","allowed_answer":"最多问题出在到期前 14 天提醒后，顾问跟进不稳定，教练也没有及时补充训练反馈。","related_fact_ids":["touchpoint"]},{"id":"rule_roles","trigger_intent":"询问前台、顾问、教练、店长分工","allowed_answer":"前台负责提醒，顾问负责报价和沟通，教练补充训练反馈，店长只看最终转化。","related_fact_ids":["roles"]},{"id":"rule_boundary","trigger_intent":"询问不做范围或流程边界","allowed_answer":"第一版不做新会员拉新，也不改薪酬规则，只梳理续费跟进流程。","related_fact_ids":["boundary"]},{"id":"rule_acceptance","trigger_intent":"询问验收标准或观察周期","allowed_answer":"试点 4 周，看续费率、首次跟进及时率和会员回复率。","related_fact_ids":["acceptance"]}]',
  '{"evaluation_dimensions":["目标","对象","场景","边界","验收"],"rubric":[{"dimension":"目标","max_score":20,"evidence_rule":"问清续费率目标、观察窗口和当前基线。"},{"dimension":"对象","max_score":20,"evidence_rule":"问清会员、前台、顾问、教练、店长的分工。"},{"dimension":"场景","max_score":20,"evidence_rule":"问清到期前后关键触点和流失节点。"},{"dimension":"边界","max_score":20,"evidence_rule":"问清不做范围、例外会员和流程边界。"},{"dimension":"验收","max_score":20,"evidence_rule":"问清试点周期、指标和验收口径。"}]}',
  'active',
  '2026-07-05T00:00:01.000Z'
);
--> statement-breakpoint
INSERT OR REPLACE INTO `training_cases` (
  `id`, `case_id`, `version`, `title`, `difficulty`,
  `scenario_json`, `disclosure_rules_json`, `rubric_json`, `status`, `created_at`
) VALUES (
  'tcase_expr_creative_poster_v1',
  'creative_poster',
  '1',
  '投放海报创意简报访谈',
  'easy',
  '{"category":"创意简报","description":"品牌方想做一组促销海报，但只说要年轻、醒目、转化好。你需要追问目标受众、渠道规格、核心卖点、素材限制和审核边界。","role_label":"品牌市场负责人","practice_goal":"练习把审美表达追问成可执行的创意简报。","visible_constraints":["对方会先给主观风格词","对方不会主动说明审核红线"],"persona":{"role":"品牌市场负责人","communication_style":"偏感性但能给业务信息","knowledge_level":"熟悉品牌和渠道要求"}}',
  '[{"id":"rule_goal","trigger_intent":"询问投放目标或转化目标","allowed_answer":"这组海报主要用于拉新转化，希望突出首单优惠。","related_fact_ids":["goal"]},{"id":"rule_audience","trigger_intent":"询问目标受众或人群特征","allowed_answer":"主要面向 20 到 28 岁的一线城市女性用户。","related_fact_ids":["audience"]},{"id":"rule_channel","trigger_intent":"询问投放渠道、尺寸或版本","allowed_answer":"需要小红书封面、朋友圈长图和门店立牌三个版本。","related_fact_ids":["channel"]},{"id":"rule_boundary","trigger_intent":"询问不能出现的表达、素材或风格边界","allowed_answer":"不能用医疗功效词，不能暗示永久效果，也不能使用未授权明星图。","related_fact_ids":["boundary"]},{"id":"rule_acceptance","trigger_intent":"询问审核或交付标准","allowed_answer":"法务审核通过、三种尺寸可交付、核心卖点在 3 秒内能读懂。","related_fact_ids":["acceptance"]}]',
  '{"evaluation_dimensions":["目标","对象","场景","边界","验收"],"rubric":[{"dimension":"目标","max_score":20,"evidence_rule":"问清投放目标和核心转化动作。"},{"dimension":"对象","max_score":20,"evidence_rule":"问清目标人群、渠道语境和关心点。"},{"dimension":"场景","max_score":20,"evidence_rule":"问清渠道、尺寸、版本和使用位置。"},{"dimension":"边界","max_score":20,"evidence_rule":"问清禁用词、素材限制和审核红线。"},{"dimension":"验收","max_score":20,"evidence_rule":"问清交付格式、审核标准和效果判断。"}]}',
  'active',
  '2026-07-05T00:00:02.000Z'
);
--> statement-breakpoint
INSERT OR REPLACE INTO `training_cases` (
  `id`, `case_id`, `version`, `title`, `difficulty`,
  `scenario_json`, `disclosure_rules_json`, `rubric_json`, `status`, `created_at`
) VALUES (
  'tcase_expr_academic_paper_v1',
  'academic_paper',
  '1',
  '课程论文选题澄清访谈',
  'medium',
  '{"category":"学术任务","description":"同学只说想写人工智能对教育的影响。你需要追问课程要求、研究对象、问题范围、证据来源和评分标准，把宽泛题目收窄成可写论文。","role_label":"课程同学","practice_goal":"练习把模糊学术任务问成可执行的论文需求。","visible_constraints":["对方一开始题目很宽","对方不会主动说明评分标准"],"persona":{"role":"课程同学","communication_style":"不确定、需要引导","knowledge_level":"知道作业要求但没有结构化表达"}}',
  '[{"id":"rule_requirement","trigger_intent":"询问课程要求、字数、格式或截止时间","allowed_answer":"老师要求 5000 字左右，至少 8 篇参考文献，两周后提交。","related_fact_ids":["requirement"]},{"id":"rule_scope","trigger_intent":"询问教育阶段、场景或对象范围","allowed_answer":"我更想写高中阶段的英语写作教学。","related_fact_ids":["scope"]},{"id":"rule_question","trigger_intent":"询问研究问题或核心论点","allowed_answer":"我想回答 AI 写作反馈能否提升学生修改能力。","related_fact_ids":["question"]},{"id":"rule_evidence","trigger_intent":"询问可用证据、文献或数据范围","allowed_answer":"可以用英文文献和公开案例，但没有自己采集的数据。","related_fact_ids":["evidence"]},{"id":"rule_acceptance","trigger_intent":"询问评分标准或完成标准","allowed_answer":"老师更看重研究问题清晰、文献综述完整和论证结构。","related_fact_ids":["acceptance"]}]',
  '{"evaluation_dimensions":["目标","对象","场景","边界","验收"],"rubric":[{"dimension":"目标","max_score":20,"evidence_rule":"问清论文要回答的问题和课程目标。"},{"dimension":"对象","max_score":20,"evidence_rule":"问清教育阶段、学科和研究对象。"},{"dimension":"场景","max_score":20,"evidence_rule":"问清作业场景、材料来源和论文结构。"},{"dimension":"边界","max_score":20,"evidence_rule":"问清不可用数据、范围排除和时间限制。"},{"dimension":"验收","max_score":20,"evidence_rule":"问清评分标准、格式和提交要求。"}]}',
  'active',
  '2026-07-05T00:00:03.000Z'
);
--> statement-breakpoint
INSERT OR REPLACE INTO `training_cases` (
  `id`, `case_id`, `version`, `title`, `difficulty`,
  `scenario_json`, `disclosure_rules_json`, `rubric_json`, `status`, `created_at`
) VALUES (
  'tcase_expr_outsourcing_site_v1',
  'outsourcing_site',
  '1',
  '官网外包范围确认访谈',
  'hard',
  '{"category":"外包采购","description":"一家小公司准备外包官网改版，只说要显得专业、能获客。你需要追问交付范围、排除项、验收材料、里程碑和变更机制。","role_label":"创业公司负责人","practice_goal":"练习把外包意向问成可验收、可报价的项目范围。","visible_constraints":["对方容易把想法和承诺混在一起","对方不会主动说明不包含内容"],"persona":{"role":"创业公司负责人","communication_style":"目标明确但细节混乱","knowledge_level":"了解业务但不懂交付拆分"}}',
  '[{"id":"rule_goal","trigger_intent":"询问官网业务目标","allowed_answer":"主要目标是让客户看起来可信，并能留下咨询线索。","related_fact_ids":["goal"]},{"id":"rule_scope","trigger_intent":"询问页面、功能或交付物范围","allowed_answer":"首版需要首页、服务介绍、案例、关于我们和联系表单。","related_fact_ids":["scope"]},{"id":"rule_boundary","trigger_intent":"询问明确不包含的内容","allowed_answer":"第一版不做会员系统、在线支付、多语言和后台内容管理。","related_fact_ids":["boundary"]},{"id":"rule_milestone","trigger_intent":"询问时间、里程碑或评审节点","allowed_answer":"希望 4 周上线，中间至少看一次线框和一次视觉稿。","related_fact_ids":["milestone"]},{"id":"rule_acceptance","trigger_intent":"询问验收材料或完成标准","allowed_answer":"能在手机和电脑正常访问，表单能把线索发到邮箱，交付源码和部署说明。","related_fact_ids":["acceptance"]}]',
  '{"evaluation_dimensions":["目标","对象","场景","边界","验收"],"rubric":[{"dimension":"目标","max_score":20,"evidence_rule":"问清官网业务目标和成功信号。"},{"dimension":"对象","max_score":20,"evidence_rule":"问清目标访客、客户角色和内部确认人。"},{"dimension":"场景","max_score":20,"evidence_rule":"问清访问设备、线索流转和内容维护场景。"},{"dimension":"边界","max_score":20,"evidence_rule":"问清排除项、变更机制和不承诺内容。"},{"dimension":"验收","max_score":20,"evidence_rule":"问清交付物、测试标准、上线标准和里程碑。"}]}',
  'active',
  '2026-07-05T00:00:04.000Z'
);
--> statement-breakpoint
INSERT OR REPLACE INTO `training_cases` (
  `id`, `case_id`, `version`, `title`, `difficulty`,
  `scenario_json`, `disclosure_rules_json`, `rubric_json`, `status`, `created_at`
) VALUES (
  'tcase_expr_collab_project_v1',
  'collab_project',
  '1',
  '多人毕业设计协作访谈',
  'hard',
  '{"category":"协作项目","description":"三人小组要做毕业设计展示，但每个人理解的重点不同。你需要追问共同目标、分工、依赖、风险和答辩验收标准。","role_label":"小组负责人","practice_goal":"练习把多人协作中的模糊分工问成清楚的项目协定。","visible_constraints":["对方会先强调时间紧","对方不会主动暴露依赖风险"],"persona":{"role":"小组负责人","communication_style":"焦虑但愿意配合","knowledge_level":"了解小组现状但没有项目管理经验"}}',
  '[{"id":"rule_goal","trigger_intent":"询问答辩目标或成功标准","allowed_answer":"答辩最重要是有可运行演示，其次是论文结构完整。","related_fact_ids":["goal"]},{"id":"rule_roles","trigger_intent":"询问成员分工","allowed_answer":"一个人做前端，一个人做模型和数据，一个人写论文和汇报，但接口还没对齐。","related_fact_ids":["roles"]},{"id":"rule_dependency","trigger_intent":"询问数据、模型、设备或外部依赖","allowed_answer":"模型训练依赖一批标注数据，目前只有一半完成。","related_fact_ids":["dependency"]},{"id":"rule_boundary","trigger_intent":"询问第一版范围或可延期内容","allowed_answer":"第一版必须能演示核心流程，个性化推荐和漂亮后台可以放到答辩后。","related_fact_ids":["boundary"]},{"id":"rule_acceptance","trigger_intent":"询问验收方式或答辩材料","allowed_answer":"验收看演示能跑通、论文对应系统功能、每个人能讲清自己的贡献。","related_fact_ids":["acceptance"]}]',
  '{"evaluation_dimensions":["目标","对象","场景","边界","验收"],"rubric":[{"dimension":"目标","max_score":20,"evidence_rule":"问清答辩目标和成功标准。"},{"dimension":"对象","max_score":20,"evidence_rule":"问清成员角色、责任和确认机制。"},{"dimension":"场景","max_score":20,"evidence_rule":"问清演示、论文、汇报和协作场景。"},{"dimension":"边界","max_score":20,"evidence_rule":"问清第一版范围、依赖风险和延期内容。"},{"dimension":"验收","max_score":20,"evidence_rule":"问清答辩验收标准和材料要求。"}]}',
  'active',
  '2026-07-05T00:00:05.000Z'
);
