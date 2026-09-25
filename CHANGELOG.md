# Changelog — dsh-agent-lang

> 倒序排列,新版本条目在最上面。条目格式:`## vX.Y.Z — YYYY-MM-DD` + 类型(feat / fix / docs / chore)+ 要点 + 相关链接。
> 纪律见 AGENTS.md「变更记录纪律」:发版前先更新本文件并随版本提交;事故复盘、复现与真机验证记录也记在这里。

## v0.8.0 — 2026-09-25

**类型**:feat(智能体团队队员 / 子代理的端到端适配 + 「队员与子代理」开关,默认生效;用户 2026-09-25 追加需求)

- **结论先行**:**队员本来就生效**,缺的是开关与其"牙齿"。本插件的指示注册在 **global 层**,而 `SystemPrompt` 组装用的是 `ScopedLayers.merge(scope, …)`——先铺 global 层、再按作用域链覆盖(`packages/core/scope/src/store.ts`),所以任何未封闭 prompt 的 agent(主代理、`spawn_teammate` 队员、`subagent` 子代理、任意嵌套深度)都会合并到这条指示;请求级证据见下(默认态下 lead 与 teammate 的请求体里都有该指示)。本轮新增的是**用户可控的开关**,并让"仅主代理"真正只对主代理注入。
- **开关语义**:新设置字段 `subagents`(boolean,**默认 true**)。开(默认)=队员/子代理与主代理同语言;关=只对主代理注入。字段在**两个设置时代**都声明(新:行 Config `Schema.boolean().default(true)`;旧:注册命名空间同名字段),卡片两代都可写。
- **实现(为什么不是在文本里加个 if 就完事)**:文本提供者拿不到"当前是哪个 agent"——`AssembleContext` 只有 `{ scope, signal }`(`packages/core/system-prompt/src/index.ts:56-66`),而 `ScopeKey` 是不透明对象、没有公开的父子查询。因此:
  - **global entry 原样保留**(名字/顺序/文本都不变):它是主代理、任何 preset、以及本插件**无法识别**的委派路径的兜底——开关只能**减掉**被明确识别为子代理的 agent 的注入,永远不会让主代理丢指示(fail-open)。
  - **子代理侧在自己的作用域注册同名同序的"影子" entry**:`merge()` 按名覆盖(官方文档语义:"scoped entries shadow global entries with the same name"),影子因此是该 child 的唯一来源——开关开→同文本,开关关→空文本,**global entry 不会同时再渲一次**。
  - **识别子代理**:`session.header.parentSession` / `origin === 'subagent'` / `delegationDepth > 0` 三者取或(`childSessionMeta` 对进程内子会话三个都写,`packages/subagent/subagent/src/child-agent.ts:139-157`;恢复或外部子会话可能只带其中一个,所以三个都查)。
  - **安装与回收**:沿用官方 per-agent 范式(`packages/context/file-reference-local/src/index.ts:92`,`agent.ctx.inject(['systemPrompt'], …)`),在 `agent/created` 与 apply 时的 `ctx.agents.list()` 上装、在 `agent/disposed` 与插件卸载时拆;嵌套子代理各自的影子按作用域就近生效。
  - 委派链逐环求证:`spawn_teammate`(`packages/experimental/tool-agent-team/src/index.ts:190-208`)→ `agentTeams.spawnTeammate` → `roster.spawnAdmitted`(`packages/experimental/agent-team/src/roster.ts:246-300`)→ `ctx.subagents.startContinuable` → `SubagentContinuationManager.startContinuable` → `applyChildComposition`(`packages/subagent/subagent/src/child-agent.ts:200-219`,子代理在此继承父代理的 preset composition)。
- **已知边界(卡片文案里对用户说明)**:
  - **fork 出的队员继承主代理已完成回合的前缀**,那段历史里含主代理**已提交**的 runtime-context 快照(其中有语言指示)。关掉开关后,fork 队员**自己新提交**的快照没有指示,但继承段仍在——本插件不重写历史(不变量 1),这是 DSH 的历史模型决定的,不是开关失效。证据见下。
  - **外部 provider 的子代理**(codex / claude-code / acp / sdk 等自带 prompt 的运行时)本来就不经过宿主 `systemPrompt`,开关对它无影响(保持原状;`minimal` 的封闭 prompt 同理,见不变量 2)。
