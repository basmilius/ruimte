# Native iOS interface review

15 September 2026. Full review of the revised project home, welcome, pairing and AI
chat screens. This replaces the earlier machine-first design review. SwiftUI and
UIKit use native navigation, semantic colors, Dynamic Type and shared `MobileStyle`
tokens. Desktop project-switcher behavior is the source for project ordering.

The [experimental T3 SwiftUI PR](https://github.com/pingdotgg/t3code/pull/5178), at
`7a741eb7524e3cbac5b0fe3ac4a3a4eb09c73f18`, informed the compact composer, grouped
work log and transcript-first layout. Its source and screenshots were inspected;
the implementation here was written independently for Ruimte's existing contracts.

## Coverage

| Category | Evidence inspected | Result |
| --- | --- | --- |
| Typography | Welcome, project and chat phone/tablet-width fixtures, dark appearance and XXX Large text | Semantic text and bounded chat/welcome widths; controls remain readable |
| Surfaces | Native screenshots and shared color tokens | Flat project list, quiet conversation surfaces, distinct welcome and pairing controls |
| Animations | Composer focus state, diffable transcript updates and native navigation code | No new custom animations; slow-motion physical transitions not verified |
| Icons | Welcome assets, Apple button, project glyphs, chat controls | Real Ruimte and GitHub artwork, system Apple button, SF Symbols for actions |
| Performance | Shared connection leases, cache reconciliation, diffable timeline and bounded syntax cache | Project reads shared per machine; no per-token animation; physical frame rate not measured |

## Changes

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `apps/ios/App/Workspace/AppHome.swift:5`, `UnifiedProjects.swift:5` | Machine selection before reaching projects | One list across machines, open projects by last use and recently closed by close time; direct project navigation | Match the desktop mental model and shorten navigation |
| MEDIUM | `apps/ios/App/Workspace/UnifiedProjects.swift:27`, `apps/ios/App/AppRuntime.swift:30` | Independent per-page project lists | Cached offline rows, separate unavailable-folder state, machine/project identity and invalidation guards | Keep projects discoverable without confusing stale connections with missing folders |
| MEDIUM | `apps/ios/App/Workspace/WelcomePage.swift:6` | Generic login controls, server-defined provider order and a placeholder app glyph | Welcome with Ruimte artwork, native Apple sign-in first, official GitHub mark, matching button sizes and state feedback | Recognizable authentication and clear hierarchy on iOS and iPadOS |
| MEDIUM | `apps/ios/App/Workspace/AppHome.swift:5`, `PairMachinePage.swift:41` | Pairing behind an unlabeled plus button | Explicit pairing-link entry before and after sign-in, guided link entry, native Paste and a visible connect action | Make account-free connection discoverable |
| MEDIUM | `apps/ios/App/Sessions/ChatScreen.swift:7` | Permanently expanded composer controls | Compact reading state, expanded editing tools, keyboard-dismiss control and contextual stop/send | Leave more room for the conversation |
| MEDIUM | `apps/ios/App/Sessions/ChatTimeline.swift:116` | Separate tool entries and repeated Assistant labels | Consecutive tool/reasoning/subagent activity in an expandable work log; quiet message framing | Make answers easier to scan without losing tool details |
| LOW | `apps/ios/App/Sessions/MarkdownMessage.swift:6` | Dense inline code and fixed horizontal code scrolling | Semantic body spacing, inline-code treatment and code wrap/copy controls | Improve long-answer reading and code interaction |

## Considered and rejected

| Location | Candidate | Rejected because |
| --- | --- | --- |
| Project home | Group the entire list by machine | The user asked for the unified desktop switcher; recent use should determine order |
| Apple sign-in | Replace the web flow with native credential exchange | The existing server expects its web PKCE flow; the official button can start that flow |
| Chat | Animate streaming tokens or composer resizing | Frequent movement would interrupt reading and add work during streaming |
| Navigation | Copy T3's server/environment hierarchy | Ruimte owns projects per machine and already has shared connection/session lifetimes |

## Verification

- Full native simulator suite: 36 tests passed (30 XCTest and 6 Swift Testing), including 7 new project-list lifecycle tests.
- Final project-home layout: targeted native test passed again, with 8 welcome/project captures.
- Reviewed native screenshots cover welcome and projects in light/dark appearance, tablet width and XXX Large text, plus pairing and chat. Code wrap/copy and composer editing paths were inspected in code.
- `xcodebuild ... test CODE_SIGN_IDENTITY=-` used the iPhone 18 Pro iOS 27 simulator. The final home captures are in `/tmp/ruimte-ios-home-final`; chat and pairing captures are in `/tmp/ruimte-ios-projects-final`.
- `bun run check`, `bun run format` and `git diff --check` passed. Existing client lint warnings remain unchanged.
- Signed development build for Bas's iPhone 15 Pro Max passed, including both extensions. `codesign --verify --deep --strict` passed. `devicectl` installed and launched `app.ruimte.mobile` on that device.
- The first cache fixture exposed an unknown-schema lookup that silently discarded stored projects. It now uses the generated event schema; offline cache tests pass.

Not verified: live Apple/GitHub authorization, a new physical pairing, live keyboard
interaction, VoiceOver, physical iPad multitasking, all accessibility sizes, native
transitions at 10% speed, and physical frame-rate measurements. Fixtures do not prove
live network or push delivery. Direct ICE with TURN fallback remains unchanged.

## Verdict

Approve for the inspected screens after the recorded corrections. The unverified
interaction and physical-device checks above remain acceptance work.
