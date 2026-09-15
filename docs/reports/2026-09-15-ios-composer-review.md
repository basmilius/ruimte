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

## Full composer and Lucide throughout the app

Full source review of the composer and app-authored icons, including Live Activities.
Use the existing LucideSwift dependency and SwiftUI glass styling.

| Category | Evidence inspected | Result |
| --- | --- | --- |
| Typography | Composer text, model selector and compact icon labels | Keep text sizes; rasterize icons at their intended point sizes |
| Surfaces | Composer shape, text insets and bottom controls | Concentric corners with a 24-point minimum, 12-point outer margins and more inner clearance |
| Animations | Focus-dependent composer layout | Remove the compact/full switch; keep one stable editor and controls |
| Icons | App UI and ActivityWidget | Replace authored SF Symbol calls with Lucide; preserve native system controls and brand artwork |
| Performance | Lucide image conversion and name lookup | Bound template-image cache to 256 entries and resolve normalized names through a dictionary |

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `ChatScreen.swift` | Plus, photo and model controls disappear in the empty unfocused state | Keep the full controls visible | Make available actions discoverable without first focusing the editor |
| MEDIUM | `ChatScreen.swift` | Fixed 24-point glass corners | Use `ConcentricRectangle` with a 24-point minimum and matching touch shape | Follow the containing screen/window curvature without device-specific radius guesses |
| MEDIUM | App design, sessions, workspace, pages, notifications and `RuimteActivityWidget.swift` | Mixed app-authored SF Symbols and Lucide | Use Lucide paths and template images, including menu labels and empty states | Apply one icon family and stroke proportion throughout the app |
| MEDIUM | `LucideIcon.swift` | Kebab-case conversion misses internal capitals such as `grid3X3` | Match normalized names against the package enum | Prevent valid numeric icon names from falling back to a question mark |

Status dots and the drawing color swatch remain filled geometric indicators. Native
menus receive template Images so iOS can display the icons alongside their labels.
Custom project artwork, emoji and provider logos retain their own rendering.

| Location | Candidate | Rejected because |
| --- | --- | --- |
| Composer | Guess a radius for each iPhone model | The system provides screen/window-relative corners |
| Menus | Pass only a custom stroked Shape as the icon | Native menu presentation needs an image-compatible label |
| Navigation | Replace system-generated back/search controls | Preserve their native behavior and accessibility |

Verification: all 56 literal and conditional app icon names resolve against the pinned
package. No authored `systemName:` or `systemImage:` calls remain in the app or its
extensions. Repository format and type/lint checks passed. No simulator run was made.
Device curvature, native menu icon rendering, Dynamic Type and physical typing remain
acceptance checks. Apple's [ConcentricRectangle documentation](https://developer.apple.com/documentation/swiftui/concentricrectangle)
describes the corner behavior used here.

The signed app and Live Activity extension built successfully and were installed on
Bas's iPhone and iPad Pro. Log: `/tmp/ruimte-ios-lucide-composer-device.log`.
Verdict: approve the inspected code, with the physical checks above still unverified.

## Project tabs, iPad alignment and chat scrolling

Full source review of the SwiftUI project navigation, iPad shell and UIKit chat
viewport. Use the existing Lucide icons and native iOS 26 tab and toolbar APIs.