- **卡片 / 词典**:卡片新增一行「队员与子代理」两段式开关(与现有模式行同构,复用同一套 `.dl-segBtn` chrome 与焦点环令牌),下方一行说明;`subagents` 缺省读作开(谁没动过就不该被静默缩小覆盖)。21 门语言各新增 4 键——`sub.title` / `sub.on` / `sub.off` / `sub.hint`,键集合与 `zh` 完全相等(冒烟强制)。**`sub.hint` 在 21 门语言里都写明两条边界**:① fork 出的队员继承主代理已提交的历史快照、开关不重写历史;② 自带提示词的外部子代理(codex / claude-code 等)与 `minimal` 的封闭提示本就不经这条通道、开关对它们无影响(冒烟逐门断言 `fork` 与 `codex` 两个关键词都在)。
- **真机证据**(请求级;隔离 `DSH_HOME=/tmp/dsh-lang-v080`,headless profile 挂 `base + headless + experimental-agent-team-profile + dsh-agent-lang`,`llm-deepseek.baseURL` 指向本地 Anthropic-Messages stub,由 stub 主动回 `spawn_teammate` 工具调用——不需要真模型即可跑出真实队员):

  | 场景 | 主代理(Lead)请求 | 队员 / 子代理请求 |
  |---|---|---|
  | 默认(`subagents` 未设) | ✅ 含指示 | **✅ 含指示**(探针 `kind=child`,请求体 40942 字符;全文恰好 **1** 次 "Current language rules" ⇒ 影子是**替换**而非叠加,不会重复注入) |
  | `subagents: false`,fresh 队员(`spawn`) | ✅ 含指示 | **❌ 0 条指示**(同一 profile、同一链路) |
  | `subagents: false`,fork 队员 | ✅ 含指示 | 自有快照 ❌;继承的 lead 前缀快照 ✅(`msg#0` 继承段含指示、`msg#2` 队员自有 runtime-context 不含) |

  - GUI(隔离 web profile + 无头 Chrome over CDP,端口 3124,未碰 3080 与用户 profile):插件面板卡片渲染出「队员与子代理: 同样生效」两段、默认选中「同样生效」,说明行同时给出两条边界文案(实测渲染文本:`…fork 出的队员仍继承主代理已提交的历史快照,不受此开关影响)。自带提示词的外部子代理(codex / claude-code 等)与极简模式的封闭提示本就不经这条通道,开关对它们无影响。`);点「仅主代理」→ profile 用户层 `cordis.patch.yml` 落 `subagents: false`,点回「同样生效」→ 落 `true`,active 段随之切换;`uiLocale: zh` 未被覆盖(逐字段深合并生效);console 无本插件相关错误。
  - 冒烟测试 **39 → 46 项全绿**(+7):`subagentsEnabled`(默认开 + 只认显式 false)、`isSubagentHeader`(三个标记 + 畸形值不误判)、`directiveText`(开关只掐子代理;开时两个受众逐字节一致)、「子代理影子注册形态」(同名同序 + `agent/created`/`agent/disposed`/`agents.list()`)、「开关在两代设置面都声明」、卡片开关渲染与写入、21 门词典 `sub.hint` 均点出 fork 边界;另两条旧断言随重构更新(`sctx.get('settings')` 形态、两个 provider 均为函数)。
- 其余契约复核(rc.2):`systemPrompt.context()` / `CONTEXT_ORDERS`(125 仍空闲)/ `agent/created`、`agent/disposed` 事件形态(`packages/core/agent/src/runtime-types.ts:261-270`)/ `agent.ctx` 作用域语义均未变;`dsh.bundle.patch`、peer 门禁、展示元数据不受影响(逐面表见 v0.7.1)。
- 版本 0.7.1 → **0.8.0**(minor:新增设置项与覆盖语义),`dsh.plugin.json` 同步。

## v0.7.1 — 2026-09-25

**类型**:fix(适配 dsh v0.1.7-rc.2:跟进统一设计令牌 + 修复图标探测拼写 + 逐面兼容复核;语言通道行为与全部契约无变更)

- **卡片展示面跟进 rc.2 的统一设计令牌层**(本插件只注入提示、绝不改发行资产,卡片 chrome 是手写 CSS ⇒ 官方令牌必须自己跟):
  - **圆角令牌**:rc.2 在 `packages/client/ui-theme/src/styles/base.css:17-22` 新增 `--dsw-radius-xs/sm/md/lg/xl/panel`,并把整条客户端铺开(rc.2 有 **345** 处 `var(--dsw-radius…)` 用法,rc.1 为 **0**)。卡片 `.dl-card` / `.dl-header` 的 `12px` → `var(--dsw-radius-md,12px)`,`.dl-segBtn` / `.dl-input` 的 `8px` → `var(--dsw-radius-sm,8px)`(token 值与旧字面量一一对应,视觉不变)。
  - **统一焦点环**:rc.2 新增 `packages/client/ui-theme/src/styles/focus.css`,`:root{--dsw-focus-ring-width:2px}`,并全局声明 `:focus-visible{outline-color:var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-width:var(--dsw-focus-ring-width)}`——官方同时把客户端里 **114** 处焦点样式换成这条链,并新增「指针模态下把 `--dsw-focus-ring-color` 置 transparent ⇒ 鼠标点击不画环、键盘导航才画」的语义。卡片 3 处 focus 规则同步为 `outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary)))`,从而**继承官方新语义**。
  - 每一处 `var()` 都带旧字面量回退:≤rc.1 宿主(含 0.1.6 线)渲染结果与 v0.7.0 **完全一致**,令牌只是增量升级而非新依赖。焦点色从 `brand-primary`(近黑/近白**填充**色,rc.2 仍用于开关/主按钮填充)改为官方焦点蓝 `state-business-primary` 是 rc.2 的既定方向,不是本插件的自选;回退链末端保留 `brand-primary`,因为 `state-business-primary` 在 ≤0.1.6 宿主上不保证存在。
