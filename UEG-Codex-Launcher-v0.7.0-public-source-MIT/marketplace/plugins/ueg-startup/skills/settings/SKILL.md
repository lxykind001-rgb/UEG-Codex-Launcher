---
name: settings
description: 打开 UEG 启动设置，调整应用覆盖或全屏、中英或英文字幕、按账户保存的角色身份卡。
---

1. Read `../../installation.json` relative to this skill directory to locate `projectRoot`.
2. Run `scripts/open-settings.ps1` from that project with PowerShell `-NoProfile -ExecutionPolicy Bypass -File`. It starts a hidden loopback settings service and returns one local URL with a capability fragment. Reuse this script on later invocations; it checks the existing server before starting one.
3. Discover `open_in_codex` and open the returned URL as a browser target in the current chat's right panel. Keep the full fragment in this tool call. Do not print the capability URL in the chat or open an external browser.
4. Confirm the panel opened. Let the user edit the form; save only changes explicitly requested by the user. Settings apply to the next launcher start.

The email shown comes from the local Codex account service and may differ from the account selected in another desktop window. Never read raw authentication files or tokens. Guest mode uses the default Liu Peiqiang card. This plugin opens the settings panel; startup animation is provided by the separate UEG shortcut, not by modifying the official client.
