# Native iOS interface review

15 September 2026. Full review of project discovery, project and view lists,
welcome buttons, custom project icons, and usage currency. SwiftUI and UIKit use
native navigation, inset grouped lists, Dynamic Type and the existing monochrome
`MobileStyle` colors. Chat remains covered by the existing regression suite; its
layout was reviewed in the previous iteration.

## Platform references

The implementation follows Apple's [iOS 26 design guidance](https://developer.apple.com/videos/play/wwdc2025/323/)
for native floating toolbars and reachable search, [automatic search placement](https://developer.apple.com/documentation/swiftui/searchfieldplacement/automatic),
and [inset grouped lists](https://developer.apple.com/documentation/SwiftUI/ListStyle/insetGrouped).
Apple authentication retains the [system button](https://developer.apple.com/documentation/authenticationservices/asauthorizationappleidbutton/)
at its standard 44-point height. The native authorization flow is unchanged.

## Coverage

| Category | Evidence inspected | Result |
| --- | --- | --- |
| Typography | Welcome, project, recent-project and view-list captures in light/dark appearance and large text; locale formatter tests | System body text, compact rows that grow for larger text, matching sign-in title cap height |
| Surfaces | Native phone/tablet-width captures and list geometry tests | Inset grouped lists; no top separator or hand-built search surface; secondary project title uses inline navigation |
| Animations | Native row activation, destination mounting, startup cancellation and existing chat scroll tests | No new custom transitions; native push and split selection work; slow-motion physical transitions not verified |
| Icons | Desktop protocol and detector, Lucide assets, original project image decoding, rendered SVG pixel checks | Custom image resources already exist in the protocol; SVG and raster icons retain original colors and dark variants |
| Performance | Shared startup task, project connection leases, image request coalescing and bounded image cache | One startup request sequence; shared icon requests, 96 cached thumbnails, serialized transient SVG rendering |

## Changes

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| HIGH | `apps/ios/App/AppRuntime.swift`, `AddressBookClient.swift` | Restoring an account replaced the root view and canceled startup; cancellation became an address-book network error | Runtime owns one shared startup task; provider discovery is independent of machine loading; cancellation stays cancellation and successful refresh clears old errors | Projects load without requiring a manual pull-to-refresh after launch |
| HIGH | `apps/ios/App/Workspace/WorkspacePage.swift` | Row navigation mixed a link with a selection gesture; every destination waited for a connected session, including cached canvas content | One row activation updates selection and opens a native destination; only chat and terminal session creation waits for connectivity | A tap opens the view and cached content remains usable while reconnecting |
| MEDIUM | `apps/ios/App/Workspace/WorkspacePage.swift` | A 44-point inner row plus native button padding produced taller rows | List owns the 44-point minimum; row content has no extra minimum or vertical insets | Compact rows retain a full touch target and can grow for larger text |
| MEDIUM | `apps/ios/App/Workspace/AppHome.swift`, `MachineProjectsPage.swift` | Plain project list, large row padding and a separator below the forced top search bar | Inset grouped lists, compact project rows and no section-leading separator | Match the requested view-list style and native list conventions |
| MEDIUM | `apps/ios/App/Workspace/AppHome.swift` | Search was forced into the top navigation drawer | Automatic native search placement, including the bottom toolbar on iPhone | Keep search within reach using the current system control |
| MEDIUM | `apps/ios/App/Workspace/AppHome.swift`, `UnifiedProjects.swift` | Initial discovery had no progress indicator | Loading/connecting state for an empty list and a small update indicator when cached projects are visible | Distinguish work in progress from an empty project collection |
| MEDIUM | `apps/ios/App/Workspace/AppHome.swift` | Recently closed projects occupied the main list | One link opens a separate searchable, refreshable recent-project list | Keep current projects prominent while retaining history |
| MEDIUM | `apps/ios/App/Workspace/ProjectArtwork.swift`, `ProjectSVGRasterizer.swift` | Image project icons fell back to initials | Read the existing authenticated `projectIcon` resource, including `.idea/icon.svg` and dark variants; display native cached thumbnails | Preserve the same project recognition as the desktop client without extending the protocol |
| MEDIUM | `apps/ios/App/Pages/MachineUsagePage.swift`, `UsageMoneyFormatter.swift` | Usage always formatted dollars | OS regions using EUR select euros with the existing exchange rate; other regions use USD; missing rates explicitly fall back to dollars | Match regional expectations without relabeling unconverted dollar amounts |
| LOW | `apps/ios/App/Workspace/WelcomePage.swift` | The 54-point Apple button rendered larger text than GitHub | Both controls use 44-point visual and touch height; GitHub keeps system body medium and Apple keeps native typography | Match title size while preserving the official Apple control |
| LOW | `apps/ios/App/Workspace/WorkspacePage.swift` | A large project title reserved excess vertical space | Inline project title above the compact section list | Leave more room for views on a phone |

## Considered and rejected

| Location | Candidate | Rejected because |
| --- | --- | --- |
| Lists | Add custom glass backgrounds to every row | Native inset grouped sections already provide the requested hierarchy; glass belongs to system navigation and toolbars |
| Custom icons | Add an icon URL to the protocol | The authenticated byte-resource protocol already exposes the daemon's detected project icon and theme variant |
| SVG icons | Keep one WebKit view per project row | That would make scrolling and memory use depend on the number of visible projects; snapshots become small native images instead |
| Usage | Change the currency symbol without converting | Costs arrive in USD and must use the existing rate before displaying EUR |
| Apple button | Modify its private label font | The native control has no public font setting; sizing the supported control matches the title without private API access |

## Verification

- Full native simulator suite passed 66 tests, 60 XCTest and 6 Swift Testing, on iPhone 18 Pro with iOS 27. Result: `Test-Ruimte-2026.09.15_19-47-35-+0200.xcresult`.
- Native row tests invoke UIKit's primary activation action, require 44-to-46-point row geometry and assert that the real `CanvasScrollView` mounts on phone and tablet widths.
- Startup tests cover root-task cancellation and replacement, provider-discovery failure with a restored account, and sign-out while a machine response is pending.
- SVG tests assert original red and gradient pixel values after actual WebKit rendering. Raster tests cover bounded resource loading, thumbnail size, identity/theme/version keys and cache reuse.
- Currency tests cover euro regions with different languages, dollar fallback, invalid rates, local separators, sub-cent amounts and single conversion of chart values.
- The Pulsar Swift package passed 37 tests. `bun run format`, `bun run check` and `git diff --check` passed; existing desktop lint warnings remain.
- Captures are in `/tmp/ruimte-ios-native-navigation-final`. The sign-in title's capital S measures 37 pixels in both buttons at the captured default text size.
- After the final icon and branding refinements, all 6 focused native tests passed. Welcome captures also assert that the original navy and silver logo fills remain visible. Result: `Test-Ruimte-2026.09.15_19-53-17-+0200.xcresult`; captures: `/tmp/ruimte-ios-native-navigation-brand-final`.
- The signed Debug build passed strict code-signature verification, installed on Bas's iPhone, and launched successfully through `devicectl`. Build log: `/tmp/ruimte-ios-native-navigation-device.log`.

Not verified: physical VoiceOver and keyboard navigation, live first-launch network
transitions, all accessibility sizes, physical iPad multitasking, transitions at
10% speed, every custom SVG feature, and physical frame-rate measurements. A native
fixture proves layout and routing, not a new live machine connection or Apple login.
Direct ICE with TURN fallback is unchanged. These changes require no server deployment.

## Verdict

Approve for the inspected scope after the recorded corrections. The physical-device
and accessibility checks above remain acceptance work.