- **修复:卡片的 chevron 自首版起从未真正渲染成图标**。探测名 `IconChevronDownOutline14` 在 0.1.7 的 rc.1/rc.2 中**都不存在**(官方图标家族是 `IconChevronDownOutlineRegular` / `…OutlineMedium`;数字后缀式拼写 `…14` 在当前 `ui-primitives` 导出表里没有任何成员),特征探测按设计静默降级为文字「▾」,因此缺陷一直不可见。**v0.4.3 记录的「`IconChevronDownOutline14` 仍在新版 primitives 导出中」是误判,本轮更正**。改为候选链 `firstIcon(["IconChevronDownOutlineRegular","IconChevronDownOutlineMedium","IconChevronDownOutline14"])`:命中即用图标,全不命中仍回退文字,不新增硬依赖(`IconChevronDownOutlineRegular` 是官方自己在 `ui-open-in-app/src/client/OpenTargetButton.tsx:152`、`ui-sidebar-terminal/src/client/TerminalGuide.tsx:5` 等处使用的导出,rc.1 与 rc.2 都在)。
- **rc.2 逐面复核结论**(权威检出 `/Users/kanna/project/deepseek-harness` @ `477b4f4205`;`dsh --version` = 0.1.7-rc.2;逐面命令 `git -C … diff dsh-v0.1.7-rc.1 dsh-v0.1.7-rc.2 -- <path>`):

  | 本插件消费的官方契约 | rc.2 状态 | 依据(rc.1↔rc.2) | 处置 |
  |---|---|---|---|
  | `systemPrompt.context()` 签名 | 未变 | `packages/core/system-prompt/src/index.ts` **零 diff**(该包本版只动 README/package.json);`tool-cordis/src/api-catalog.ts` 里 `context(context: PromptContext): () => void` 声明不变 | 无改动 |
  | `CONTEXT_ORDERS` 表(110/115/120) | 未变,order 125 仍空闲 | 同上,`packages/core/system-prompt/src/index.ts:164-168` 原样 | 无改动 |
  | 行 Config 的 `.volatile()` 投影 | 未变 | `packages/settings/settings/src/schema.ts` **零 diff**(`volatileForm` / `hasVolatileAt` 原样) | 无改动 |
  | `ConfigForm` face + `configForms.get(ns)` | 未变 | `packages/client/ui-settings/src/client/**` **零 diff**(该包本版只给 `contract/slots.ts` 的 `settings.launcher` 加了两个可选 props,本插件不用) | 无改动 |
  | `settings.describe()` 里 locale 条目的表单值 `preference` | 未变 | `packages/client/locale/src/index.ts` **零 diff**(本版只改 `LanguageRow.module.css` 的圆角与 en/zh 各一条文案);`packages/settings/settings/src/index.ts` **零 diff** | 无改动;真机优先级链实测通过 |
  | `plugins.bundle.config` 座位(包名 key、`view:'page'`) | 未变 | `ui-plugin-manager/src/client/slot-contract.ts`、`config-ledger.ts`、`extensions/cordis-client-runner/.../slot-catalog.ts` 的该条目 **零 diff**;页面仍 `<section data-plugin-config>{renderSlot('plugins.bundle.config',{view:'page'},{entryKey:pkg.name})}`(`PluginManagerPage.tsx:577-580`) | 无改动 |
  | `settings.plugin.item` 旧座位 | 仍然无 owner(0.1.7 起) | rc.2 全仓仅剩注释引用 | 保留注册(≤0.1.6 宿主仍用) |
  | `ctx.locale.register(ns,dicts)` / `getSnapshot().locales` / `locale/change` | 未变 | `packages/client/locale/src/index.ts` **零 diff** | 无改动 |
  | `dsh.client.platform` 合法值 | 仍只认 `'web'` | `packages/client/modules/src/index.ts:841` `decl.platform !== 'web'` **零 diff**;桌面 Electron renderer 复用同一 shell 资产 | 无改动 |
  | 插件 `require` 可见的平台模块表 | 未变(9 个 specifier) | `packages/client/web/src/platform.ts` + `seed.ts` **零 diff**;`@deepseek-ai/dsh-client-runtime` 仍不在表内,加载器对无对应 row 的 `inject` 名静默跳过(`client/modules/src/client/system.ts` **零 diff**) | 无改动(冒烟白名单不变) |
  | 兼容门禁 `@deepseek-ai/dsh*` peer | 未变 | `packages/boot/app-boot/src/plugin-compatibility.ts` **零 diff** | peer `>=0.1.0` + optional 继续有效 |
  | 插件展示元数据(`locale/*.json` + `package.json.icon`) | 未变 | `packages/boot/app-boot/src/package-meta.ts` **零 diff** | 无改动 |
  | `dsh.bundle.patch` 字符串/数组 | 未变 | `packages/boot/app-boot/src/profile.ts:59` 仍 `typeof bundle.patch === 'string' ? [bundle.patch] : bundle.patch`(本版只把「跳过的 bundle」从即时 stderr 改成 `skippedBundles` + 启动期 `reportSkippedBundles`) | 本插件是单文件字符串 |
  | 注入文本的 `{{…}}` 插值 | 风险不变 | `renderContextSections`/`interpolate` 在 `system-prompt/src/index.ts` 零 diff | 三条来源继续全程 `BCP47.test()` |
  | rc.2 新特性:快捷键服务、「新启用工具即时可用」(`toolUpdate:'addition-only'`)、审批文案跟随界面语言(`PreToolDecision.displayReason`)、语法高亮统一(`util/code-language`)、归档筛选三态、auto-review 可选 bundle、Inspector 不再默认提供 | **均不在本插件消费面** | 各包 diff 逐项确认 | 无改动 |

