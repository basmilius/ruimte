# Documentation

Reviewed on October 7, 2026, against `aada37fe5`. A report's original date and measurements
remain historical; its status note says which work is still relevant.

## Working documents

| Document | Purpose |
| --- | --- |
| [NEXT.md](NEXT.md) | Open implementation, acceptance and product decisions. Completed migrations are not new work. |
| [ADECORE-DEVELOPMENT.md](ADECORE-DEVELOPMENT.md) | Switching between published packages and the local ADE CORE checkout, validation and publishing order. |
| [SMART-EDITOR.md](SMART-EDITOR.md) | Current editor integration, decisions, acceptance and known limits. |
| [RELEASE.md](RELEASE.md) | Desktop and npm release workflow, build caches, signing and notarization. |
| [LINUX.md](LINUX.md) | Packaging constraints and remaining Linux CI/runtime acceptance. |

## Reports with open work

| Report | Remaining subject |
| --- | --- |
| [Plugins](reports/2026-09-14-plugins.html) | Scope, permissions, compatibility and installation lifecycle. |
| [Protocol versions](reports/2026-09-15-protocol-versions.html) | Compatibility window and version adapters. |
| [Cross-platform](reports/2026-09-24-cross-platform.html) | Linux acceptance and the deferred Windows implementation. |
| [Rust](reports/2026-09-24-rust.html) | Broker replacement and terminal-core spike; original benchmark and raw measurements retained. |
| [Providers](reports/2026-09-25-provider-research.html) | Copilot/Gemini chat and transport choices; Apple integration now exists. |
| [Desktop package architecture](reports/2026-10-01-desktop-package-architecture.html) | Remaining shared shell, bridge and search-list behavior. |
| [Home maintenance](reports/2026-10-01-ruimte-home-maintenance.html) | Temporary files, cold-session deletion and a separate log-rotation follow-up. |

The extraction, cutover, initial Monaco/LSP design and account/LAN implementation plans were
removed after completion. Remaining cutover and remote-device acceptance is in NEXT.md;
the current host behavior is in the application READMEs. Git retains the tracked history.

## Local research

`reports/private/` is ignored by git. It holds the October 7 audit and its probes, the older
audit's explicit follow-ups, the consolidated orchestration record and relevant captures,
Nodeterm/editor comparisons, and the MCP, model-comparison and tabs proposals. These files
are local evidence, not documents a fresh checkout is expected to contain.

Keep a report while it contains unique open work or evidence. Once its implementation is
complete, move remaining acceptance into NEXT.md and current behavior into the owning README.
Retain the probes, fixtures and results needed to assess open findings; report screenshots and
bulk upstream API responses do not need to accumulate with each revision.
