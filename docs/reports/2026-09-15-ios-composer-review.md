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

## List spacing and touch follow-up

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| LOW | `AppHome.swift`, `ProjectArtwork.swift` | Project icons had a tinted tile and centered row alignment | Remove the tile and align the icon slot to the top of the project text | Keep the original artwork visible without a second background |
| MEDIUM | `WorkspacePage.swift` | View rows forced zero vertical insets and a 44-point minimum | Use native list insets, as the Projects action rows do | Restore comfortable spacing while retaining one-line titles |
| MEDIUM | `ChatScreen.swift` | Glass appearance had no interactive response | Enable native interactive glass | Provide system touch feedback without a custom gesture animation |
| MEDIUM | `LucideIcon.swift` | Icons depended on Xcode's SVG asset conversion | Use native SwiftUI paths from a pinned open-source Lucide package | Avoid the reported SVG rendering defects |

This iteration uses the existing typography and colors. No custom animation was
added; touch response follows the system. Device build and physical review replace
a simulator run, following the agreed shorter iteration loop.

LucideSwift is pinned to 0.9.5. The wrapper translates the protocol's kebab-case
names to package identifiers and scales the stroke with the icon. Generated SVG
assets and their generator have been removed; custom project SVGs keep their
separate renderer. `bun run format` and `bun run check` passed.
The signed build succeeded and installed on Bas's iPhone. Build log:
`/tmp/ruimte-ios-native-lucide-device.log`. No simulator or test suite was run.

## Chat layout, rich composer and drawing follow-up

- Center conversation loading in the timeline. Extend the background and messages
  through the bottom safe area, with 12-point composer spacing on the sides and bottom.
- Show a glass scroll-to-latest button when messages are below the viewport. Respect
  reduced motion and resume following incoming messages after pressing it.
- Anchor the reader before expanding work logs and disclosure groups. Align hosted
  row content to the top and preserve the target offset during collection layout changes.
- Replace the plain composer field with a native text view that styles Markdown and
  selected file/skill tokens. Keep raw text, native selection, undo and IME composition.
  Insert selections at the caret and send metadata only for tokens still in the draft.
- Open drawings in an editable native surface. Support finger and Apple Pencil input,
  pressure, colors, widths, whole-element erasing, undo, pan and pinch zoom. Save shared
  freehand elements through the existing drawing protocol; preserve existing shapes.
- Keep unsaved drawings locally and merge independent remote edits. Conflicts retain
  the draft with Retry and explicit Discard actions. An own-save echo preserves an undo
  performed while the save was pending.

### Verification and remaining acceptance

The signed iPhone and iPad device builds passed. The final build was installed and
launched successfully on Bas's iPhone and iPad Pro. Logs:
`/tmp/ruimte-ios-drawing-chat-device.log` and
`/tmp/ruimte-ios-drawing-chat-ipad.log`.

The composer passed standalone Swift type checking and focused syntax checks for
UTF-16 caret insertion, token boundaries, filenames with spaces and code exclusion.
Repository type checks passed; lint reports existing desktop warnings. Four focused
drawing model tests were added but not run. No simulator run was performed.

Physical keyboard behavior, expansion motion, bottom spacing and Apple Pencil feel
still need device acceptance. Drawing supports freehand editing; creating or moving
shape/text objects is not included. Selected composer token metadata remains in memory
even though the draft text persists across restarts.

Future development builds may be installed on both Bas's iPhone and iPad Pro, following
his explicit authorization. Keep the short device-review iteration loop.

## Toolbar underlap and remaining chat motion

Full review of scroll boundaries and chat layout updates in the SwiftUI shell and
UIKit views. Retain native toolbar materials and the existing styling. This is a
source review and device build, with physical motion review left to Bas.

| Category | Evidence inspected | Result |
| --- | --- | --- |
| Typography | Chat row hosting and file/diff previews | No typography changes needed |
| Surfaces | Chat, canvas, drawing, diagram, browser, project lists, file/diff previews, terminal | Two repeated viewport findings corrected |
| Animations | Snapshot application, self-sizing invalidation and collection layout | Suppress UIKit row-resize animations |
| Icons | Existing toolbar controls | Retained; no icon changes needed |
| Performance | Display-link update batching and visible canvas drawing | Retained; no full-history remeasurement added |

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `ChatScreen.swift`, `CanvasPage.swift`, `DrawingEditorPage.swift`, `RenderDocumentPage.swift` | Native viewport ends at toolbar safe areas | Shared `MobileScrollViewport` extends the viewport behind bars and passes the original insets to UIKit | Content can scroll behind controls while its resting position and canvas fit remain unobscured |
| MEDIUM | `BrowserPage.swift` | Web content stops above the bottom toolbar | Extend the browser viewport underneath it and inset the scroll content | Preserve continuity while scrolling |
| MEDIUM | `ChatTimeline.swift` | SwiftUI transactions and snapshots disable animation, but later UIKit self-sizing passes can still animate | Disable animation during layout invalidation, collection layout and snapshot application | Rows should stay in place relative to the conversation while it scrolls |