- **桌面端(家族纪律:两端同时适配)**:本插件桌面路径依赖的三件事本轮全部复核——① 客户端半与 web **同构**:桌面 renderer 复用同一 shell 资产与 ModuleLoader,`dsh.client.platform` 仍只接受 `'web'`(`client/modules/src/index.ts:841`),平台模块表 rc.1↔rc.2 零 diff ⇒ 卡片与上报在两端走同一份代码;② 桌面安装通道要求 bundle 声明 `dsh.bundle.patch`,本插件 `package.json` 已声明(`cordis.patch.yml`,字符串形态在 rc.2 的 `profile.ts:59` 仍受支持),并已带 `icon` + `./locale/*.json` 展示元数据(rc.2 只在 `OPTIONAL_BUNDLES` 注释里把「icon + locale」写成官方可选 bundle 的准入条件,第三方不额外校验);③ **跨端持久化语义**:rc.2 新增 `apps/desktop/src/locale.ts`,`resolveDesktopStartupLocale(preference, languages)` 先读共享 `locale.preference` 再退 OS 语言,并在 `localeChanged` IPC 上即时切换 shell 文案——这与本插件「`locale.preference`(共享、宿主侧)> 本插件 ns 的 `uiLocale`(浏览器上报、易失)」的优先级链**同一口径**,即桌面端的显式语言选择天然被本插件尊重。**只可能在桌面端暴露的复核点(交集成阶段实测)**:① Electron renderer 里 `IconChevronDownOutlineRegular` 是否同样注入到平台模块表(本轮改动后才真正渲染图标);② 桌面端点卡片后 `uiLocale` 是否同样落进 desktop profile 的 `cordis.patch.yml` 用户层;③ OS 语言为中文、`locale.preference` 为空时,桌面 shell 走 `zh-CN` 而 renderer 的 `ctx.locale` 取值是否一致(本插件 auto 链依赖后者);④ 桌面端无浏览器地址栏、首次启动硬刷新路径不同,新装后卡片是否一次出现。
- **仓库变更**:版本号 0.7.0 → 0.7.1(`package.json` 与 `dsh.plugin.json` 同步);冒烟测试 **37 → 39** 项,新增两条回归守卫——「卡片 chrome 消费 rc.2 令牌且保留字面量回退(并禁止旧硬编码圆角/焦点写法回流)」与「chevron 探测候选链包含真实导出名、不得只赌旧拼写」;AGENTS.md 更新「React 纪律」(图标候选链)与「验证清单」(复核日期 + 测试条数),新增不变量 14(卡片 chrome 的设计令牌纪律);README 中/英文「版本兼容」补 rc.2 段。
- **真机证据**(隔离实例,全程未碰 3080 与用户 profile;`DSH_HOME=/tmp/dsh-lang-rc2/home`,profile `probe`(web)/`hl`(headless),端口 3124,`dsh --version` = 0.1.7-rc.2):
  - **启动配方补充**(本机环境坑,与插件无关):PATH 里的自带 node 与 `node-addon-require-builtin`(adhoc 签名)Team ID 不匹配,真实启动会 `fatal: No usable native binding found for node-addon-require-builtin-darwin-arm64`;改用 `/opt/homebrew/opt/node@24/bin/node`(用户 3080 实例用的就是它)即正常,`--dump-config` 不带该绑定所以两种 node 都能跑。
  - 门禁阳性:`npm pack` 出 0.7.1 tarball → `pnpm add` 进 probe profile(`bundles: [@deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app, dsh-agent-lang]`)→ `dsh --profile probe --dump-config` **stderr 为空**、树里出现 `# == dsh-agent-lang / - id: agent-lang`。
  - 启动与客户端半:隔离 web 实例启动日志只有一行带 token 的 URL(无 `skipping` / `disabling` / pending 报错);页面 `window.__DSH_BOOT__.entries` 含 `dsh-agent-lang`(client 半进了启动图);`<style id="dsh-agent-lang-style">` 已注入。
  - **卡片渲染**(无头 Chrome over CDP,控制台仅一条与本插件无关的 Chrome `Password field is not contained in a form` 提示):侧边栏「插件」面板「已安装」组列出本插件,标题/描述来自 `locale/zh.json`(真机证明 0.1.7 的展示资产通道生效);进入 bundle 详情页后 `[data-plugin-config] .dl-card` 渲染出「设置中的显式选择: — / 浏览器上报: zh / 工具描述: 简体中文 (zh) / 模型思考: 关闭 / 回复输出: 关闭」,11 个分段按钮状态正确(跟随界面语言为选中态、思考与回复为关闭)。
  - **设计令牌真的生效**(不只是写法):页面 `--dsw-radius-md=12px`、`--dsw-radius-sm=8px`、`--dsw-focus-ring-width=2px` 与 rc.2 源码一致;把前两者临时改成 24px/16px 后,卡片与分段按钮的计算圆角**同步变成 24px/16px**,复原后回到 12px/8px ⇒ 卡片确实读令牌而非回退字面量。
  - **图标修复的产物级证据**:实际服务的 shell 产物 `/assets/index-Q6zc2uHV.js` 导出表含 `IconChevronDownOutlineRegular:X4` 与 `IconChevronDownOutlineMedium:mw`,全文 **0** 处 `IconChevronDownOutline14` ⇒ 旧探测在 rc.2 必然落空(缺陷在产物层复现),新候选链第一项即命中。注:0.1.7 上 bundle 页形态的卡片不渲染折叠头(v0.5.4 的 `view:'page'` 分支),chevron 只出现在 ≤0.1.6 的旧座位,故此处给的是产物级而非像素级证据。
  - **uiLocale 上报落盘**:probe profile 用户层 `cordis.patch.yml` 出现 `agent-lang: {uiLocale: zh}`;随后把界面语言切到英文,该字段跟随写成 `en`(上报 = 当前 active 界面语言,符合设计)。
  - **设置写入(volatile)**:卡片点「全部关闭」后,同一文件出现 `mode/thinkMode/outMode: off`,而 `uiLocale` 未被覆盖(逐字段深合并生效)。
  - **语言注入链路(真实请求级,本地 Anthropic-Messages stub 抓请求体)**:headless profile `hl`(`bundles: [base, headless, dsh-agent-lang]`,`llm-deepseek.baseURL → http://127.0.0.1:3199`,`DEEPSEEK_API_KEY=stub-key`,`dsh --profile hl "say hi"`)——
    - 无语言可用(无 `uiLocale` 也无 `preference`):宿主 runtime-context 快照里只有官方沙箱/审批策略,**0 条**语言指示(零提示噪声是特性);
    - `agent-lang.uiLocale: zh` → 快照出现 `Current language rules supersede earlier language directives. tool-call descriptions must be written in 简体中文, not in English; …`;
    - `uiLocale: zh` + `locale.preference: en` → 指示变 **English**(显式选择压过浏览器上报,与不变量 3 的优先级链一致);
    - 三通道 `off` → **0 条**指示。
  - **GUI 级优先级旁证**:浏览器 `navigator.language=zh-CN`、`languages=[zh-CN, zh]`,而设了 `locale.preference: en` 后 `document.documentElement.lang=en`、界面与卡片全英文 ⇒ 官方的界面语言同样让显式选择压过浏览器上报,本插件把 `preference` 放在优先级顶端与官方语义同向。
  - 冒烟测试 **39 项全绿**。
