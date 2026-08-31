# AGENTS.md

面向后续在本仓库继续开发的 Agent / 贡献者。读完再动手。

## 项目一句话

「dsh-agent-lang」:DSH 插件,控制模型产出文本的三个语言通道——**工具调用 `description`**(含 PTC 模式 `run_code` 的 description,即调用卡片标题)、**模型思考**、**回复输出**——每个通道独立配置:跟随界面语言 / 强制指定语言 / 关闭,支持一键全部跟随、一键全部关闭。默认仅工具描述通道开启(auto),思考与回复默认关闭(保持现状)。做法:主机面注册一条全局动态 runtime-context 指示 + 浏览器半上报界面语言 + 设置 → 插件卡片控制行为。

## 环境与工具

- 本机已安装 GitHub CLI(`gh`,已认证 KannaKuron):建仓、推送、release 优先用 gh。
- 发布(2026-08-31 起 npm OIDC 全链路已就绪,与 dsh-better-workspace 同款):bootstrap 首版 0.3.0 已在 npmjs 建包,Trusted Publisher 已登记(repo=KannaKuron/dsh-agent-lang,file=.\.github/workflows/npm-publish.yml,permissions=publish);**日常发版**:`npm test` 全绿 → 改版本(package.json 与 dsh.plugin.json 两个都改且一致)→ `git tag vX.Y.Z && git push origin main --tags` → 仓库目录内 `gh release create vX.Y.Z --title "vX.Y.Z" --generate-notes` → Release published 触发 OIDC workflow(node 24 + id-token: write,零令牌)自动发 npm → `gh run watch <id> --exit-status` 看绿 → `npm view dsh-agent-lang version --registry=https://registry.npmjs.org` 确认 → `curl -X PUT https://registry.npmmirror.com/dsh-agent-lang/sync` 同步 npmmirror。
- 本机 web profile 装本地开发版:`npm pack` 出 tarball → 在 `(dsh home)/profiles/web` 里 `pnpm add <tarball>` → 重启 DSH(`package.json` 的 `dsh.bundle.patch` 声明自动挂载,无需手改 profile patch)。

- **发布事故处置(2026-08-31,v0.3.1 实际教训)**:workflow 文件在发布周期内被「删除→恢复」或仓库 Actions 被 toggle 后,GitHub 会要求**文件内容发生变化**才重新注册(re-touch 无内容变化的 commit 无效),且**半激活期创建的 run 会永久卡 queued(连 job 都不生成,jobs = 0 是铁证)**——事件流有 ReleaseEvent 但 actions/runs total_count 为 0 = 事件根本没触发 workflow。处置:① 修改 workflow(内容变化,如加 `workflow_dispatch:`)并 push;② `gh run cancel` 作废卡死的 queued run;③ 重新 `gh workflow run` 手动触发(本 workflow 已带 `workflow_dispatch`,应急补发不需要再发假 release);④ 跑绿后 `npm view <pkg> version --registry=https://registry.npmjs.org` 确认 → npmmirror 同步。诊断命令:`gh run list --repo <repo> --limit 5`、`gh api repos/<repo>/actions/runs --jq .total_count`(0 = 从未触发)、`gh run view <id> --json status,conclusion`。

## 目录地图

| 路径 | 作用 |
|---|---|
| `src/index.js` | host 半:注册 settings 命名空间 `agent-lang`(动态 import schemastery)+ 全局动态 runtime-context 指示(`systemPrompt.context`) |
| `src/client.js` | 浏览器半(手写 ModuleLoader bundle):上报界面语言(`settingsScope.set('uiLocale')`)+ 注册 `settings.plugin.item` 设置卡片 |
| `cordis.patch.yml` | `dsh plugin add` 官方安装通道的挂载声明(insert 一行插件 row,主机面全局挂载) |
| `dsh.plugin.json` | 插件注册表清单(id `dsh-external/dsh-agent-lang`) |
| `tests/smoke.mjs` | 冒烟测试(纯文件/helper 级,零依赖):helper 逻辑、源码纪律(require 白名单、无 import/JSX、词典对齐)、清单一致性 |

## 核心不变量(改代码前必读)

