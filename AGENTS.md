# AGENTS.md

面向后续在本仓库继续开发的 Agent / 贡献者。读完再动手。

## 项目一句话

「dsh-agent-lang」:DSH 插件,控制模型产出文本的三个语言通道——**工具调用 `description`**(含 PTC 模式 `run_code` 的 description,即调用卡片标题)、**模型思考**、**回复输出**——每个通道独立配置:跟随界面语言 / 强制指定语言 / 关闭,支持一键全部跟随、一键全部关闭。默认仅工具描述通道开启(auto),思考与回复默认关闭(保持现状)。做法:主机面注册一条全局动态 runtime-context 指示 + 浏览器半上报界面语言 + 「插件」面板 bundle 详情页的设置卡片控制行为。

## 环境与工具

- 本机已安装 GitHub CLI(`gh`,已认证 KannaKuron):建仓、推送、release 优先用 gh。
- 发布(2026-08-31 起 npm OIDC 全链路已就绪,与 dsh-better-workspace 同款):bootstrap 首版 0.3.0 已在 npmjs 建包,Trusted Publisher 已登记(repo=KannaKuron/dsh-agent-lang,file=.\.github/workflows/npm-publish.yml,permissions=publish);**日常发版**:`npm test` 全绿 → 改版本(package.json 与 dsh.plugin.json 两个都改且一致)→ `git tag vX.Y.Z && git push origin main --tags` → 仓库目录内 `gh release create vX.Y.Z --title "vX.Y.Z" --generate-notes` → Release published 触发 OIDC workflow(node 24 + id-token: write,零令牌)自动发 npm → `gh run watch <id> --exit-status` 看绿 → `npm view dsh-agent-lang version --registry=https://registry.npmjs.org` 确认 → `curl -X PUT https://registry.npmmirror.com/dsh-agent-lang/sync` 同步 npmmirror。
- 本机 web profile 装本地开发版:`npm pack` 出 tarball → 在 `(dsh home)/profiles/web` 里 `pnpm add <tarball>` → 重启 DSH(`package.json` 的 `dsh.bundle.patch` 声明自动挂载,无需手改 profile patch)。

- **发布事故处置(2026-08-31,v0.3.1 实际教训)**:workflow 文件在发布周期内被「删除→恢复」或仓库 Actions 被 toggle 后,GitHub 会要求**文件内容发生变化**才重新注册(re-touch 无内容变化的 commit 无效),且**半激活期创建的 run 会永久卡 queued(连 job 都不生成,jobs = 0 是铁证)**——事件流有 ReleaseEvent 但 actions/runs total_count 为 0 = 事件根本没触发 workflow。处置:① 修改 workflow(内容变化,如加 `workflow_dispatch:`)并 push;② `gh run cancel` 作废卡死的 queued run;③ 重新 `gh workflow run` 手动触发(本 workflow 已带 `workflow_dispatch`,应急补发不需要再发假 release);④ 跑绿后 `npm view <pkg> version --registry=https://registry.npmjs.org` 确认 → npmmirror 同步。诊断命令:`gh run list --repo <repo> --limit 5`、`gh api repos/<repo>/actions/runs --jq .total_count`(0 = 从未触发)、`gh run view <id> --json status,conclusion`。

## 适配分支纪律(2026-10-30 起)

- 每轮适配 dsh 新版本,都从最新 `main` 开分支 `alpha适配`;本轮所有适配改动只提交到该分支,不直接推 `main`。
- 在该分支跑完 `npm test` 与隔离实例真机验证,确认没问题后再合并回 `main`、再发版本。
- 下一轮适配重新从 `main` 开同名 `alpha适配` 分支,不复用上一轮的分支;已合并的旧分支可删。
- 本纪律与各仓库的「变更记录纪律」并列:CHANGELOG 记录改了什么,分支记录这一轮改动的边界。

## 单代基线与大版本清理纪律

- 运行时只服务 `engines.dsh` 声明的下限版本(当前 `>=0.2.2-rc.1`),不再为更老的 dsh 保留运行时探测分支;下限抬升走 0.x 的 minor,并在 CHANGELOG 标 breaking。
- **每次 dsh 大版本或破坏性 rc 适配,重做一次全仓单代审计**:删除旧设置面(`settings.register` / `settingsScope` / `settings.get`)、旧版本能力探测、按旧宿主物化的资产与夹具、只为旧 host 存在的回退;官方已删除的 API 不保留“以防万一”的路径。
- 例外必须保留:用户数据迁移(旧 localStorage / 旧物化目录 / 旧 profile 字段)、跨插件主动兼容(如 dsh-ops / FastCtx / ptc / better-sidebar 联动)、可选官方能力缺失时的防御性 fallback。审计时逐条写明保留理由。