| Category | Evidence inspected | Result |
| --- | --- | --- |
| Typography | Projects navigation title on iPad | Use an inline centered title above the centered list |
| Surfaces | Split sidebar, chat dock and action menus | Add a sidebar separator, reduce the scroll button to 36 points inside a 44-point touch target, remove ellipsis toolbar backgrounds |
| Animations | Collection layout, snapshots and offset restoration | Keep native drag/deceleration; restore reading position only after content or geometry changes |
| Icons | Project tabs, usage and overflow actions | Lucide labels for all five tabs; usage replaces the tools button |
| Performance | Hosted chat rows and tab navigation | Give rows intrinsic height and no safe-area adjustment; retain native tab state |

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| HIGH | `ChatTimeline.swift` | Hosted message content inherits safe areas and every layout restores its offset | The viewport owns insets; messages ignore safe areas, and unchanged geometry leaves the native offset alone | Prevent messages appearing pinned while the collection moves behind the toolbar |
| MEDIUM | `ChatTimeline.swift` | Layout invalidations suppress animation during interaction | Standard compositional layout, with nonanimated data snapshots retained | Preserve native dragging and deceleration |
| MEDIUM | `ChatScreen.swift` | Large scroll button directly above the composer | Smaller round control with more clearance; beside the composer when an iPad pane is at least 640 points wide | Keep the control distinct without covering the editor |
| MEDIUM | `AppHome.swift`, `WorkspacePage.swift` | Left-aligned large title above a centered iPad list; no sidebar boundary | Center the inline Projects title and add a one-point sidebar separator | Align the heading with its content and clarify the split |
| MEDIUM | `WorkspacePage.swift` | Search field and a separate Project tools sheet | Views, Files, Git, Processes and Search tabs; Usage in the toolbar | Expose the requested project destinations directly |
| LOW | `ChatScreen.swift`, `MachineFilesPage.swift` | Circular glass background around ellipsis actions | Ellipsis-only toolbar items | Apply the requested appearance while retaining native menu interaction |

