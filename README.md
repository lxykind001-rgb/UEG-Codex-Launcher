# UEG Codex Launcher v0.7.0 — public source

Windows launcher and local Codex plugin for a 550C-style startup animation. The launcher covers the official app window or the full screen; it does not modify the official app. The plugin exposes display, subtitle, animation selection, and per-account role settings through `openai/settings` and a local MCP App form.

The default is UEG. This source package includes the UEG assets and a generic **Boot Protocol V0.1** host for self-contained HTML animations. Drop a trusted lowercase-named HTML (maximum 2 MB) in the launcher's `dist/win-x64-local/animation` folder, open **Plugins → UEG 启动设置 → Settings → 打开 UEG 设置**, click **扫描动画文件**, select it, and save. The folder path appears in Settings. A static native-button count is shown as a hint; Canvas or script-generated controls require an actual WebView2 test. See [the animation author guide](docs/BOOT_ANIMATION_AUTHOR_GUIDE.md) and [minimal example](examples/minimal-boot.html).

The HPC 0.9.7-p2 animation was tested and installed separately on the project owner's machine. Its HTML is **not in this MIT package** because its own license and third-party provenance are unresolved. `scripts/stage-hpc-candidate.ps1` verifies a separately obtained candidate ZIP and stages only its embedded HTML. The formal ZIP animation-pack importer is still a proposal; this release supports direct single-HTML scanning.

## Build and install

Requirements: Windows 10/11 x64, .NET 8 SDK, Node.js, WebView2 Runtime, and the official Codex desktop app. From the project root in PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-win.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-plugin.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-shortcut.ps1
```

`build-win.ps1` generates the runtime and English pages from preserved UEG source and publishes `dist/win-x64`. The plugin installer generates local `.mcp.json` and `installation.json`; both are ignored by Git. The shortcut installer creates a separate **Codex - UEG** entry from the official app registration and icon, without replacing the official shortcut. Default configuration is `previewOnly` and audio off. To preview before installing the shortcut, run `dist/win-x64/UEGCodexLauncher.exe`.

The account service supplies the email displayed in Settings. It may differ from the desktop app window's selected account; check the masked email before editing a card. Identity cards stay in local WebView2 user data and are never included in this source package.

## Checks

```powershell
node --test tests/bridge.test.cjs tests/structure.test.cjs tests/handoff.test.cjs
pwsh -NoProfile -File tests/cards.ps1
node tests/plugin-settings.cjs
node tests/plugin-host.cjs
```

For browser tests, run `npm install` and install Microsoft Edge. After building, `node tests/animation-import.cjs` checks Settings scanning and the WebView2 Boot V0.1 path in isolated data. `tests/hpc.cjs` applies only after staging a separately licensed HPC candidate. The default silent mode does not need optional WAV files. Real cold start, logged-out login flow, multiple displays/high DPI, and native foreground handoff for imported animations still require testing on the target machine.

## License

Original launcher and plugin additions: [MIT](LICENSE). Imported UEG code and assets retain their [MIT notice and credits](upstream-attribution/CREDITS.md); see [THIRD_PARTY.md](THIRD_PARTY.md). Optional WAV recordings and HPC candidate files are excluded.