## 变更记录纪律(2026-09-13 起)

- **所有版本发布、修复、事故复盘、复现/验证记录一律写进本仓库 `CHANGELOG.md`**,不再追加进本文件;
  本文件只保留仍然有效的规则、不变量与当前事实,历史叙事由 CHANGELOG 承载(需引用时写
  「见 CHANGELOG vX.Y.Z」)。
- **发版流程新增强制步骤**:更新 CHANGELOG(写好新版本条目)→ 随版本提交 → 再打 tag /
  发 Release;顺序不能反。
- CHANGELOG 条目格式:倒序排列;`## vX.Y.Z — YYYY-MM-DD` + 类型(feat / fix / docs / chore)+
  要点 bullet + 相关链接(issue / PR / discussion / Release)。

## 目录地图

| 路径 | 作用 |
|---|---|
| `src/index.js` | host 半：导出行 `Config`（**顶层 await 惰性 import** schemastery，拿不到时 `Config = undefined`，全字段直接 `.volatile()`）；+ 全局动态 runtime-context 指示（`systemPrompt.context`）；+ 每个子代理/队员自己作用域里的同名影子（受众开关 `subagents`，见不变量 15） |
| `src/client.js` | 浏览器半（手写 ModuleLoader bundle）：硬注入 `configForms` 上报界面语言 + 单座位（`plugins.bundle.config`）注册设置卡片 |
| `cordis.patch.yml` | `dsh plugin add` 官方安装通道的挂载声明(insert 一行插件 row,主机面全局挂载) |
| `dsh.plugin.json` | 插件注册表清单(id `dsh-external/dsh-agent-lang`) |
| `tests/smoke.mjs` | 冒烟测试(纯文件/helper 级,零依赖):helper 逻辑、源码纪律(require 白名单、无 import/JSX、词典对齐与 19 tag 清单、自称表两半一致)、清单一致性 |
| `locale/{en,zh}.json` + `icon.svg` | 插件管理页展示资产(多语言标题/描述 + 图标) |

## 核心不变量(改代码前必读)

