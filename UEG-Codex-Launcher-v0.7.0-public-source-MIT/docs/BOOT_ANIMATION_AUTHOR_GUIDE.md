# 自制启动动画：单 HTML 接入指南

启动器使用 **Boot Protocol V0.1**。运行时入口是一个自包含 HTML；ZIP 的 `pack.json`、校验清单和许可文件可用于发布审查，但页面本身只需 `boot.html`。当前设置页的扫描按钮读取启动器发布目录下 `animation/*.html`，不自动解压 ZIP。文件名作为动画 ID，使用小写字母、数字、`_` 或 `-`，最多 41 个字符；单文件不超过 2 MB。放入文件后打开插件设置或点击“扫描动画文件”，选择动画并保存；下次启动生效。缺失或播放失败时回退 UEG。

## 消息格式

宿主在页面加载后发送一次：

```json
{"type":"boot:init","protocolVersion":1,"sessionId":"host-generated-id","mode":"launch","language":"en","quality":"high","card":{"displayName":"Engineer","role":"Laboratory Member","organization":null,"avatar":null}}
```

`mode` 为 `preview` 或 `launch`；`language` 为 `en` 或 `zh`；`quality` 为 `high` 或 `eco`。`card` 只用于显示。头像是受限的 PNG/JPEG/WebP data URI 或 `null`；不得接收登录凭据，也不得把卡片文字当作已认证身份。

页面使用 `window.chrome.webview.addEventListener('message', ...)` 接收消息，使用 `window.chrome.webview.postMessage({...})` 回传：

| 时机 | 回传 |
| --- | --- |
| 首帧已绘制 | `{"type":"boot:ready","protocolVersion":1,"sessionId":"同一 ID"}` |
| 正式启动的 Continue 收尾完成 | `{"type":"boot:done","protocolVersion":1,"sessionId":"同一 ID","reason":"complete"}` |
| 正式启动的 Esc 收尾完成 | `{"type":"boot:done","protocolVersion":1,"sessionId":"同一 ID","reason":"skip"}` |
| 无法继续播放 | `{"type":"boot:error","protocolVersion":1,"sessionId":"同一 ID","code":"RENDERER_FATAL","message":"简短说明"}` |

每次页面会话只接受一次 `boot:init`，只发一次 `boot:ready`，且最多发一次终止事件（`boot:done` 或 `boot:error`）。回传必须原样携带启动器给出的 `sessionId`。预览模式的 Continue 仅演示动画，不发送 `boot:done`；正式模式始终提供 Continue 和 Esc。动画不启动 Codex，也不操作窗口；这些由宿主完成。

## 给动画 Agent 的任务文本

> 制作一个自包含、离线运行的 HTML 启动动画，文件名使用小写英文 ID，文件小于 2 MB。实现本文的 Boot Protocol V0.1：WebView2 收到 `boot:init` 后渲染显示卡，首帧完成发送一次 `boot:ready`；正式模式 Continue/Esc 收尾后分别发送一次 `boot:done complete/skip`；不可恢复错误发送一次 `boot:error`；预览模式不发送 `boot:done`。原样回传 `protocolVersion:1` 和 `sessionId`。用 `textContent` 显示卡片文字，空字段隐藏，不显示邮箱或认证信息。按钮使用原生 `<button>`；不依赖网络或外部文件。交付 HTML、许可证与素材来源、SHA-256、预览和正式模式测试结果。

可从 [`examples/minimal-boot.html`](../examples/minimal-boot.html) 开始。该示例有一个原生 Continue 按钮，Esc 可跳过。

## 扫描与验收边界

设置页显示的是 HTML 中原生 `<button>`、按钮型 `<input>` 和 `role="button"` 的**静态候选数量**，不等于可点击性证明。Canvas 点击区、运行时生成的按钮和脚本绑定状态无法仅靠文件扫描可靠判断；动画作者必须用 WebView2 实测 Continue/Esc 及消息。动画页面的外部网络资源由启动器拦截；请内联样式、脚本和素材。

P2 HPC 包已经采用这种运行时入口（`boot.html`）；其 `pack.json` 是发布元数据。当前启动器的正式 ZIP 包导入器尚未实现，P2 通过校验脚本安装到本机候选目录。公开发布任何动画前需另行确认该动画自身的许可与第三方素材来源。真实 Codex 窗口前台交接仍需实机验收。
