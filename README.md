# dsh-agent-lang

简体中文 | [English](README_EN.md) | [日本語](README_JA.md) | [한국어](README_KO.md)

> Agent 语言控制 —— 让 [DeepSeek Harness (DSH)](https://www.npmjs.com/package/@deepseek-ai/dsh) 里模型的**工具描述、思考、回复输出**三个通道的语言各自可配:跟随界面语言、强制指定语言、或关闭,支持一键全部跟随/一键全关。默认只开工具描述通道(含 PTC 模式 `run_code` 的 `description`,即工具卡片标题)跟随界面语言,替代永远英文。

## 为什么需要它

DSH 里每一次工具调用的 `description` 参数都是必填的,而且**原样显示在 UI 的调用卡片上**(PTC 模式下它就是 `run_code` 卡片的标题)。但工具 schema 里对这个字段的说明全是英文措辞加英文示例("5-10 words … Examples: 'Count TODO markers…'"),所以模型默认永远写英文描述——界面是中文的用户,看每一步都在看英文。

本插件**只改提示词侧**:注册一条全局动态 runtime-context 指示,告诉模型当前 GUI 显示语言、并要求所有工具调用描述用该语言书写。不修改任何 preset、persona 或工具 schema(它们是部署资产,升级会覆盖)。

## 支持范围

| 模式 / preset | 支持 | 说明 |
|---|---|---|
| `standard`(标准模式) | ✅ | |
| `ptc`(PTC 模式,旧名 `code`) | ✅ | `run_code` 的 `description` 同样覆盖 |
| `cordis`(创造模式) | ✅ | |
| 用户自建 preset(含 `ptc-cordis`、dsh-gitbash-shell 的 gitbash 变体等) | ✅ | 挂在主机面,对进程内所有未封闭提示的 preset 生效 |
| `minimal`(极简模式) | ❌(设计如此) | minimal 的 persona 是 `complete: true` 且压制 runtime context,提示词对一切后挂贡献者封闭——任何提示级插件都无法进入,需要产品侧改动 |

## 工作原理

```
浏览器(GUI)                          DSH Host 进程
┌─────────────────────┐   上报当前界面语言   ┌──────────────────────────────┐
│ locale 运行时        │ ─────────────────▶ │ settings ns「agent-lang」       │
│ (显式选择,或浏览器    │  (只写 uiLocale 字段) │   .uiLocale  ← 浏览器上报     │
│  navigator 匹配)     │                    │   .mode/.forceLocale ← 设置卡片 │
└─────────────────────┘                    │ settings ns「locale」(只读)     │
                                           │   .preference ← 设置里的显式选择 │
                                           └──────────────┬───────────────┘
                                                          │ 每次请求组装时求值
                                           ┌──────────────▼───────────────┐
                                           │ systemPrompt.context(全局)    │
                                           │ 「用 <语言> 写工具调用描述」     │
                                           └──────────────────────────────┘
```

- **检测优先级**(auto 模式):设置 → 通用 → 语言里的**显式选择** > 浏览器上报的当前语言;**英文也是正常目标语言**(v0.3.0 起)——部分模型会在思考/输出里混杂多语言,显式英文指示同样能纠正;仅完全未检测到语言时不注入。
- **注入通道**:`systemPrompt.context()` —— 与沙箱/审批策略同一个每轮刷新的 runtime-context 快照,渲染在请求末尾,近因盖过工具 schema 里的英文指引;**切换界面语言后下一轮请求即生效**,无需重启。
- **设置卡片**:设置 → 插件 里出现本插件的卡片(与宿主已服务的设置命名空间自动配对),可切换行为:跟随界面语言 / 强制指定语言(下拉候选或自填 BCP 47 标签,如 `zh`、`ja`)/ 关闭,并显示当前检测链。

## 安装

```bash
dsh plugin --profile web add dsh-agent-lang   # npm 公开包
# 源码与 Release: https://github.com/KannaKuron/dsh-agent-lang
```

纯 JS、零构建、零安装依赖(schemastery 以 peer 声明,经 profile 共享解析),安装不触发构建脚本。装完重启 DSH,打开任意会话即可;设置 → 插件 里可找到「工具描述语言」卡片。

### 本地开发版安装

```bash
npm pack                       # 出 tarball
# 在 (dsh home)/profiles/web 里:
pnpm add <tarball 路径>          # package.json 的 dsh.bundle.patch 声明会自动挂载
# 重启 DSH
```

## 验证

1. 安装并重启 DSH,**硬刷新一次页面**(⌘/Ctrl+Shift+R,见「已知边界」第 1 条),打开 Web GUI(浏览器语言或设置选择为中文);
2. `~/.dsh/settings.yaml` 出现 `agent-lang:` 段(`uiLocale: zh`,页面加载后);
3. 新建任意模式的会话,让模型跑几步工具调用——卡片描述应为中文;
4. 设置 → 通用 → 语言 里切换语言,再发一条消息——下一轮请求描述即切换;
5. 设置 → 插件 → 工具描述语言:切到「强制指定语言」,下拉选 `ja`(或自填标签),描述变日文;切「关闭」回到英文。

## 已知边界

- **新装/更新后的首次启动需硬刷新一次**(2026-08-31 真机实测):首次页面加载可能赶上客户端模块表重建(combo revision 变化),新装包被暂时排除——表现为设置卡片未出现,但 `settings.yaml` 已有 `uiLocale` 上报痕迹(上报先于剔除发生)。硬刷新(⌘/Ctrl+Shift+R)即恢复;日常重启不复发。
- **minimal 模式**:提示词封闭(见上表),不受本插件影响。
- **无浏览器页面时**(如纯 CLI 部署):只有「显式选择」一条检测链;从未在设置里选过语言则不注入。
- **多浏览器/远程页面**:界面语言是全局单值,后打开的页面上报会覆盖前者;非 loopback 页面的设置选择可能进程本地化(DSH 行为)。
- 子代理 / workflow 的模型同样看到该指示(它们的描述也显示在 UI 里,语义一致)。

## 许可

MIT