- 未在真机覆盖:`minimal` preset 的封闭边界(设计边界,见 AGENTS 不变量 2)未重测;0.1.0…0.1.6 旧宿主本机无 runtime,旧时代路径(旧座位卡片 + chevron 图标)由运行时探测与既有测试保证;桌面端由 Lead 集成阶段统一实测(见上)。
- 发布:npm OIDC 全链路零令牌,`gh run` 36122290063 success(`+ dsh-agent-lang@0.7.1`,带 provenance);发布产物下载复核含本轮两处改动(令牌 CSS、图标候选链)与 `peer >=0.1.0` + optional;npmjs `latest` = 0.7.1,npmmirror 已同步。
- Release:https://github.com/KannaKuron/dsh-agent-lang/releases/tag/v0.7.1

## v0.7.0 — 2026-09-23

**类型**:feat(适配 dsh v0.1.7-rc.1:声明插件兼容性 peer + 真机全链路复核;保持旧版本完全兼容)

- **声明 `@deepseek-ai/dsh` peer**(rc.1 新增的**唯一**强制插件兼容门禁,`packages/boot/app-boot/src/plugin-compatibility.ts`):range 取 `>=0.1.0`。此前本插件 peer 里没有任何 `@deepseek-ai/dsh*`,等于永不被校验;门禁只认 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 的 range,并用 `semver.satisfies(runtime, range, { includePrerelease: true })` 判定,不匹配时**静默**少插件(bundle 层被跳过 / 行被 `disabled`,不报错退出)。
  - 取值理由:下界 `>=0.1.0` = 本构建实际服务的整条 0.1 线(旧时代 ≤0.1.6 走 `settings.register` 命名空间,新时代 ≥0.1.7 走行 Config),与 `engines.dsh` 同一口径。**不设上界**(用户决策,2026-09-23):本插件跨版本靠运行时探测自愈,加 ` <0.2.0` 之类的上界会在下一次 dsh 升级时把插件先行停用,而那时并没有任何真实破坏被观察到;真出现破坏时,在适配版里连代码一起收紧这个 range。**也不逐个版本枚举**:dsh-any-background@0.3.0 的 `… || 0.1.7-alpha.1` 枚举正是被 rc.1 门禁拦下的现实案例(`~/.dsh/profiles/*/compatibility.json` 里的机器级豁免就是它的代价)。
  - **`peerDependenciesMeta` 必须把该 peer 标 `optional: true`**(真机实测发现并修复的安装期坑):门禁**只读** `peerDependencies`(`plugin-compatibility.ts` 全文只碰这一个字段;`peerDependenciesMeta` 在 dsh 运行期没有任何读取方,只有 dsh 仓库自己的校验脚本会读,且那些脚本不作用于第三方插件),但包管理器会解析 peer range 去自动安装——npm 上 `@deepseek-ai/dsh` 的**全部 26 个版本都是 prerelease**,而普通 range 按 semver 规则排除 prerelease,于是 `autoInstallPeers: true`(pnpm 默认值)的安装直接以 `ERR_PNPM_NO_MATCHING_VERSION: No matching version found for @deepseek-ai/dsh@>=0.1.0` 失败。optional peer 不会被自动安装,危害消失而门禁照常生效(阴性对照已实测:同一产物把 peer 改成 `999.0.0`、保留 optional 标志,门禁照样拦下)。