1. **只注入提示,不改资产**。绝不修改 preset / persona / 工具 schema / 任何 dsh 发行文件:它们是部署资产,升级覆盖 + 影响 request-cache 稳定性设计。唯一通道是运行时注册的提示贡献。
2. **通道是 `systemPrompt.context()`,不是 `section()`**。理由:与沙箱/审批策略同列(语义契合)、每轮请求刷新(语言切换下一轮生效)、渲染在请求末尾(近因压过工具 schema 的英文指引)。空文本贡献会在渲染时被丢弃——**完全未检测到语言**时返回 '' 是**特性**(零提示噪声);**英文自 v0.3.0 起是正常目标语言**(部分模型思考/输出会混杂多语言,显式英文指示同样纠正),仅为英文自身省略 ", not in English" 从句。已知例外:`minimal` preset 的 persona `complete: true` 且 `includeRuntimeContext: false`,提示对一切后挂贡献者封闭——接受,文档声明,不要试图穿透(waterfall 也改不动 complete 恢复)。
3. **语言来源优先级(纯函数 `pickDisplayLanguage`,测试覆盖)**:mode off → 无;force+合法 forceLocale → forceLocale;auto:locale 行的 `preference` > 本插件行 Config 的 `uiLocale`;非法 BCP 47 一律忽略。**绝不写 locale 行**(那是用户的显式选择,写它会破坏「absence delegates to browser」语义);client 只写本行 Config 的 `uiLocale` 单字段(settings 写是逐字段深合并,mode/forceLocale 永远幸存)。`ns` 在这里只是 `settings.describe()` 的 descriptor 字段,不是旧 `settings.register` 命名空间。
4. **设置面单代(v0.13.0 起,dsh >=0.2.2-rc.1)**:唯一设置面是行 `Config`(row id `agent-lang`)+ 客户端 `configForms`。0.2.2 已删除 `settings.register(ns, schema)` / `settingsScope` / `settings.get(ns)`,不再做任何旧时代探测。host 半用**顶层 await 惰性 import** `@deepseek-ai/schemastery` 并导出 `Config`,**每个字段直接 `.volatile()`**(3.19.0 起才有该 API;peer/dev 均 `^3.19.0`);apply 收到 `Volatile<T>` 引用,`valueOf()` 双形态读取。指示文本闭包每次组装重读引用,翻转下一轮生效,无需监听 `loader/volatile-update`。语言偏好只读 `settings.describe()` 里 ns `'locale'` 的表单值。客户端硬注入 `configForms`,取 `configForms.get('agent-lang')` / `get('locale')`。
   - **绝不用顶层静态 peer import(v0.7.0 加固)**:schemastery 是 **peer**,普通 Node 从本包位置解析不到它(实测 `createRequire(插件目录).resolve('@deepseek-ai/schemastery')` → `MODULE_NOT_FOUND`),它只靠宿主自己的解析(profile shared fallback)供上来。顶层静态 import 一旦解析失败,dsh Loader 把插件行的导入失败当**非致命跳过**(`vendor/loader/src/config/entry.ts` `_init()`:logger.error + return,永不建 fiber)——host 半不存在 ⇒ `ClientModuleRegistry` 扫不到 `dsh.client` ⇒ client 半不进启动图,**宿主日志全绿、功能整体消失**(与 dsh-better-workspace issue #9 同一失败类;已用"除静态 peer import 外完全相同"的夹具插件实证:静态版 `apply()` 从不执行,惰性版照常执行、只是 `mod=null`)。现改 `await import(...)` + try/catch,拿不到时 `Config` 导出 `undefined`(cordis 对 `!runtime.Config` 直接放行配置),插件照常挂载、提示注入仍可用;此时设置卡可能显示 unavailable、uiLocale 上报为 best-effort。冒烟测试两条断言锁死(不得出现静态导入行 + 必须是 `Schema === null ? undefined : …`)。
   - **devDependency 的用途**:仓库保留 `devDependencies`(@deepseek-ai/schemastery)只为本地 `npm test` 能 import 到它;运行时解析走宿主(profile shared fallback,已验证)。schemastery 只进 peerDependencies + devDependencies,不进 dependencies。
5. **无构建**。host 半纯 ESM JS;client 半是**手写 ModuleLoader bundle**(`window.__ModuleLoader__.load({id, factory})`,id=包名):`require` 只允许基线白名单(react、react/jsx-runtime、react-dom、react-dom/client、@deepseek-ai/cordis、@deepseek-ai/dsh-client-store、@deepseek-ai/dsh-client-ui-slots),冒烟测试强制;无 import/JSX/TS 语法。当前卡片只用 `react` 一个 require(页面卡无图标、无 primitives)。**client 半的 `exports.inject` 硬声明 `locale` / `slots` / `configForms`**——0.2.2 里这三个服务都在,硬注入不会 PENDING;设置面统一走 `configForms.get('agent-lang')` / `get('locale')`。设置卡**只有单座位**(`plugins.bundle.config`)。
6. **slot 契约**:设置卡挂在 `plugins.bundle.config`(keyed 槽,**key = 包名** `dsh-agent-lang`;页面卡本身始终平铺,不再读 `view`,也没有卡片级折叠头;卡内小节仍用文本 `▸` 折叠)。卡片 chrome 必须手写(`dl-` 前缀 CSS,令牌跟官方 `ui-plugin-manager` 的 bundle 页/`ui-theme` 的设计令牌,不能 import ui-settings-plugins(不在白名单))。注册里的 `locale: DICT_NS` 让框架把 `t` 座位绑到本插件的词典命名空间,该座位**按 locale revision 重新派生**(渲染机制给每个 outlet 订阅 locale 变化:语言切换即重渲染并换新的 `t` 引用),所以卡片文案跟随 GUI 语言实时切换,插件自己不必订阅刷新、也不得在 apply 里把词典捕获成一次性值。命名空间不可用(`snap.status !== 'ready'`)时卡片渲染 null(官方行为)。
7. **词典纪律(21 门语言)**:NS = agentLang;`zh` / `en` 是文件内的两本基础词典,其余 **19 门第三语言**在 `LOCALES` 表里一门一条(每条前一行 `/* locale: <tag> */` 标记;繁体三门 `zh-hk` / `zh-mo` / `zh-tw`,其中 zh-mo 与 zh-hk 同文)。注册表按**精确 id** 查表,不会替我们把 `zh-Hant-*` 折到港式,因此 `LOCALE_ALIASES` 把宏标签 `zh-hant` / `zh-hans` 指到同一批词典对象上(引用而非副本,没有第二本要对齐);区域 id 靠语言包自己的 fallback 链走到别名。**每本词典的 key 必须与 `zh` 完全相等**——缺键只会静默回退英文,卡片就成半翻译状态——冒烟测试 `every shipped dictionary carries the same key set as zh` 按标记切片逐门比对,另一条锁定 19 个 tag 的完整清单。加一门语言 = 在 `LOCALES` 追加一个带标记的条目再跑测试,不改任何逻辑:注册是一次 `ctx.locale.register(DICT_NS, Object.assign({}, LOCALE_ALIASES, LOCALES))`,表里有什么就发布什么,不可能漏注册。语言自称映射(共 21 条,含 en)host/client 各一份,冒烟测试比对两边集合,改要同步。
   词典只在语言包(`ctx.locale.addLanguage`,如 dsh-i18n)把该 tag 注册进 catalog 后才可能成为 active——**本插件不自己 addLanguage**:那会把半翻译语言塞进 设置 → 通用 → 语言 的选择器。
8. **React 纪律**:纯 React.createElement;组件定义在模块层(内联定义会在父渲染时重挂载);所有 hooks 先于任何 early return。页面卡本身始终平铺、不引用 primitives,也不做图标候选链探测;卡内小节仍用文本 `▸` 折叠。旧 `IconChevronDownOutline14` 探测、卡片级折叠头与回退 helper 已删除,不要复活(历史见 CHANGELOG v0.7.1)。
9. **context order 130** 是自由槽位(v0.12.0 前为 125;dsh 0.2.1-alpha.3 官方新增 `TEAM_IDENTITY: 125` 撞号后迁移;0.2.2-rc.2 又删除该常量,130 仍空闲),排在官方 CONTEXT_ORDERS 的策略邻区(WORKING_DIRECTORY 100 / SANDBOX_POLICY 110 / APPROVAL_POLICY 115 / SUBAGENT_DELEGATION 120;其后是 HARNESS_SOURCE 200 / WEB_SURFACE 210);若官方表扩张越过 130,换一个空闲数。
10. **slot 注册 options 的顶层字段不会传给组件**(2026-08-31 实测:首版把 scope/localeScope 放顶层,组件 props.scope 为 undefined,useSyncExternalStore(undefined.subscribe) 渲染即崩,卡片无声消失而上报链路照常)。只有协议字段生效:`locale` 绑 t、`store` 绑 store seat、**`inject` 工厂返回的成员按原名成为 props**(hooks 子对象绑成 useXxx)。传对象一律走 inject 工厂;组件外再包 QuietBoundary(渲染失败只废本卡)。对照范本:已安装的 dsh-better-workspace 0.6.0(sandbox 里的开发副本可能滞后,以 profile node_modules 里实际装的版本为准)。
11. **host 半读未声明服务必须 `ctx.get('name')`**:`ctx.inject(['systemPrompt'], (pctx) => ...)` 的 pctx 只有声明过的服务可作属性访问,`pctx.settings?.get?.(...)` 这种未声明属性读取**静默 undefined**(可选链连错都不报),指示因此永远空文本(2026-08-31 实测:卡片/上报全正常但指示从未注入,agent 描述依旧英文)。测试已锁定 `pctx.get('settings')` 形态。
12. **强制语言下拉选项三来源、去重优先级递减**(v0.4.1):已存自定义 tag(保可见)> **locale 快照的已注册语言**(`ctx.locale.getSnapshot().locales`,经 inject 工厂 `selectableLocales` 喂入组件;任何语言包插件经 `ctx.locale.addLanguage` 注册的语言——如 dsh-i18n——**自然并入并置前,无需本插件感知具体包**)> 静态 LANG_OPTIONS 兜底(未装任何包时依旧可用)。feed 缺失/异常一律降级为静态列表;选项 label 用语言包自带 label(缺失回退 id)。
13. **兼容门禁单代(v0.13.0 起)**:`engines.dsh` 是唯一门禁——`packages/boot/app-boot/src/plugin-compatibility.ts:57-61` 在存在 `engines.dsh` 时直接用它(prerelease 参与匹配),不再看 peer;不匹配就**静默**少插件(bundle 整层被跳过 / 行被 `disabled`)。本包 `engines.dsh` 与 `peerDependencies["@deepseek-ai/dsh"]` 同步为 `>=0.2.2-rc.1`,**不设上界、也不逐版本枚举**(上界只会在下一次 dsh 升级时把插件停用;枚举的教训见 CHANGELOG v0.7.0);真出现破坏时在本轮适配里一起收紧。`peerDependenciesMeta` 仍须标 `optional: true`:门禁不读 meta,但包管理器(autoInstallPeers 默认开启)会去 registry 解析 range,而 `@deepseek-ai/dsh` 全是 prerelease、普通 range 按 semver 排除 prerelease ⇒ 不标 optional 会让安装整体失败(`ERR_PNPM_NO_MATCHING_VERSION`;实测见 CHANGELOG v0.7.0)。适配新版本时同步改 engines、peer、peerDependenciesMeta 与冒烟测试里锁定的字面量。
14. **卡片 chrome 只用官方设计令牌(v0.13.0 起)**:`--dsw-radius-xs/sm/md/lg/xl/panel`(`ui-theme/src/styles/base.css`)与统一焦点环 `--dsw-focus-ring-width` / `--dsw-focus-ring-color`(`ui-theme/src/styles/focus.css`,指针模态下官方把颜色置 transparent ⇒ 鼠标点击不画环)在 dsh 0.2.2 已铺满客户端,本插件手写 CSS 直接引用:`var(--dsw-radius-md)`、`outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color)`。**不要再写旧字面量回退**,那只会掩盖令牌改名;冒烟测试禁止回退写法回流。若官方换令牌名,同一适配轮里直接跟新名。
15. **受众开关 `subagents`(v0.8.0 起,默认开)**:指示的 **global entry 是唯一兜底**,永远保留原样(主代理、任何 preset、任何本插件识别不了的委派路径都靠它);要做到"只对主代理"必须靠**子代理自己作用域里的同名同序影子**——`SystemPrompt` 的 `merge()` 先铺 global 层、再按作用域链**按名覆盖**(`packages/core/scope/src/store.ts` 的 `merge()`:"scoped entries shadow global entries with the same name"),所以影子就是那个 child 的唯一来源,global entry 不会再多渲一次。识别子代理看 `session.header` 的 `parentSession` / `origin === 'subagent'` / `delegationDepth > 0`(三者取或);安装与回收走官方 per-agent 范式(`agent.ctx.inject(['systemPrompt'], …)` + `agent/created` / `agent/disposed` / apply 时的 `ctx.agents.list()`,范本 `packages/context/file-reference-local/src/index.ts:92`)。**不要把开关实现成"在文本里加个 if"**:文本提供者拿不到 agent 身份(`AssembleContext` 只有 `{ scope, signal }`,`ScopeKey` 是不透明对象、无公开父子查询)。两条已知边界必须留在卡片文案里:① fork 出的子代理继承主代理已完成回合的前缀,其中含主代理**已提交**的快照,开关不重写历史;② 自带 prompt 的外部 provider(codex / claude-code / acp / sdk)与 `minimal` 的封闭 prompt 本就不经过宿主 `systemPrompt`,开关对它们无影响。

## 验证清单(改动后)

1. `npm test` 全绿(47 项)。
2. 真机(隔离实例:`DSH_HOME=<tmp> dsh --no-open --port <port>`;0.2.2 的 profile 自带 app,**不要再写 `web` 子命令**,否则 `too many arguments`)。界面语言上报落在 profile 的 `cordis.patch.yml` 用户层(`- id: agent-lang` + `config.uiLocale`);设置卡片在侧边栏「插件」面板 → 本插件的 bundle 详情页(只注册这一个座位)。
   - 语言注入链路(真实请求级证据,不依赖真模型):把 `llm-deepseek` 的 `baseURL` 指向本地 stub(Anthropic Messages SSE),`dsh --profile <headless probe> "<task>"` 跑一轮,在 stub 抓到的请求体里核对注入文本;`mode off`/未检测到语言时必须**没有**任何语言指示。
   - `minimal` 模式:确认不注入(设计边界)。
3. 升级 dsh 后复核:`plugins.bundle.config` slot 契约与客户端 `configForms` 契约(ui-settings `config-form.ts` 的 get/set/unset)、`systemPrompt.context` 签名(system-prompt)、CONTEXT_ORDERS 表是否越过 130。**2026-11-04 已对 dsh 0.2.2-rc.1 复核通过**:0.2.2 只新增 `TOOL_APPLY_PATCH: 1350` / `TOOL_SCHEDULE: 2500`,CONTEXT_ORDERS 未变、130 仍空闲;**2026-11-12 对 0.2.2-rc.2 复核**:`TEAM_IDENTITY: 125` 已删除,130 仍空闲,`systemPrompt.context` / configForms / 21 门词典不变,`npm test` 47/47;`configForms.get('agent-lang')` / `get('locale')` 为单代接口;`settings.register` / `settingsScope` / `settings.get(ns)` 已删除。另确认注入文本**无 `{{...}}` 插值风险**——渲染期插值对 malformed / unknown 引用会抛错,而三条语言来源全程经 `BCP47.test()` 校验,这条校验链是必须保持的不变量(记录见 CHANGELOG v0.4.3)。
