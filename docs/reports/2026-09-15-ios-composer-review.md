# iOS composer and compatibility review

15 September 2026. Full review of the requested welcome, list, composer and
connection changes. SwiftUI uses the existing monochrome design, native Liquid
Glass and the UIKit message timeline. This follows the earlier
[project-list review](2026-09-15-ios-ui-review.md).

## Coverage

| Category | Evidence inspected | Result |
| --- | --- | --- |
| Typography | Welcome, long project/view labels, phone/tablet and large-text captures | Same sign-in title font; list names truncate on one line |
| Surfaces | Composer code, captures and native inset geometry | Native glass overlays the full-height timeline |
| Animations | Scroll-anchor regression suite and keyboard configuration | Native interactive keyboard dismissal; physical gestures not verified |
| Icons | Existing desktop provider marks, Lucide assets, SVG edge pixel assertions | Matching provider icon sizes, centered SVGs and live machine icons |
| Performance | Connection lifecycle test, renderer parity and resource bounds | Healthy connections survive route notifications; local drawing work runs off the main actor |

## Changes

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| LOW | `WelcomePage.swift`, `AppleMark.imageset` | Native Apple button locked the logo to a smaller size | Reuse the existing desktop Apple mark at the same 24-point size as GitHub, with identical title typography | Match optical weight without changing native authorization |
| MEDIUM | `ProjectSVGRasterizer.swift` | WebKit inherited the window's top safe-area inset | Disable automatic content insets | Keep SVG content centered in its thumbnail |
| MEDIUM | `AppHome.swift`, `MachineIconState.swift`, `SharedMachineSession.swift` | Subtitle hardcoded a system computer or offline icon | Read the actual Lucide/emoji icon from the machine and follow changes | Match desktop and pairing-only machines; stale replies cannot replace newer icons |
| MEDIUM | `AppHome.swift`, `WorkspacePage.swift` | Long labels occupied two lines | Single-line tail ellipsis | Keep project and view rows compact |
| MEDIUM | `ChatScreen.swift` | Opaque composer panel and bottom strip | Native `glassEffect` in an overlay | Use Liquid Glass with messages visible behind it |
| HIGH | `ChatScreen.swift`, `ChatTimeline.swift` | Only the placeholder reliably focused input; keyboard-dismiss button occupied composer space | Focus from the padded input area and empty panel space; dismiss through message taps, interactive scroll or accessibility escape | Make editing reachable while retaining message text selection |
| MEDIUM | `ChatTimeline.swift` | Composer reduced the message viewport | Full-height collection with measured composer inset | Scroll messages behind the panel while keeping the last message readable |
| HIGH | `MachineConnections.swift` | Default-route notifications closed healthy links | Ignore identical notifications and let ICE/liveness detect actual link failure | Preserve pending sends without reconnecting or resending |
| HIGH | `TerminalSnapshot.swift` | Older daemon rejected dimensionless attach | Retry only bad-request using its current dimensions | Open legacy terminals without substituting phone dimensions |
| HIGH | `DocumentSceneLoader.swift`, renderer resources | Older daemon did not recognize drawing/diagram rendering requests | Fall back only on unknown-request, rendering the raw document with the same bundled pure renderer | Open drawings on 0.0.16 without restarting active sessions |

## Considered and rejected

| Location | Candidate | Rejected because |
| --- | --- | --- |
| Composer | Blur material over an opaque bottom strip | Messages would still not appear behind the composer |
| Keyboard | End editing across the entire window on every tap | Could disrupt selection in message text; only the composer focus changes |
| Daemon | Restart the installed machine onto main | Would interrupt active sessions; compatibility can be supplied in the app |
| Terminal | Retry with phone viewport dimensions | Would resize the desktop terminal |

## Verification

- First focused native UI run passed 20 tests. Captures: `/tmp/ruimte-ios-composer-captures`.
- Full native suite passed 79 tests. Log: `/tmp/ruimte-ios-composer-full-tests.log`. The final removal of window-wide keyboard dismissal was compiled in the device build without another simulator run.
- Transport package passed 29 tests, including a pending `chat.send` during route changes and recovery from an actual channel failure.
- Shared renderer TypeScript tests passed 7 tests. Native tests compare all supported drawing shapes and diagrams against generated daemon scenes and check that document text cannot execute code.
- `bun run format`, `bun run check` and generated renderer freshness checks passed. Existing desktop lint warnings remain.
- Read-only inspection found installed daemon version 0.0.16. Its tagged dispatcher uses the expected legacy error codes.
- The signed device build succeeded and installed on Bas's iPhone. Build log: `/tmp/ruimte-ios-composer-device.log`.

The actual reported disconnect was not captured on the device; the fix covers a
reproduced interruption path. Physical taps, keyboard swipes, text selection,
VoiceOver, reduced motion and slow-motion transitions remain user acceptance.
Legacy attach can race a concurrent desktop resize between reading and applying
the dimensions; current daemons support atomic follow mode. No server deployment
or restart was performed.

## Verdict

Approve for the inspected scope. Physical interactions and live machine data remain
acceptance work. Following Bas's preference, subsequent small UI iterations go
directly to an iPhone build; simulator runs are reserved for targeted regressions.

References: Apple's [Liquid Glass guidance](https://developer.apple.com/documentation/SwiftUI/Applying-Liquid-Glass-to-custom-views)
and [Sign in with Apple guidance](https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple).

## Physical SVG follow-up

Bas's 20:14 screenshot shows clipped content and black patches in project SVGs,
including Flux. The earlier simulator edge checks did not capture this failure.
The renderer now decodes the SVG image and draws it directly into a transparent
128-pixel canvas, then loads the PNG bytes into UIImage. It no longer snapshots
WebKit layers or inserts a hidden renderer into the app window. SVG content stays
in image mode with scripts and external requests disabled; only the app's fixed
conversion script runs in an isolated content world.

The signed iPhone build passed. No simulator run was performed for this iteration;
the physical rendering remains to be confirmed. Log: `/tmp/ruimte-ios-svg-device.log`.
