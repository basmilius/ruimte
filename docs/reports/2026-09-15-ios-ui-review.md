# Native iOS interface review

15 September 2026. Full review of the home screen, machine/project/view navigation,
chat timeline and composer, approval controls, and terminal controls. SwiftUI and
UIKit retain native navigation, Dynamic Type and SF Symbols. Shared semantic colors
live in `MobileStyle`; the blue accent follows the desktop client.

## Coverage

| Category | Evidence inspected | Result |
| --- | --- | --- |
| Typography | Chat at phone/tablet widths and XXX Large text; home and terminal screenshots | Clearer message roles, bounded reading width and scalable code type |
| Surfaces | Light/dark chat and machine screenshots; project/view row code | Shared panel colors, restrained separators and consistent icon tiles |
| Animations | Timeline display-link coalescing and native button/navigation code | No new custom animation; slow-motion device transitions not verified |
| Icons | Home, project rows, message roles and terminal controls | SF Symbols throughout; touch controls retain 44-point targets |
| Performance | Existing diffable timeline, visible-node drawing and bounded highlighting cache | No additional per-token animation or canvas bitmap; device frame rate not measured |

## Changes

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `apps/ios/App/Design/MobileStyle.swift:4`, `apps/ios/App/RuimteApp.swift:10` | Independent default colors | Shared accent, panel, border and icon styles | Consistent surfaces and icon weight |
| MEDIUM | `apps/ios/App/Workspace/AppHome.swift:14` | Form-like introduction and undifferentiated rows | Short welcome, full-width sign-in controls, account row, machine icons and secondary refresh action | Clear hierarchy and touch targets |
| MEDIUM | `apps/ios/App/Workspace/MachineProjectsPage.swift:19`, `apps/ios/App/Workspace/WorkspacePage.swift:122` | Plain labels and oversized connection status | Shared title/detail rows, compact connection status, project counts and selected-view marker | Optical alignment and stable numeric widths |
| MEDIUM | `apps/ios/App/Sessions/ChatTimeline.swift:110` | All message kinds carried similar weight; unbounded tablet lines | Distinct user bubble, assistant label, quieter tool rows and 720-point reading width | Typography and message hierarchy |
| MEDIUM | `apps/ios/App/Sessions/ChatScreen.swift:114` | Large composer and permanently expanded approval block | Composer grows from one line; compact approval with visible action description and expandable input; vertical controls for larger text | Space for conversation without hiding the decision's meaning |
| MEDIUM | `apps/ios/App/Sessions/MarkdownMessage.swift:154` | Gray slabs and fixed code typography | Content-sized tables, semantic panels, scalable monospaced code and flat-selector themes that avoid nondeterministic colors in Highlightr 2.3.0 | Readability in both appearances and at larger text sizes |
| LOW | `apps/ios/App/Sessions/ChatAttachmentButton.swift:20` | Loose attachment labels | File card with size, icon and download state | Consistent structure |
| MEDIUM | `apps/ios/App/Sessions/TerminalScreen.swift:29` | Flush terminal content and oversized text commands | Content inset, compact status/dimensions, 44-point Escape/Tab/Control keys and clear action | Touch targets and separation of controls from output |

## Considered and rejected

| Location | Candidate | Rejected because |
| --- | --- | --- |
| Native navigation | Replace navigation bars with a custom shell | Would lose familiar navigation and add gesture/accessibility work unrelated to the visual problems |
| Chat timeline | Animate each streamed update | Frequent movement would distract from reading and add rendering work |
| Canvas | Resize existing cards to fit a mobile layout | Their geometry is shared with desktop; this pass preserves the stored project layout |

## Verification

- Full simulator suite: 28 tests passed, including nine captured fixture screens.
- Final code-type and theme adjustments are checked again at phone/tablet widths, dark appearance and XXX Large text, with fresh launches to check stable colors.
- `bun run check`, `bun run format`, `bun run format:check` and `git diff --check` passed.
- Signed development build for the iPhone 15 Pro Max passed, including both extensions. `codesign --verify --deep --strict` passed.
- Screenshots cover welcome, machines in both appearances, chat in four variants, terminal and canvas.
- Fixtures exercise native rendering. They do not prove a live network connection, APNs delivery or physical iPad multitasking.
- Not verified: VoiceOver walkthrough, live keyboard interaction, slow-motion native transitions, all accessibility text sizes, and device frame-rate measurements.

## Verdict

Approve for the inspected screens after the recorded corrections. The unverified
interaction and device checks above remain separate acceptance work. Bas reported
that an interaction from the previous iPhone build worked; that report is not a
complete end-to-end test of the new design.