Search uses the native [search tab role](https://developer.apple.com/documentation/swiftui/tabrole/search)
and a searchable TabView. The action menus use Apple's
[toolbar background visibility](https://developer.apple.com/documentation/swiftui/toolbarcontent/sharedbackgroundvisibility(_:)).

| Location | Candidate | Rejected because |
| --- | --- | --- |
| Chat scrolling | Restore the offset on every layout pass | Native scrolling itself causes layout passes |
| iPad composer | Add the button gutter only when the button appears | This would change editor width while scrolling |
| Project tabs | Draw a custom floating bar | Native TabView supplies platform layout, search and accessibility behavior |

The signed build and 17 targeted tests passed on the iPad (8 scroll, 9 drawing).
Build: `/tmp/ruimte-ios-tabs-drawing-final.log`; tests: `/tmp/ruimte-ios-tabs-drawing-tests.log`.
The final rejected-gesture preview correction was compiled after that test run.
The added scroll regression checks
unchanged content and viewport geometry with synthetic collection cells. It does not
verify the visual movement of hosted Markdown near the toolbar. Physical scrolling,
tab transitions and iPad sizing remain acceptance checks; no simulator run is planned.

## Native drawing authoring

The drawing editor now exposes the web editor's authoring tool set: pan, select,
rectangle, diamond, ellipse, arrow, line, pen, text, sticky note and eraser. Pan is
the initial mode. Shapes have stroke, fill, roughness and text controls. Selection
supports marquee, moving, resizing, rotation, line endpoints, duplication,
copy/cut/paste, layer order, locking and deletion. Undo/redo and fit/zoom controls
remain local editing actions; saves use the existing revision-checked protocol.

The compact dock uses interactive glass buttons with 44-point touch areas and
hover feedback. Pencil pressure is retained; additional palm/finger touches cannot
restart an active Pencil stroke. Pencil double-tap and squeeze follow the OS
preferred action. PNG and SVG can be copied or sent through the share sheet, with
an optional background and selection-only export.

| Category | Evidence inspected | Result |
| --- | --- | --- |
| Typography | Text editing and export fonts | Native text sheet; Chalkboard SE for the hand font, with cursive fallback in exported SVG |
| Surfaces | Dock controls and canvas hit testing | Compact control layout, visible selection handles and no circle around the overflow icon |
| Animations | Shape preview and final render | Stable per-shape seed; retain the committed preview until the final scene arrives |
| Icons | All 30 drawing action/tool names | Resolve against the pinned Lucide package |
| Performance | Scene viewport and raster export | Draw only the visible canvas region; cap PNG output at 4096 pixels on its longest edge |

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| HIGH | `DrawingEditorPage.swift`, `DrawingCanvas.swift`, `DrawingAuthoring.swift` | Basic pen/eraser editing only | Add the complete authoring tool set and native selection gestures | Make existing web drawings editable on iPhone and iPad |
| MEDIUM | `DrawingEditorModel.swift` | Pen is the initial mode | Start in Pan; retain explicit tool selection | A normal drag moves the canvas |
| MEDIUM | `DrawingCanvas.swift` | Pencil and later finger touches can reinitialize a gesture | Ignore added finger touches while Pencil is active | Preserve the current stroke when a palm touches the screen |
| MEDIUM | `DrawingEditorPage.swift` | Taller dock with fewer actions | Compact interactive glass controls, tools menu and style sheet | Keep the drawing visible while making the expanded actions available |
| MEDIUM | `DrawingExport.swift` | No native export actions | PNG/SVG copy and share with escaping, transforms and bounded raster size | Export a drawing or selection from the device |

| Location | Candidate | Rejected because |
| --- | --- | --- |
| Text editing | Recreate desktop contenteditable inside the canvas | A native text sheet supports the keyboard and text selection directly |
| Rendering | Introduce a second shape generator | Reuse the bundled web drawing renderer and existing wire document format |

Verification: nine focused drawing tests cover wire-valid tools, pressure,
transforms, locking, undo/redo, concurrent edits and escaped SVG output. All nine passed on the physical iPad. These checks do not verify physical
Pencil hover/pressure, share-sheet presentation or interactive glass appearance.
The native text sheet and hand-font fallback differ from the web presentation.

## Composer touch feedback

The supplied screenshot (`Schermafbeelding 2026-09-15 om 21.07.10.png`) shows a
large oval highlight inside the composer's rounded rectangular boundary while
text interaction is active. The likely source is the interactive glass effect on
the entire editor panel. The composer now uses regular Liquid Glass, an explicit
matching touch shape and a subtle one-point focus outline. Its buttons retain
their own interaction behavior. No layout or text-responder changes accompany this
visual correction.

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `ChatScreen.swift` | The whole composer has an interactive glass effect | Stable glass with a matching touch shape and focus outline | Avoid deforming the background during text selection |

The screenshot also shows a floating text cursor over the placeholder during
magnification. It does not establish that placeholder text is editable: the
placeholder is a separate noninteractive UILabel. No text-selection changes were
made from that image alone. Physical touch feedback remains unverified.

Final verification: `bun run format`, `bun run check` and the signed device build
passed. All 17 focused tests passed on the iPad before the final gesture-preview
and composer-appearance corrections; those corrections passed the final build.
The app was installed on Bas's iPhone and iPad Pro. Final build log:
`/tmp/ruimte-ios-composer-touch-device.log`.

Verdict: the inspected implementation is ready for device review. Physical chat
scrolling, composer touch feedback, tab transitions, native share sheets and Pencil
interaction remain unverified. No simulator run was made.

## Native search activation and a full-height iPad sidebar

Full source review of the project navigation and its hosting controllers. The
Homey viewer's public tab-controller setup was inspected for its compact panel
behavior. This implementation uses SwiftUI TabView, UISplitViewController and
public compact size-class overrides; it does not use private selectors or KVC.

| Category | Evidence inspected | Result |
| --- | --- | --- |
| Typography | Project navigation titles | Omit the title in the iPad sidebar; keep view titles in the detail column |
| Surfaces | AppHome routing and native split/tab containers | Give the project its own root; place compact tabs only in the sidebar |
| Animations | Search activation and split visibility | Use native search presentation and split-column show/hide |
| Icons | Back, sidebar, usage and five tab labels | Retain the existing Lucide icons and native control touch areas |
| Performance | Hosting-controller updates | Keep both hosting controllers alive while updating their SwiftUI content |

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| HIGH | `WorkspacePage.swift` | Search tab could select without activating a field | Use the search tab activation API and bind native search presentation to tab selection | Selecting Search focuses the system search field |
| MEDIUM | `WorkspacePage.swift` | Project-wide tabbar wraps the split-view | Put the tabbar in the primary column, with a navigation stack per tab | Keep project navigation within the sidebar |
| MEDIUM | `AppHome.swift`, `MachineProjectsPage.swift` | Projects push a second navigation container inside Projects | Open the project as its own root and explicitly return to Projects | Remove the outer navigation bar above both columns |
| MEDIUM | `ProjectSplitView.swift` | Sidebar begins below inherited navigation chrome | Native split controller owns the full project bounds; back and collapse share the sidebar toolbar | Let the sidebar extend to the top with its own controls |
| MEDIUM | `WorkspacePage.swift`, `ProjectSplitView.swift` | Regular iPad tab presentation; inherited search on other tabs | Compact traits only on the sidebar, search attached only to Search | Use a small bottom tabbar and keep Views free of a search field |

The implementation uses Apple's
[tab search activation](https://developer.apple.com/documentation/swiftui/view/tabviewsearchactivation(_:)),
[search presentation binding](https://developer.apple.com/documentation/swiftui/view/searchable(text:ispresented:placement:prompt:))
and [trait overrides](https://developer.apple.com/documentation/uikit/uitraitoverrides).
Search-field placement and transitions remain system-managed.

| Location | Candidate | Rejected because |
| --- | --- | --- |
| App root | Hide the old outer navigation bar while retaining nested stacks | Search would still inherit the wrong navigation container |
| iPad | Change the entire window to compact size class | The chat and other detail views need regular iPad layout |
| Tabs | Copy private layout hooks from a reference app | Public size-class and tab APIs provide the required compact container |

Verification uses the existing native navigation test on the physical iPad with
compact and regular configurations. It checks that the native search tab is configured to activate search, tabbar
bounds within the sidebar and opening an actual canvas from a row. Test screenshots
are generated from fixture content, not the user's live project. Final results are
recorded below. No simulator installation was performed.

An attempted synthetic search tap was removed: setting UIKit selection and calling
its delegates manually did not reproduce the SwiftUI selection lifecycle, and a
direct UITabBar delegate call crashed the fixture. These attempts do not establish
whether a physical tap focuses search. That interaction remains device acceptance.
The final source uses `searchable(isPresented:)` with explicit tab-selection binding,
and the native search-activation setting.

Final verification: the retained native navigation/layout test passed on the iPad.
`bun run format`, `bun run check` and the signed build passed. Installed on Bas's
iPhone and iPad Pro. Build log: `/tmp/ruimte-ios-sidebar-search-device.log`;
test log: `/tmp/ruimte-ios-sidebar-search-test.log`.
Verdict: ready for device review; physical search tapping/canceling and sidebar
collapse/reopen remain unverified. The inspected fixture screenshots confirm the
small sidebar tabbar and aligned back/collapse controls without the sidebar title.


## Sidebar cleanup, loading and view icons

- Hide UIKit's automatic split controls; retain the back and sidebar buttons in the project toolbar.
- Apply the same sidebar background to Views, Files, Git and Processes. Files has no top search field in the sidebar. On iPad, view search uses a focused field above the bottom tabbar; iPhone retains native search-tab presentation.
- Show loading spinners with VoiceOver labels, without visible loading captions. Reconnection shows a spinner until three failed attempts, then an error with manual retry. Automatic reconnection continues and clears the error on success.
- Add Change icon beside Rename, with the protocol's 60 Lucide choices, emoji and reset to default. Updates use the existing project save and conflict handling.
- Reuse in-flight project-list requests, apply summary events without reloading the list, and preserve events received during an older snapshot request.
- Remove the initial duplicate folder listing for absolute paths. Processes renders the subscription's initial snapshot directly. Chat provider choices load alongside the conversation snapshot.

Validation: eight project-list tests passed on the physical iPad, including an event racing an older snapshot and request-count checks. The signed device build passed. No simulator was used. These changes reduce request count and sequential waits; no before/after timings were measured on live projects. Sidebar appearance, search focus and icon selection still need device acceptance.


## Chat scrolling, interaction and connection startup

- Chat cells use contained `UIHostingController` instances with `safeAreaRegions = []` and intrinsic sizing. The collection owns all toolbar and composer insets. This follows Apple's [guidance for custom scroll containers](https://developer.apple.com/documentation/swiftui/uihostingcontroller/safearearegions).
- The composer has an interactive glass background constrained to its full shape, plus touch feedback over the same shape. Editor and control gestures remain separate from the background's focus action.
- On iPad, Search hides the tabbar and occupies its bottom position with a cancel control. iPhone keeps the native search-tab presentation.
- Restore native glass backgrounds for ellipsis toolbar buttons and the default tint for toggles.
- Start ICE gathering and the offer exchange together. Buffer local candidates until the answer is applied, then send them as they arrive. Authentication, signed signaling and the existing ICE route policy are retained. The initial offer no longer waits up to five seconds for local gathering.
- Project refresh no longer waits for notification registration on offline machines.
- Live Activity defaults to the latest opened chat on iPhone, replaces previous activities and updates local status. The setting is hidden on iPad. Per-session activity buttons are removed. Remote push-to-start registration is cleared so other followed sessions cannot create extra activities; notification following remains separate.

A device test compares actual Markdown pixels before and after an 80-point scroll in the full chat screen. It also passes with the previous hosting implementation: it does not reproduce the user's intermittent freeze and must not be cited as proof that freeze is fixed. The hosting change still needs live conversation acceptance. ICE candidate ordering is covered by a separate focused test. There is no measured before/after connection benchmark and no simulator installation.


## Sheet surfaces and project navigation

App-owned sheets now use an opaque system background, primary foreground styling and the monochrome app tint. Native switch styling is retained. This prevents the underlying screen or inherited foreground styling from coloring a sheet. The OS share sheet keeps its system presentation.

Clear conversation uses a centered system alert with explicit Cancel and destructive Clear conversation actions on both device families. Processes and its monitoring screen are removed from the mobile app; project navigation now has Views, Files, Git and Search. The unused process-subscription snapshot callback was removed from the shared page lifecycle.

Validation is limited to the signed device build and repository format/check commands for this UI iteration. No simulator or additional device test suite was used. Sheet appearance still needs device review.

## Composer overlap and project back gesture

A screenshot captured from the user's iPhone with Xcode's `devicectl device capture screenshot` shows the project tabbar covering the composer and blurring its contents. Compact project navigation now hides the tabbar while a view is open. The composer applies its glass effect to the content container, keeping the editor and buttons in front of the material. Its background focus target and explicit touch feedback remain in place.

Projects now open through a public UIKit navigation controller with an interactive edge-pop gesture. The project screen stays mounted during the transition, including canceled swipes. Nested view and folder navigation takes precedence over leaving the project.

The signed build passed and was installed and launched on the physical iPhone and iPad. No simulator or additional device test suite was used. Live screenshots and gesture acceptance are recorded separately below.

The first device check was blocked by connection failures. The daemon log showed repeated negotiation timeouts after the previous iteration's candidate-free offer change. Initial ICE gathering was restored with its existing five-second cap; late candidate forwarding and the direct/relay policy remain unchanged. A new connection opened after installing this recovery build, but the log does not identify which device connected. The final captured iPhone screen was Projects, so the chat appearance and back gesture are not yet visually verified. Both devices received the recovery build, and the build, format and check commands passed.

## iPhone connection diagnosis

Device console tracing identified the remaining failure: after receiving the answer, the iPhone replayed candidates already included in its offer. A single connection could announce about 30 candidates, exceeding the broker's 20-frames-per-second limit when replayed. The broker then refused the attempt and interrupted other negotiations on the shared socket.

Candidate forwarding now excludes routes present in the SDP and suppresses duplicates. Matching uses the candidate's core fields and TCP type because native delegate strings and SDP can differ in optional extensions. Candidates gathered after the offer still go out after the answer. Direct connection preference and TURN availability are unchanged.

Three focused tests passed on the physical iPad. On the physical iPhone, tracing confirmed zero replayed candidates and successful authentication to both the VPS and the Mac. The Projects screenshot then showed both machines online with loaded custom project icons. The Mac needed retries during this observation, including one negotiation timeout and one liveness failure before the latest connection completed. This confirms that the rate-limit regression is fixed, but does not establish long-term network stability. Connection tracing is debug-only, opt-in with `RUIMTE_TRACE_CONNECTION=1`, and excludes SDP, addresses, keys, tokens and chat contents.

## Native navigation structure

Removed the custom UIKit project navigation and split-view wrappers. iPhone now uses one SwiftUI NavigationStack for Projects, a project's tabs and opened views. The project keeps the system back button and interactive pop gesture. Opening a view pushes above the entire tab screen, without changing tabbar visibility independently of the navigation transition.

iPad keeps one NavigationSplitView after sign-in or pairing. Its main sidebar contains Projects, Machines and Settings. Opening a project pushes its view list inside the sidebar's navigation stack and starts the detail at Select a view. Explicit view selection is separate from the project's saved active view. Files and Git display in the detail column; native bottom-toolbar controls and search live in the project sidebar. Settings and Machines reuse the detail stack instead of embedding another one. Sidebar toolbar updates now share a native navigation bar, with no compact-trait override or hidden extra navigation bars. This follows Apple's [NavigationSplitView guidance](https://developer.apple.com/documentation/swiftui/navigationsplitview).

One focused device test passed for phone and tablet layouts. It opens a real canvas from the view list, checks the native iPhone navigation stack and enabled interactive-pop recognizer, then pops back through the view and project. The iPad case starts with no canvas and mounts it only after row activation. This is structural and activation coverage, not a recording of a physical finger gesture or Liquid Glass animation. Transition appearance and cancellation still need device acceptance.

Installed and launched the final build on both devices. Actual device screenshots confirmed the iPad main sidebar and loaded Projects detail, and the unchanged iPhone Projects entry screen. The iPad check caught selected-row contrast and list margins extending under the sidebar; both were corrected and recaptured. The sidebar keeps native selection styling with readable foreground text, and project-list spacing adds to the split view's safe area. Build, format and repository checks passed.

## Sidebar consistency

The main sidebar now uses the project's inset-grouped rows, primary text, secondary icons and a checkmark for selection. Both use the system background. A one-point separator is attached to the persistent sidebar column so it survives navigation between the main menu and a project.

The project sidebar reuses the iPhone TabView with Views, Files, Git and a native Search tab. Only this narrow tab subtree receives the compact horizontal size class; the split view, native navigation stacks and detail column retain their own traits. The permanent searchable list and substitute bottom-toolbar buttons are removed. Files and Git still open in the detail column.

The focused device test passed, including the tabbar's lower-half position and bounds inside the iPad sidebar, plus native iPhone back navigation. An actual iPad screenshot showed the loaded project, its separator, no top search field and the bottom native tabs. The test's current screenshot confirmed the same project-tab layout. Installed and launched on iPhone and iPad; build, format and check passed. Search activation and animated transitions remain device acceptance items.

## Toolbar readiness and page details

Project chats now mount their screen and conversation menu before session preparation finishes. The menu stays in place throughout loading, with its actions disabled until the session is ready. Preparation errors retain a retry banner, and the chat model starts only after preparation succeeds. This removes the late toolbar insertion that prevented the forward navigation transition from including the ellipsis button.

The usage period picker sits above the list without a section background. Files no longer shows the absolute folder path as a separate row. The iPad sidebar separator uses the existing border color at 35% opacity.

The signed device build, format and repository checks passed; existing lint warnings remain. Installed on both physical devices. No simulator or additional test suite was used. The animated toolbar transition still needs visual acceptance on a device.

## Web sidebar rows and gray palette

iPad sidebar items now follow the web sidebar reference: ungrouped rows, muted labels, rounded selected backgrounds and thin separators between view groups. Rows have a minimum 44-point touch target, 16-point Dynamic Type text and 20-point icons. Selection is exposed to accessibility. Hover uses the web hover shade; the native List button action handles activation. Main sidebar items use the same styling. iPhone keeps its grouped row layout, navigation and tabbar.

The shared mobile theme now uses the light and dark gray values from `apps/client/src/styles.css`. Native lists and forms receive those page and row backgrounds; custom text, chat, terminal and canvas surfaces use the corresponding semantic colors. Liquid Glass and system toggle behavior remain native. Projects no longer repeats pairing and machine actions below Recently closed; those actions remain in the plus menu, with Machines also available in the iPad sidebar.

Build, format and repository checks passed. The existing phone/tablet row-activation test passed after retaining the native button action, including opening the real canvas and navigating back on iPhone. Its screenshot confirms the iPad view-row styling. Actual screenshots from both installed devices confirm the dark palette and simplified Projects list; the iPad capture also confirms the main sidebar selection. Both apps were installed and launched. No simulator was used. Light appearance, pointer hover and a physical swipe were not visually checked in this iteration.

## Shared list design variant

The loose sidebar-row design now also applies to iPhone views, Projects, Recently closed and machine project lists. Other browsing lists use the same plain surface, typography and hidden row separators. Project icons and machine captions remain visible. Settings forms retain their native control grouping. Navigation labels have a full-width hit and hover area with a minimum 44-point height.

Sidebar rows have 18-point outer margins plus 10-point inner padding, adding eight points of space on each side. The iPad sidebar shows the Ruimte app mark and name in its native navigation bar. Inside a project, its name appears above the view groups.

Pixel inspection found that the previous sidebar edge combined the custom border with the native split divider. A noninteractive overlay now covers that divider and draws one physical pixel using the web border color. Its position follows the sidebar bounds and it is omitted when the detail column is shown alone. An actual iPad screenshot confirmed the single-pixel edge, branding and roomier rows. Both device screenshots confirmed the ungrouped Projects layout.

The signed device build, Swift formatting, repository format and check commands passed. Both devices received the final build. This iteration used screenshots without a simulator or additional automated device tests. Sidebar collapse, project-header transitions and light appearance remain visual acceptance checks.

## Scrolling separators and press feedback

View-group separators and labels now live in noninteractive list rows instead of pinned section headers. The separator before Recently closed also scrolls with its content. The project view rows retain section-local reordering. Ruimte branding uses the leading toolbar placement and its intrinsic width, with the shared glass background hidden through Apple's public [toolbar modifier](https://developer.apple.com/documentation/swiftui/toolbarcontent/sharedbackgroundvisibility(_:)). Projects uses an inline navigation title on iPhone.

Navigation labels gain a lighter pressed background. A simultaneous gesture updates transient state and resets on release or movement, following SwiftUI's [gesture-state pattern](https://developer.apple.com/documentation/swiftui/gesturestate). The native button action remains responsible for opening the destination.

Build, format and repository checks passed. The focused phone/tablet activation check passed; it now skips decorative rows before asserting that the first view opens the real canvas. Its final iPad screenshot confirms that the left-aligned Ruimte name is fully visible. The physical iPhone was showing Notifications when captured, so that screenshot does not verify the Projects title. Press appearance during a physical touch and scrolling separator behavior still need device acceptance. No simulator was used.

## Page surfaces while loading

The shared page surface now fills the viewport with the app's surface color before content loads, including its safe-area background. Navigation containers use that color too. Project loading, view preparation, removed/error states, notification destinations, file previews and app sheets use this surface, so a spinner no longer leaves the system background exposed. Content keeps its existing safe-area and keyboard layout.

Ruimte branding is limited to the main iPad sidebar. A project's sidebar toolbar has no title or branding; its project name uses a larger semibold heading within the scrolling list. iPhone project titles keep their existing toolbar placement.

The signed device build, Swift formatting, repository format and check commands passed. No simulator or additional device test suite was used in this iteration. Transient loading appearance and navigation transitions still need visual acceptance on a device.

## iPhone view-list spacing

The phone view list now explicitly removes the default top content margin and uses a 24-point bottom content margin. These scroll-content margins retain the native toolbar and tabbar safe areas. The same spacing applies when searching views; iPad sidebar margins remain automatic.

The signed build, format and repository checks passed. No additional tests or simulator were used. The physical iPhone was showing Projects when captured, so the view-list spacing still needs visual acceptance.

## Restore row taps and refine feedback

The long-press gesture added for visual feedback intercepted real touches, preventing navigation. Shared rows now use SwiftUI's `ButtonStyle.configuration.isPressed`; the label has no gesture recognizer. Buttons and navigation links retain their normal activation behavior. Press feedback uses a 120 ms ease-out transition, respects Reduce Motion and has a background shade between resting and selected in both appearances.

The main iPad sidebar branding now has a 32-point mark and a larger semibold name. Its leading inset aligns the mark with the sidebar item icons. A physical iPad screenshot confirms the size and alignment.

The earlier activation check called the collection-view delegate directly and missed this touch regression. It has been replaced by one opt-in XCUITest in the `RuimteDeviceChecks` scheme, which requires a signed-in device with an available project. Actual synthesized taps opened Recently closed, a project and a view on both physical devices; the iPad run also switched to Machines and back to Projects. Both runs passed. The standard test scheme remains independent of device account state.

The signed builds, Swift formatting and repository checks passed, with existing lint warnings. Both devices have the updated app installed and launched. No simulator was used. The press transition timing and light appearance were not visually recorded.

## Sidebar brand alignment and connection timing

The iPad brand moves ten points left: its mark now starts at the sidebar row background's leading edge, rather than the icon inside that row.

iPhone and iPad share the same transport implementation. Startup restores the account locally, refreshes its access token when needed and requests the machine list from Pulsar. Link-paired machines can start from local storage. Each machine then opens a shared secure broker socket, authenticates it and requests ICE servers. WebRTC gathers host, STUN and TURN candidates before sending its offer. The offer waits for gathering to finish or a five-second deadline. The daemon also gathers before answering. A signed channel handshake completes before project data is requested. Successful channels release their broker membership and carry application traffic directly between peers, or through TURN when a relay candidate is selected. The normal app uses ICE policy `all`, not `relay`.

One cold-launch measurement on each physical device used the existing opt-in debug trace, extended with elapsed milliseconds, candidate-pair types and round-trip time. No addresses, credentials or message contents are added to the trace. The following times start when the machine link is created, so they exclude account restoration, machine discovery and subsequent project/chat loading.

| Stage, connection to this Mac | iPad | iPhone |
| --- | ---: | ---: |
| Broker and ICE configuration ready | 226 ms | 107 ms |
| First host candidate | 228 ms | 109 ms |
| Offer sent | 337 ms | 5,265 ms |
| Answer received | 436 ms | 5,439 ms |
| Authenticated | 697 ms | 5,625 ms |
| First sampled round-trip time | 8 ms | 7 ms |

The Mac connections were `O8XwH2Ml` and `hwJM9wxM`, correlated with the daemon log. Both selected host/host candidate pairs, with no TURN relay. The second machine also connected without TURN: 727 ms on iPad and 5,528 ms on iPhone. On iPhone, gathering reached its five-second deadline despite early host candidates. This identifies a setup delay; it does not establish a slow data path. The Mac classifies both clients as `public` from their nominated remote address. That label alone cannot distinguish globally addressed local IPv6 or NAT loopback from traffic leaving the local network. No packet-route capture was performed.

The foreground policy closes machine links when all scenes enter the background and rebuilds them on return. Failed attempts have a 20-second deadline and retry delays of 0.5, 1, 2, 4, 8 and then 10 seconds. Connections and project summaries are shared/cached, but this does not avoid a fresh transport negotiation after backgrounding. Unlike desktop routes that can use a known machine socket, the mobile app currently requires broker signaling and has no broker-free LAN discovery path.

The next performance change should address the measured gather wait: send usable initial candidates promptly and continue exchanging later candidates, with deployed-daemon compatibility verified. Separately, the app is missing `NSLocalNetworkUsageDescription`; Apple requires that description for apps accessing local hosts ([TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)). Its absence is a configuration gap, not a demonstrated explanation for this measurement.

The signed build and repository checks passed, with existing lint warnings. Both devices received the build. This iteration changed brand alignment and opt-in diagnostic output; the measured connection algorithm remains unchanged. No simulator or additional test suite was used.