- **host 半的 schemastery 改惰性导入(静默全失效加固)**:`@deepseek-ai/schemastery` 是 peer,普通 Node 从本包位置**解析不到**它(实测 `createRequire(<插件目录>).resolve('@deepseek-ai/schemastery')` → `MODULE_NOT_FOUND`),只靠宿主解析供上来。顶层静态 `import` 一旦解析失败,dsh Loader 把插件行的导入失败当**非致命跳过**(`vendor/loader/src/config/entry.ts` `_init()`:`logger.error` + `return`,永不建 fiber)⇒ host 半不存在 ⇒ `ClientModuleRegistry` 扫不到 `dsh.client` ⇒ **client 半不进启动图、宿主日志全绿、功能整体消失**(与 dsh-better-workspace issue #9 同一失败类)。已用"除静态 peer import 外完全相同"的夹具插件实证:静态版 `apply()` 从不执行,惰性版照常执行(只是 `mod=null`)。现改 `await import(...)` + try/catch,拿不到时 `Config` 导出 `undefined`(cordis 对 `!runtime.Config` 直接放行配置),插件照常挂载、语言提示与卡片上报不受影响。冒烟新增"不得出现静态导入行"断言。真机复核(rc.1 隔离实例,3124):client 半在 `__DSH_BOOT__` 里、console 零错误、界面语言仍落进 profile 用户层 `cordis.patch.yml` 的 `agent-lang.config.uiLocale`。
- **rc.1 逐项复核结论**(权威检出 `/Users/kanna/project/deepseek-harness` @ `46a7f68b09`;`dsh --version` = 0.1.7-rc.1):

  | 本插件消费的官方契约 | rc.1 状态 | 处置 |
  |---|---|---|
  | `systemPrompt.context()`(`{name, order, text}`) | 未变(`packages/core/system-prompt/src/index.ts:78-87`) | 无改动 |
  | `CONTEXT_ORDERS` 表(110/115/120) | 未变(order 125 仍空闲) | 无改动 |
  | `settings.plugin.item` 座位 | **已消失**(rc.1 无任何 owner 声明,`grep` 仅剩注释) | 旧座位注册保留(≤0.1.6 宿主仍用),rc.1 上 `slots.inject` 静默挂起,属预期 |
  | `plugins.bundle.config` 座位(key = 包名,`view: 'page'`) | 未变(`ui-plugin-manager/.../PluginManagerPage.tsx:584`) | 无改动 |
  | `ConfigForm` face(`getSnapshot/set/unset/subscribe`、`status/revision`) | 未变(`ui-settings/src/client/config-form-types.ts`) | 无改动 |
  | `configForms.get(ns)` 服务 | 未变(`config-form.ts:266`) | 无改动 |
  | 行 Config 的 `.volatile()` 投影(`volatileForm` 无 volatile 字段则整条 ns 不服务) | 未变(`settings/src/schema.ts`) | 无改动;运行期 schemastery 确有 volatile,卡片 `status: ready` 已实测 |
  | `settings.describe()` 里 `locale` 条目的表单值(`value.preference`) | 未变(`settings/src/index.ts:302-340` + `client/locale/src/index.ts` 的 `preference` volatile 字段) | 无改动;真机优先级实测通过 |
  | `ctx.locale.register(ns, dicts)` / `getSnapshot().locales` / `locale/change` | 未变 | 无改动 |
  | `locale/<lang>.json` 的 `{meta:{title,description}}` + `package.json.icon` 约束 | 未变(`app-boot/src/package-meta.ts`) | 无改动 |
  | `exports["./package.json"]`(Electron renderer 的 `locatePkgJson` 回退走 exports map) | 未变 | 已有断言,补注释说明其不可省 |
  | `dsh.bundle.patch` 允许字符串或数组 | 有变(新增数组形态) | 本插件是单文件字符串,不受影响 |
  | `dsh.client.inject` 里的 `@deepseek-ai/dsh-client-runtime` | **包已从 rc.1 消失**(npm 上仍有 0.0.1-rc.1) | **保留**:加载器对无对应 row 的名字直接跳过(`client/modules/src/client/system.ts:268`),真机启动图里 client 半正常注入、零 console 警告;保留以免改变旧宿主排序 |
- **仓库变更**:`dsh.plugin.json` 的 `engines.dsh` 由 `>=0.0.1` 对齐为 `>=0.1.0`(与 package.json、peer 下界同一口径);冒烟测试新增/加强 4 条断言——peer range 字面量 + optional 标志 + 两个清单的 version/engines 一致性 + `exports["./package.json"]` 的桌面端理由。
- **真机证据**(隔离实例:`DSH_HOME=/tmp/dsh-adapt-agent-lang/home`,端口 3111,全程未碰 3080 与用户 profile):
  - 门禁阳性:`npm pack` → probe profile(`bundles: [base, web-app, dsh-agent-lang]`)→ `dsh --profile probe --dump-config` **stderr 为空**、`# == dsh-agent-lang / - id: agent-lang` 在树里。
  - 门禁阴性对照:同一产物把已装清单 peer 改成 `999.0.0` → `dsh: skipping profile bundle "dsh-agent-lang": … incompatible with dsh 0.1.7-rc.1 …`,该行从树里消失 ⇒ 门禁确实在本机执行,阳性结论不是"没跑"。optional 标志不影响该判定(实测)。
  - 安装期:同一 tarball 在 `autoInstallPeers: true` 的 pnpm 工程里,加 optional 前 `ERR_PNPM_NO_MATCHING_VERSION` 失败,加之后安装成功且**不**拉 `@deepseek-ai/dsh`。
  - 启动与 GUI:隔离 web 实例启动日志只有一行带 token 的 URL(无 `skipping` / `disabling` / pending 报错);headless Chrome over CDP 打开侧边栏「插件」→ 本插件详情页,`.dl-pageCard` 渲染出中文标题/描述与图标(data URI),三段通道显示「工具描述: 简体中文 (zh)」「模型思考/回复输出: 关闭」,点击「全部关闭 / 全部跟随界面」后通道即时翻转,profile 用户层 `cordis.patch.yml` 出现 `agent-lang: {uiLocale: zh}`(上报链路)与用户改动(逐字段写入,`uiLocale` 不被覆盖);console 无本插件相关错误。
  - **语言注入链路(真实请求级)**:把 `llm-deepseek.baseURL` 指向本地 Anthropic-Messages stub,`dsh --profile <headless probe> "say hi"` 跑真实会话,在 stub 抓到的请求体里核对——无语言可用时 **0 条**语言指示(零提示噪声是特性);`uiLocale: zh` → `… must be written in 简体中文, not in English`;再加 `locale.preference: en` → 指示变 **English**(显式选择压过浏览器上报,`settings.describe()` 新链路实测);三通道 `off` → **0 条**指示。
  - **volatile 即时生效(同进程无重启)**:在同一个 web 宿主进程里,卡片点「全部关闭」后下一轮请求的注入指示消失、点「全部跟随界面」后又回来——行 Config 的 volatile 更新不需要重载插件,AGENTS 不变量 4 的"翻转下一轮生效"在 rc.1 上成立。
  - 冒烟测试 37 项全绿。
- 未在真机覆盖:0.1.0…0.1.6 旧宿主(本机只装了 rc.1,无旧 runtime),旧时代路径由代码探测与既有测试保证,本轮未回归;`minimal` preset 的封闭边界未重测(设计边界,见 AGENTS 不变量 2)。

## v0.6.0 — 2026-09-22

**类型**:feat(适配 dsh v0.1.7-alpha.1,保持旧版本兼容)

- **设置面双时代**(dsh 0.1.7 将 settings.register/SettingsScope 替换为插件行 Config + profile patch 存储):
  - host 半静态导出 `Config`（字段与旧命名空间 schema 同名同形，行 id `agent-lang` 与旧命名空间同串，旧 settings.yaml 一次性导入直接落位），全字段 `.volatile()` 探测标记（已发布的 npm schemastery 3.18.2 无此方法，探测是硬要求）；apply 收到 Volatile 引用，`valueOf()` 双形态读取，指示闭包每次组装重读，翻转下一轮生效。
  - 语言偏好读取：旧 = `settings.get('locale')`；新 = `settings.describe()` 重 ns `'locale'` 的表单值（优先级链不变）。
  - client 半 `exports.inject` 改为只声明跨时代必有服务(locale/slots)，设置面可选注入：旧 `settingsScope` / 新 `configForms.get('agent-lang')`（两代 face 同契约，卡片与上报零改动；硬注入在 0.1.7 上会让 fiber 永远 PENDING）；设置卡双座位策略不变，0.1.7 上由 `plugins.bundle.config` 座位承接。
- **插件管理页展示资产**(dsh 0.1.7 新特性)：新增 `icon.svg` + `locale/{en,zh}.json`（多语言标题/描述），旧宿主完全忽略，单包双时代。
- **仓库变更**:host 半静态 import schemastery（Loader 需要模块顶层的 Config），新增 `devDependencies`（冒烟测试前需 `npm install`；运行时解析仍走 profile 共享 fallback，与旧动态导入同路）；schemastery 同时声明在 peerDependencies 与 devDependencies（dsh 0.1.7 推荐的 link 开发姿势）。
- 冒烟测试 36 项全绿（新增 Config/volatile/双时代获取/包元数据断言）。

## v0.5.4 — 2026-09-19

**类型**:fix(bundle 页卡片壳)

- 修复:v0.19.0/v0.5.3/v0.12.1/v0.6.1 把磨砂与卡片样式挂在旧座位的折叠卡类上,而插件面板的 bundle 页(page 形态)此前渲染的是**无壳裸 div**——磨砂/边框/背景在面板里根本没出现。page 形态现在渲染完整卡片壳(边框 + 背景 token + any-background 磨砂链 + 标题/描述头部 + 默认光标),与 dsh-better-workspace 的 bundle 页同构。
## v0.5.3 — 2026-09-19

**类型**:chore(视觉统一)

- 设置卡片表面加 dsh-any-background 磨砂适配链(backdrop-filter: var(--dsh-any-blur-card-panels, blur(12px) saturate(1.15)),-webkit- 同步)——与 dsh-better-workspace / dsh-gitbash-shell v0.19.0 同款配方,壁纸/透明主题下自然融合;page 形态(插件面板 bundle 页)此前已就绪,本次零结构改动。
## v0.5.2 — 2026-09-17

**类型**:docs(npm description 双语化)

- **package.json 的 description 改为「中文 · English」双语**:dsh 0.1.6-alpha.2 的新 Plugins 页对第三方插件直接显示 npm description 单字符串(官方 bundle 的中文来自页面内硬编码表,无第三方按语言切换通道);按生态惯例(ide-git / rewind-plugin 同款)双语拼接,中文界面一眼可读,英文保留 npm 搜索价值。无代码改动。

## v0.5.1 — 2026-09-17

**类型**:feat(dsh 0.1.6-alpha.2 设置页体系迁移适配)

- **设置卡双座位**:dsh 0.1.6-alpha.2 把插件配置从「设置 → 插件」分区(`settings.plugin.item` 槽,已从官方槽目录移除)迁到侧边栏新 **Plugins 面板**的 `plugins.bundle.config` 槽(keyed by **包名**)。本插件现在同时注册两个座位——旧 `settings.plugin.item`(key=`agent-lang` 命名空间,≤ 0.1.6-alpha.1 宿主照常出卡)与新 `plugins.bundle.config`(key=`dsh-agent-lang` 包名,≥ 0.1.6-alpha.2 宿主在插件详情页出配置区)。两个 `slots.inject` 各等各的槽声明,任何宿主版本下恰好只有一个生效,无需版本探测(按槽可用性自动,不依赖版本号比较)。
- **组件双视图**:`DescLangCard` 按 owner 传入的 `view` 分支——新槽固定 `view: "page"`(页面自画标题/图标/面包屑)时渲染纯表单体(`dl-page`/`dl-pageBody`,无折叠壳);旧槽不传 view,保持原折叠卡形态。
- 实现细节:inject 工厂提升为共享的 `injected` 变量(两座位同一份 props:scope/localeScope/selectableLocales);CSS 追加 `dl-page`/`dl-pageBody` 两条规则。与 v0.5.0 的 21 门词典体系无交集(注册共用同一 `DICT_NS`,`locale: DICT_NS` 让两座位都吃到词典座位)。
- 事实来源:dsh 源码 `packages/client/ui-plugin-manager/src/client/slot-contract.ts`(三槽契约,`plugins.item` 被官方内置卡占用、bundle 配置归 `plugins.bundle.config`/`plugins.row.config`);`packages/client/ui-settings-plugins`(官方内置卡已迁移);`extensions/cordis-client-runner/src/client/slot-catalog.ts`(旧槽已从目录消失)。
- 冒烟测试新增「dual settings seat across dsh generations」(双注册存在、key=包名、view 分支);更新 inject 工厂断言(工厂提升为变量后的形状)。

## v0.5.0 — 2026-09-15

**类型**:feat

- **设置卡片支持 21 种界面语言**。除文件内的 `zh` / `en` 两本基础词典外,新增 **19 门第三语言**,一门一条放在 `LOCALES` 表,每条前一行带 `/* locale: <tag> */` 标记:`ar` `de` `fr` `hi` `id` `it` `ja` `ko` `nl` `pl` `pt` `ru` `sv` `th` `tr` `vi` `zh-HK` `zh-MO` `zh-TW`(繁体三门里 zh-MO 与 zh-HK 同文,zh-TW 用台湾用词)。加一门语言 = 表里追加一条带标记的条目,注册逻辑一行不改。
- **词典经 `ctx.locale.register` 交给 DSH 的 locale 服务**(`agentLang` 命名空间,一次注册 `Object.assign({}, LOCALE_ALIASES, LOCALES)`,表里有什么就发布什么);卡片注册用 `locale: DICT_NS` 把 `t` 座位绑到本插件词典,该座位按 locale revision 重新派生。**语言跟随 DSH 的 `ctx.locale`,切换语言即时生效**——无需刷新页面、无需重启,词典也不会在 apply 时被捕获成一次性值。
- `LOCALE_ALIASES` 把宏标签 `zh-Hant` / `zh-Hans` 指到同一批词典对象上(引用而非副本,没有第二本要对齐):注册表按**精确 id** 查表,不会替我们把 `zh-Hant-*` 折到港式,区域 id 靠语言包自己的 fallback 链走到别名。
- 强制语言下拉的语言自称表(host/client 两半各一份)补齐到 21 条(含 `zh-HK` / `zh-MO` / `zh-TW`),未知 tag 仍降级为裸 BCP 47 标签。
- **新增守护测试「每本词典的键集与中文完全相等」**(`every shipped dictionary carries the same key set as zh`):按 `/* locale: */` 标记切片,逐门与 `zh` 比对 key 集合——缺键只会在查表时静默回退英文,卡片就成半翻译状态,这条测试专门拦它。另加三条守护:19 个 tag 的完整清单、host/client 自称表集合一致、bundle 语法可解析(词典打错字会让卡片整块空白)。冒烟测试 33 项全绿(原 29 项 + 4 项)。
- **译文为机器辅助翻译,欢迎在 issue / PR 里修正**——每门语言只占 `LOCALES` 表里一处,互不影响,改一门不会碰到别的语言。
- 文档:AGENTS.md「词典纪律」按 21 门语言的现状重写(标记约定、key 对齐、宏标签别名、本插件不自己 `addLanguage` 的理由)。
- Release:https://github.com/KannaKuron/dsh-agent-lang/releases/tag/v0.5.0

## v0.4.3 — 2026-09-15

**类型**:docs(兼容性核对,**无行为改动**)

- **dsh 0.1.6-alpha.1 兼容性核对通过**。逐项结果:
  - `systemPrompt.context()` 契约未变:`PromptContext` 仍是 `{ name, order, text }`,order 125 仍排在官方 CONTEXT_ORDERS(110/115/120)之后;新版给 **sections** 新增的 `interpolate: false` 不适用于 context 贡献,本插件不涉及。
  - 注入文本**不存在 `{{...}}` 插值风险**:渲染期插值对 malformed / unknown 引用会**抛错**,而本插件的三条语言来源(强制标签 / locale 显式选择 / 浏览器上报)全部经 `BCP47.test()` 校验后才进入文本——这条校验链是必须保持的不变量,不要绕过。
  - 图标 `IconChevronDownOutline14` 仍在新版 primitives 导出中(新版删的是 `IconSendOutline16`,本插件不用);`settings.plugin.item` 槽与 settings / locale 服务契约均无变化(locale 包本版只删了两条 JSON 树文案)。
- README 新增「版本兼容」小节(中英)。
- 冒烟测试 29 项全绿(无改动,回归确认)。

## v0.4.2 — 2026-09-05

**类型**:chore

- package.json 声明 `engines.dsh`(插件市场「宿主要求」显示面)。

## v0.4.1 — 2026-08-31

**类型**:feat

- 强制语言下拉合并已注册语言包:locale 快照的已注册语言(`ctx.locale.getSnapshot().locales`,dsh-i18n 等任何语言包插件自然并入)经 inject 工厂喂入组件,优先级 已存自定义 tag > 已注册语言 > 静态兜底;feed 缺失/异常降级静态列表。

## v0.4.0 — 2026-08-31

**类型**:feat

- 强制语言输入改为下拉(datalist)+ 自由 BCP 47 输入并存。

## v0.3.1 — 2026-08-31

**类型**:fix / release

- **发布事故恢复**:workflow 在发布周期内被「删除→恢复」且仓库 Actions 被 toggle,GitHub 要求**文件内容变化**才重新注册(零内容 re-touch 无效),半激活期创建的 run 永久卡 queued(jobs=0 是铁证:事件流有 ReleaseEvent 但 runs total_count 为 0)。处置:workflow 加 `workflow_dispatch` 并 push → `gh run cancel` 作废卡死 run → 手动触发补发 → npm 确认 + npmmirror 同步。教训固化为 AGENTS.md「发布事故处置」playbook。
- v0.3.0 为 npm 首版(bootstrap:`npm publish` 令牌建包 + `npm trust github` 登记 Trusted Publisher,此后零令牌)。

## v0.3.0 — 2026-08-31(npm 首版,无独立 git tag)

**类型**:feat

- 英文成为常规目标语言(部分模型思考/输出混杂多语言,显式英文指示同样纠正;英文自身省略 ", not in English" 从句)。
- 发布通道:0.3.0 期间曾移除 npm workflow,0.3.1 恢复(见上)。

## v0.2.0 — 2026-08-31

**类型**:feat

- supersede 子句 + 合并子句组装:三通道全开时提示 528 → 383 字符;更名 dsh-agent-lang,扩展为三通道(工具描述/思考/回复)独立控制。

## v0.1.0 — 2026-08-31(dsh-desc-lang,未发 npm)

**类型**:feat

- 首版(dsh-desc-lang):工具调用 description 跟随界面语言;host 半 runtime-context 指示 + client 半上报 uiLocale + 设置卡。