Chat registers its collection as the controller's top content scroll view. Insets
come from the surrounding SwiftUI safe area, including rotation and window layout,
without extending through the keyboard. Drawing and canvas fit use the space between
the toolbars. Existing reader anchors and the deliberate scroll-to-latest animation
remain active.

| Location | Candidate | Rejected because |
| --- | --- | --- |
| Native project lists, file previews and Git diffs | Add the same viewport wrapper | These already use SwiftUI List/ScrollView safe-area behavior; the defect is in the UIKit wrappers |
| Terminal | Extend the emulator behind its status and keyboard rows | Those are occupied layout regions around a fixed remote terminal grid; this requires a separate terminal layout change |
| Chat | Disable self-sizing or measure every message upfront | This would break dynamic content or remove timeline virtualization |

Validation: `bun run format` and `bun run check` passed, with existing desktop lint
warnings. The signed device build passed and was installed on Bas's iPhone and iPad
Pro. Build log: `/tmp/ruimte-ios-scroll-toolbar-device.log`. No simulator run or new
test suite was added.
Apple documents the separate UIKit resize animation in
[What's new in UIKit](https://developer.apple.com/videos/play/wwdc2022/10068/).

Verdict: approve the inspected code. Toolbar underlap, long streaming conversations,
rotation, iPad window resizing and motion at 10% speed are not physically verified.

## iPad sidebar and project width

Full source review of the iPad project list and workspace sidebar, using existing
SwiftUI navigation, grouped lists and system colors.

| Category | Evidence inspected | Result |
| --- | --- | --- |
| Typography | Project names and sidebar rows | Existing single-line truncation retained |
| Surfaces | Sidebar background and project-list margins | Match the selected content background; center project rows within 760 points |
| Animations | Sidebar visibility toggle | Standard visibility animation; respect Reduce Motion |
| Icons | Back button and sidebar toggle placement | Place the toggle in the same parent navigation bar as Back |
| Performance | List rendering and width changes | Keep native List reuse and full-width scrolling |

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `WorkspacePage.swift` | Nested split-view toggle sits below the parent back button | Remove the split-view default toggles and bind a parent toolbar button to column visibility | Keep both navigation controls on one row |
| MEDIUM | `WorkspacePage.swift` | Grouped-list backdrop differs from the detail | Hide that backdrop on regular-width layouts and use the selected content's system background | Give sidebar and content the same background |
| MEDIUM | `AppHome.swift` | Project rows stretch across wide iPad windows | Center open and recently closed projects with a 760-point maximum content width | Keep project names and row actions within a comfortable reading width |

| Location | Candidate | Rejected because |
| --- | --- | --- |
| Projects | Constrain the entire List frame | The scroll surface and toolbar underlap should still span the window |
| Navigation | Replace the root navigation structure | Moving the toggle fixes the requested alignment without changing project navigation |

The sidebar uses the canvas background when a canvas is selected and the standard
content background otherwise. Compact-width layouts retain their existing navigation
and list margins. Physical alignment, light/dark appearance and window resizing remain
device acceptance; no simulator run was requested.

Verification: `bun run format`, `bun run check` and the signed device build passed.
Installed on Bas's iPad Pro and iPhone. Log: `/tmp/ruimte-ios-ipad-sidebar-device.log`.
The implementation uses Apple's supported
[default toolbar item removal](https://developer.apple.com/documentation/swiftui/view/toolbar(removing:))
and [scroll content margins](https://developer.apple.com/documentation/swiftui/view/contentmargins(_:for:)).
Verdict: approve the inspected code; physical layout and sidebar transitions remain
unverified.

## Composer keyboard focus regression

The rich UIKit composer retained a `FocusState` from the earlier SwiftUI TextField,
but no SwiftUI field was bound to it. A text update could therefore read `false` and
call `resignFirstResponder`, closing the keyboard after a keystroke. Apple's
[FocusState documentation](https://developer.apple.com/documentation/swiftui/focusstate/wrappedvalue)
describes that unbound state as false.

The composer now uses ordinary state synchronized with UITextView's begin/end editing
callbacks. Text and Markdown updates preserve that state; explicit dismiss and refocus
actions still use the same binding. Editability is updated only when it changes.

Physical continuous typing and deliberate keyboard dismissal remain device acceptance.
No simulator run was performed for this fix.
The signed build, `bun run format` and `bun run check` passed. Installed on Bas's
iPhone and iPad Pro. Build log: `/tmp/ruimte-ios-composer-focus-device.log`.