1. **只注入提示,不改资产**。绝不修改 preset / persona / 工具 schema / 任何 dsh 发行文件:它们是部署资产,升级覆盖 + 影响 request-cache 稳定性设计。唯一通道是运行时注册的提示贡献。
2. **通道是 `systemPrompt.context()`,不是 `section()`**。理由:与沙箱/审批策略同列(语义契合)、每轮请求刷新(语言切换下一轮生效)、渲染在请求末尾(近因压过工具 schema 的英文指引)。空文本贡献会在渲染时被丢弃——**完全未检测到语言**时返回 '' 是**特性**(零提示噪声);**英文自 v0.3.0 起是正常目标语言**(部分模型思考/输出会混杂多语言,显式英文指示同样纠正),仅为英文自身省略 ", not in English" 从句。已知例外:`minimal` preset 的 persona `complete: true` 且 `includeRuntimeContext: false`,提示对一切后挂贡献者封闭——接受,文档声明,不要试图穿透(waterfall 也改不动 complete 恢复)。
3. **语言来源优先级(纯函数 `pickDisplayLanguage`,测试覆盖)**:mode off → 无;force+合法 forceLocale → forceLocale;auto:locale ns 的 `preference` > agent-lang ns 的 `uiLocale`;非法 BCP 47 一律忽略。**绝不写 `locale` 命名空间**(那是用户的显式选择,写它会破坏「absence delegates to browser」语义);client 只写自己 ns 的 `uiLocale` 单字段(settings 写是逐字段深合并,mode/forceLocale 永远幸存)。
4. **设置命名空间 schema 必须是可调用的 schemastery 对象**(`schema(merged)` 解析值;zod 会抛 `not a function` 且命名空间永不服务 → 卡片永不出现,2026-08 dsh-better-workspace 实测根因)。因此 host 半用**动态** `import('@deepseek-ai/schemastery')`(保持冒烟测试零依赖可 import 本文件),运行时经 profile 共享 fallback 解析(实测可行);`@deepseek-ai/dsh-settings` 的 `settingsNamespace()` 做 era 探测(新 dsh 已移除该 helper,register 直接收字符串;旧 dsh 收 branded 形态,单次调用双兼容)。schemastery 只进 peerDependencies,不进 dependencies。
5. **无构建**。host 半纯 ESM JS;client 半是**手写 ModuleLoader bundle**(`window.__ModuleLoader__.load({id, factory})`,id=包名):`require` 只允许基线白名单(react、react/jsx-runtime、react-dom、react-dom/client、@deepseek-ai/cordis、@deepseek-ai/dsh-client-store、@deepseek-ai/dsh-client-ui-slots、@deepseek-ai/dsh-client-ui-primitives),冒烟测试强制;无 import/JSX/TS 语法。
6. **slot 契约**:`settings.plugin.item` 是 keyed 槽,**key = 设置命名空间**(`agent-lang`);tab 派发「宿主已服务命名空间 ∩ 已注册卡片」——宿主半不注册命名空间,卡片永远不出现。卡片 chrome 必须手写(`dl-` 前缀 CSS 镜像官方 PluginCard.module.css 的 token),不能 import ui-settings-plugins(不在白名单)。命名空间不可用(`snap.status !== 'ready'`)时卡片渲染 null(官方行为)。
7. **词典纪律**:NS = agentLang;zh/en 词典 key 完全对齐且覆盖每个静态 t(...) 调用,冒烟测试逐 key 校验。语言自称映射(zh→简体中文)host/client 各一份,改要同步。
8. **React 纪律**:纯 React.createElement;组件定义在模块层(内联定义会在父渲染时重挂载);所有 hooks 先于任何 early return;primitives 图标经特征探测降级(`icon()` 失败回退文本 ▾)。
9. **context order 125** 是自由槽位,排在官方 CONTEXT_ORDERS(SANDBOX_POLICY 110 / APPROVAL_POLICY 115 / SUBAGENT_DELEGATION 120)之后;若官方表扩张越过 125,换一个空闲数。
10. **slot 注册 options 的顶层字段不会传给组件**(2026-08-31 实测:首版把 scope/localeScope 放顶层,组件 props.scope 为 undefined,useSyncExternalStore(undefined.subscribe) 渲染即崩,卡片无声消失而上报链路照常)。只有协议字段生效:`locale` 绑 t、`store` 绑 store seat、**`inject` 工厂返回的成员按原名成为 props**(hooks 子对象绑成 useXxx)。传对象一律走 inject 工厂;组件外再包 QuietBoundary(渲染失败只废本卡)。对照范本:已安装的 dsh-better-workspace 0.6.0(sandbox 里的开发副本可能滞后,以 profile node_modules 里实际装的版本为准)。
11. **host 半读未声明服务必须 `ctx.get('name')`**:`ctx.inject(['systemPrompt'], (pctx) => ...)` 的 pctx 只有声明过的服务可作属性访问,`pctx.settings?.get?.(...)` 这种未声明属性读取**静默 undefined**(可选链连错都不报),指示因此永远空文本(2026-08-31 实测:卡片/上报全正常但指示从未注入,agent 描述依旧英文)。测试已锁定 `pctx.get('settings')` 形态。

## 验证清单(改动后)

1. `npm test` 全绿(28 项)。
2. 真机(web profile 重启 DSH):
   - 页面加载后 `~/.dsh/settings.yaml` 出现 `agent-lang:` 段(`uiLocale` 为当前界面语言);
   - 任意非 minimal 模式新会话:工具调用卡片描述为界面语言(中文界面→中文描述);
   - 设置 → 通用 → 语言 切换语言:下一轮请求描述跟随切换;
   - 设置 → 插件 → 工具描述语言卡片:三段切换、强制语言输入、检测链显示;
   - `minimal` 模式:确认不注入(设计边界)。
3. 升级 dsh 后复核:`settings.plugin.item` slot 契约(ui-settings-plugins 的 slot-contract.ts)、`SettingsScope` 接口(ui-settings 的 settings-contract.ts)、`systemPrompt.context` 签名(system-prompt)、CONTEXT_ORDERS 表是否越过 125。
