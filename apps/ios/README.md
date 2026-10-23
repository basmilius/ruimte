# Ruimte for iPhone and iPad

A native remote client for Ruimte machines, for iOS and iPadOS 27 (`project.yml`). It opens projects, chats,
terminals, files, drawings, diagrams and devices on a machine and runs no daemon of its own. Browser pages use an
isolated `WKWebView` without a machine bridge.

## Design decisions

The app follows the desktop wherever a phone can. These are the places where it chose something on purpose.

- Project saves are three-way merges with explicit conflict resolution, and a view or node kind the app does not
  know survives a save.
- A visual reply is a `WKWebView` per card, loaded from memory under `ruimte-visual://` with the policy of the
  desktop's sandbox host page (`ChatVisualContract.swift`, generated from `packages/csp` by
  `Scripts/generate-visual.ts`). The page runs on an opaque origin without files or storage, and its main frame
  never leaves. A script in the app's own content world reports the height and hands over tapped links, which open
  in Safari.
- New chat outside a project asks the machine with `project.newChat`. The machine hands back the unused chat of
  that agent instead of making another, so tapping twice never leaves an empty chat behind.
- Deleting a chat or terminal, or a canvas holding one, ends its session on the machine as the desktop does
  (`chat.kill`, `session.kill`), and the agents it opened end too. The confirmation counts them.
- A terminal attaches with `follow: true`, so opening it on a phone never resizes the desktop's PTY. A command
  from the project file that nobody approved waits above the keys until someone taps Run (`session.runHeld`).
- A file edit is written over the mtime it was read at (`fs.write` with `expectedMtime`). A file that moved on the
  machine refuses and keeps the edit. Mention adds `@path` to the chat's draft: the live composer when the chat is
  open (`ChatDraftInbox`), the saved draft when not.
- Update on a machine's page first asks `endpoint.installUpdate` with `confirm: false`, shows what a restart would
  end and installs only after the person confirms. Keep awake with the lid closed shows as unavailable until the
  sudoers rule is installed on the Mac, since only the local secret installs it.
- A device on a machine's page is a read-only preview: `device.list` every three seconds while the page shows, and
  `device.open` with JPEG frames only. A device that streams video says its picture shows in its view.
- The phone is a person to the machine, so a launch nobody approved shows its command, folder and environment, and
  only Launch on that sheet sends `approve`. Saving launches writes the whole list against its rev.
- Force quit on a process asks first, and the machine refuses a pid that now names another process.
- Git conflicts are worked out in the app and never through markers. The stretch logic is a Swift port of
  `@adecore/merge` that splits and fingerprints as the daemon does, so a resolution written over the digest it was
  read at lines up with the machine. A merge into a branch that is checked out nowhere is refused on purpose.
- Every number, date, time and duration a person reads is written by `Format` in `RuimtePulsar`, a port of
  `@adecore/ui/format` whose tests repeat the desktop's cases. The region iOS is set to writes the notation and the
  language the app runs in writes the words.
- The hot paths read the wire as generated types: chat events and attach results, `session.status` and `git.status`
  decode with `JSONValue.decoded(as:)` after the frame was validated. A chat holds its items, info and history only
  as those types, and a delta is applied to the typed item. What the wire leaves untyped stays JSON: a tool's input
  and the trees of a reply's blocks, which the interpreter takes as JSON (`UiReplyTrees`).
- Usage counts in the region's currency until a person picks one: euros in a EUR region at the ECB rate the
  machine supplies, dollars elsewhere. Missing rates keep dollars and say so.
- Widgets never connect. The app writes what a connected machine reports into the app group
  (`NeedsYouWidgetRecorder`, `ProjectWidgetRecorder`), and a background refresh asks again at most every half
  hour, so an offline widget shows the last numbers and when they came in.

## Navigation on an iPhone

Four tabs, each at most two levels deep: Now, Projects, Machines and Search. They are the root of one navigation
stack (`PhoneHome`), and every page opens on that stack over the whole tab view, so the tab bar leaves with a push
and follows the finger on a swipe back. A push only morphs the bar into the items a page has when it starts, so a
pushed page takes its title and items from its route and the push runs without an animation of ours around it.
Settings opens as a sheet from the avatar on every tab.

`PhoneRouter` holds the tab and the path. A route (a project, a view, a notification, a machine) replaces what was
pushed. A sheet a command asks of a project waits until the project opened (`pendingSheet`), since a sheet asked for
during the push would not stand. The stack only shortens the path once a pop settles, so a swipe back the person
takes back leaves the route standing. A view opened outside its project's list (`ProjectViewPage`) opens the project
behind it, so it has the project's sessions, forks and plans.

Now reads each machine's open projects with `project.sidebar`, again on `project.changed`, `project.summary` and
`session.list-changed` and every 15 seconds while it shows, as the desktop's sidebar watch does. `NowBoard` is the
pure grouping. A needs-you card answers the chat's oldest request in place from the summary on the chat's info,
without attaching the chat. An answer that finds the request settled (`request-not-found`) counts as given.

A snooze set without a connection waits on the phone, across a restart too, and goes out once the link is back
unless it ran out.

## The iPad

The iPad keeps the iPhone's pages and none of its tabs (`PadHome`, `PadRouter`). The sidebar lists Now, Machines and
the open projects per machine; Search (⌘K, bound once on the window) opens the palette as a sheet. Each content page
has a stack of its own, so a page pushed in one never outlives a switch.

Files and Git open as an inspector on the split view, not in the content column, whose navigation it would
otherwise share. The inspector has its own stack (`PadInspectorPane`); a file opens in the content. A sub-agent
opens in that inspector beside its chat and leaves with the chat.

## Views

A view stands with its content and bar from the first frame of the push. A terminal or canvas that still waits for
its session shows a spinner over itself instead of in its place.

- Terminal keys follow the cursor mode the program asked for (`TerminalKeys`).
- A canvas only pans and zooms on a phone. It shows the move and resize locks and keeps them as it read them; the
  locks are this phone's, in the project's local state.
- A drawing lets only the Pencil draw once a Pencil touched the page, or with Only Draw with Apple Pencil on. The
  tool options are stored per phone, as the desktop keeps them per client.
- Change with an agent on a diagram sends the question to a chat with `chat.send` and names
  `ruimte-context view diagram` and the file (`DiagramAgentPrompt`).
- A device view polls `device.list` every two seconds while it waits and every five while it shows. A booted
  simulator streams `device.frame` events in JPEG, which is what simulators send. A phone or Android emulator
  streams video, so the machine refuses the format and the page says it shows on the computer only.
- A device's tools sheet has the sections of the desktop's tools panel, each only when the device announces its tool
  (`DeviceTools`): a screenshot handed to the share sheet, the clipboard both ways through `UIPasteboard`, display,
  status bar and battery, biometrics, location, and apps with their permissions and a push. Capture and clipboard
  also wait until the machine names `device.capture` and `device.clipboard`. Erase asks first in an alert and stops
  and starts a simulator around it, as the desktop does; a phone is never erased.
- With a hardware keyboard, a device that announces `keyboard` takes the keys while its screen shows
  (`DeviceKeyView`): `UIKey.keyCode` is already a HID usage. ⌘V pastes this phone's clipboard through the device's,
  and every other ⌘ chord stays the app's.

## First run

Welcome, Add a machine and notifications (`App/Onboarding`). A machine puts itself on the account, with
`npx ruimte login` or the app on it, so Add a machine only explains and reads the account again. The notification
step follows only a sign-in taken from the welcome and is kept as `ruimte.ios.onboarding.notifications` until
answered, so a phone set up before the step existed is never asked.

## Settings

- Show replies is one setting for every chat (`ruimte.chat.streaming`); the chat menu reads and writes the same value.
- The machine switches under Agents go through `endpoint.setIdentity`, which sends a name nobody chose as null so it
  stays unchosen. Computer Use shows only its state: turning it on, letting an agent into an app, installing a CLI
  and adding an account happen on the machine.
- Delete account follows App Store guideline 5.1.1(v). The person types the account's name as `GET /v1/account`
  holds it (`DELETE` without one), compared as `confirmsAccountDeletion` in `packages/pulsar` does. An account with
  an Apple identity gets a fresh Sign in with Apple authorization right before `DELETE /v1/account`, and its code
  goes along as `appleAuthorizationCode` so the address book revokes Sign in with Apple first. A refusal deletes
  nothing.

## AI conversations

History loads in pages of 60 items. The page before loads once the reader is within one and a half screens of the
top and goes in when the finger lifts, so the row being read stays put. The daemon fills a page up to 512 KiB, and
a larger item travels alone without truncation.

A reconnect offers the `seq` of the last event it applied as `since`. The machine then answers only the events after
it, which go onto the thread as it stands; only when its log no longer holds them does a new snapshot replace the
thread. An event the app could not read, or a page the machine no longer knows, reads the whole thread again.

Text deltas update observable message records without rebuilding the timeline. Completed Markdown segments are
cached, and code highlighting runs on the latest text at bounded intervals.

The chat's Messages and Bookmarks lists hang off the screen, not off the toolbar item: a presentation inside the item
went with the item's host whenever the menu opened, which blanked the screen.

The composer's model, effort and permission pills are native menus. Their glass comes from the button style on the
`Menu` and not from the label, and the row has no `GlassEffectContainer`, so each menu grows out of its pill. A menu
takes the touch as soon as it lands, so there is no long press beside it. Compare models reads
`GET /v1/models/benchmarks` on every opening; the terms of the numbers allow a chart and not the data, so there is
no table and no copy.

The composer and timeline share a UIKit container anchored to `UIKeyboardLayoutGuide`. SwiftUI keyboard avoidance is
off on that screen so it cannot resize the timeline ahead of the native keyboard animation. A lost send
acknowledgement keeps the draft and asks the person to check the conversation before retrying.

A machine without a request the app uses (forks, bookmarks, snoozes, plans) says it needs an update, and nothing
else changes.

## Build locally

From the repository root, with Xcode 27, XcodeGen and Bun installed:

```sh
bun install --frozen-lockfile
bun run --cwd packages/contracts generate:swift
xcodebuild -downloadComponent MetalToolchain
xcodegen generate --spec apps/ios/project.yml
open apps/ios/Ruimte.xcodeproj
```

Set `DEVELOPMENT_TEAM = YOUR_TEAM_ID` in `apps/ios/Signing.xcconfig` to keep your team across regeneration. The
file is ignored by git and optional for simulator builds and CI. The bundle ID is `app.ruimte.mobile`; the
extensions are `app.ruimte.mobile.notifications` and `app.ruimte.mobile.activity`. The project uses automatic
signing. `project.yml` is the source of the committed Xcode project: regenerate it when adding files or
dependencies, and commit the generated project and resolved packages without user state or build products.

SwiftTerm is pinned to 1.15.0, Highlightr to 2.3.0, Sentry to 9.30.2, WebRTC to 153.0.0 and LiveKit's WebRTC build to
150.7871.03. SwiftTerm's shaders need Apple's separate Metal Toolchain. Icons use
[LucideSwift](https://github.com/ajaxjiang96/lucide-swift) 0.9.5 with upstream icons 1.46.0; the notices are in
`App/Design/Lucide-LICENSE.txt`.

```sh
xcodebuild -project apps/ios/Ruimte.xcodeproj -scheme Ruimte -configuration Debug \
    -destination 'generic/platform=iOS' -derivedDataPath /tmp/ruimte-ios-xcode \
    -allowProvisioningUpdates build
xcrun devicectl device install app --device <udid> \
    /tmp/ruimte-ios-xcode/Build/Products/Debug-iphoneos/Ruimte.app
swift test --package-path apps/ios/Packages/RuimtePulsar --scratch-path /tmp/ruimte-ios-pulsar-build
swift test --package-path apps/ios/Packages/RuimteTransport --scratch-path /tmp/ruimte-ios-transport-build
bun run check
```

The `RuimteDeviceChecks` scheme runs `RuimteUITests`. A Release build installs the same way with its own derived
data. Both carry the same bundle ID, so one replaces the other on the device and keeps its data. Release sets
`PUSH_ENVIRONMENT: production` while a local development profile grants `aps-environment: development`, so a
locally signed Release build registers against the wrong APNs environment. Test notifications on a Debug build.

## Intelligent UI

`RuimteIntelligentUI` bundles the shared bounded interpreter for JavaScriptCore. `UiInterpreter` takes a compiled
block, local input values and daemon query readings as JSON arguments and returns evaluated nodes; model text is
never executable source. `UiBlockModel` reads live queries only while a block is visible and connected, at most once
per ten seconds, and runs changes one at a time.

`bun run --cwd packages/contracts generate:swift` regenerates the interpreter and parity fixtures. `bun run check`
checks the fixtures byte for byte and the bundle by a digest of its sources, since minified output differs between
Bun versions. `IntelligentUIPresentationTests` holds the Swift port against the desktop's own results in
`intelligent-ui-presentation.json`. Run the package tests with
`swift test --package-path apps/ios/Packages/RuimteIntelligentUI`.

## Languages

The app speaks English and Dutch and follows the device; English is the source and the fallback. Every target has
its own String Catalog: `Localizable.xcstrings` for the app, the widget and Live Activity extension, the notification
extension and both packages (whose strings pass `bundle: .module`), and `InfoPlist.xcstrings` for the permission
prompts and display names. The compiler extracts the keys (`SWIFT_EMIT_LOC_STRINGS`), and a build in Xcode or
`xcodebuild -exportLocalizations` writes new ones into the catalogs. A literal SwiftUI takes as a
`LocalizedStringKey` is a key already; a sentence that travels as a `String` (a title a model returns, an error, a
label passed to `MobileRow` or `Button(_:lucideIcon:)`) goes through `String(localized:)`. A count is one key with
plural variations. Names, paths, git refs, wire values, model and CLI names and what the machine says stay as they
are. The Dutch follows the glossary in `apps/client/src/i18n/README.md`. `LocalizationTests` fails when a key has no
Dutch or when its Dutch drops or adds a placeholder.

## Voice

Voice on a phone is run by the machine (`voice.start`, `voice.stop`, `voice.confirm`, and the `voice.status` and
`voice.activity` events, in `packages/contracts/src/voice.ts`). The machine mints the GPT-Live session with an OpenAI
key it holds itself (from the desktop app's settings or `ruimte voice key set`), runs every tool and reports. The
phone carries only the microphone, the reply and the captions, over a WebRTC peer of its own to OpenAI in
`RuimteVoice` (`VoiceMediaPeer`, with a factory apart from the machine link's), and runs no tool: a function call on
its `oai-events` channel is ignored. `RuimteTransport` stays without audio.

- The mic shows on Now and in a project only where the machine answers `voice.start` and `voice.keyStatus` says it
  holds a key; a machine without a key offers no mic. The mic and ⌘⇧M open the Voice sheet (`VoicePanel`), the same
  on an iPhone and an iPad, and Start Voice there starts. In a project the sheet proposes that project as the starting
  point; on Now, or ⌘⇧M without a project, the machine of the project opened last (else the first machine that offers
  Voice) without one, and the machine starts in its project opened last. As on the desktop there is no project to
  choose: a session talks about every project in use on its machine and moves between them, and the place the sheet
  and the Live Activity name follows `project` in `voice.status`. With more than one machine offering Voice, the idle
  sheet names the machine a start goes to. No machine that offers Voice, no mic.
- One session per app process, owned by the scene that started it (`VoiceCoordinator`). Every request after
  `voice.start` names the scene, and the events count only for the owner's scene and session, since the scenes of an
  iPad share one link. Another scene shows where Voice runs and does not take the microphone over.
- `AudioSessionController` holds the app's one audio session, `playAndRecord` in `voiceChat` on the speaker, with
  WebRTC's manual audio on, so the microphone and speaker start only while a session runs and the audio goes back to
  what played before with `notifyOthersOnDeactivation`. The same configuration is WebRTC's own
  (`LKRTCAudioSessionConfiguration.setWebRTC`), since its audio unit applies that one when audio turns on and would
  otherwise drop the speaker for the earpiece. A file that plays while Voice runs keeps Voice's category, and anything
  that sets another category ends Voice rather than leaving it without a microphone.
- Voice goes on in the background and on a locked screen: the app declares the `audio` background mode, and while a
  session runs the coordinator holds the machine links open as a scene of its own (`VoiceCoordinator.linkScene`), so
  they stay up with every scene in the background. A call or another app taking the audio, the machine link or the
  media dropping end Voice. What it started on the machine goes on.
- Mute turns the microphone track off (`VoiceMedia.muted`) and keeps the session, the reply and the audio session.
- The sheet has one timeline: what was said, and each action under the Voice line that was the last line when the
  phone first heard of it, or under Voice's answer when the person spoke last (`VoiceTimeline`). The entry's `at` is
  on the machine's clock and the captions on the phone's, so arrival orders them. An ended conversation stays, with a
  marker and why it ended, until the next start. The band is the desktop's (`VoiceWaveform`, with the math of
  `VoiceWaveformBands` held to `idle-waveform.ts` by a fixture): 40 columns, the person above the line and Voice below,
  eased every frame, the idle patterns while Voice does not listen, still under Reduce Motion. While Voice listens the
  band is measured as the desktop's `WaveformMonitor` measures it (`VoiceWaveformMeter`, held to `timeDomainBands` and
  `easeBands` of `apps/client/src/audio/waveform.ts` by a fixture): every 32 ms while the sheet shows, the newest 256
  samples of each side, in 40 slices. The peer takes the microphone after Apple's voice processing, as the model hears
  it, from a tap on the node that feeds WebRTC in LiveKit's audio engine, and the reply from a renderer on its track; the
  engine hands its tap about 100 ms at a time, so the person's half moves a little slower than on the desktop. Only the
  newest 256 samples of each stay in memory (`VoiceSampleWindow`), and nothing is kept or logged. Voice on a machine
  deletes nothing yet, so there is no switch for asking before a deletion.
- The mic in the bar stands out in Voice's color while a session runs; outside the app the Live Activity shows it
  (`VoiceLiveActivities`, local only, no push). It starts once the session is active, follows the phase (listening,
  speaking, an action with its label, stopping), whether the microphone is muted, the project and the time, and ends
  with a short final state when Voice ends. Its Mute and Stop are `LiveActivityIntent`s in `Shared/VoiceLive`, which
  the app and the widget extension both compile; they run in the app's process. A tap opens the sheet
  (`ruimte://voice`). `VoiceLiveAttributes` lives in `RuimtePulsar` beside `RuimteActivityAttributes`.
- Language and voice are the machine's (`voice.preferences`, `voice.setPreferences` and the `voice.preferences` event
  every client of the machine hears), shown per machine in Settings, Voice beside its key. A machine that stores none
  shows the device's language with marin, which a start then sends; the machine's stored choice always comes first.
  The phone keeps no copy of its own.
- Every build declares the microphone (`NSMicrophoneUsageDescription` in the app's `info` of `project.yml`, worded
  in both languages in `InfoPlist.xcstrings`), so the App Store privacy label lists audio data shared with OpenAI. A
  build without the declaration would never offer Voice, and `MicrophoneDeclarationTests` holds the spec.

Run the package's tests with `swift test --package-path apps/ios/Packages/RuimteVoice`.

## Native Apple sign-in

Apple uses the system authorization sheet, with no browser callback. The app asks Pulsar for a one-time nonce and
sends Apple's identity token and authorization code back over HTTPS. Pulsar verifies both for `app.ruimte.mobile` and
returns a short-lived login code, which the usual PKCE and device-key exchange turns into a session. Apple and web
sign-in resolve the same account because their App ID and Services ID are grouped in Apple Developer. There is no
web fallback when the native service is unavailable. `apps/pulsar-worker/README.md` has the Apple configuration.

## How the connection is built

- `RuimtePulsar` owns the device key, Keychain store, PKCE, address-book API and session rotation. Every scene
  shares one `SessionVault` and ed25519 key. Keychain items use `AfterFirstUnlockThisDeviceOnly` without
  synchronization. Access tokens stay in memory.
- `RuimteTransport` shares each broker socket by URL and public key, waits for its ICE response before gathering,
  and refreshes expired credentials. One held connection per machine serves all scenes. The last release leaves a
  30-second grace period; background closes links and foreground reconnects those still held. Liveness reads
  libwebrtc transport packets rather than ping replies.
- Normal ICE selection prefers a direct route, and TURN is the fallback. Relay-only lives only in Connection
  diagnostics, on a link of its own (`diagnostic:<machine id>`) that ends when that screen closes.
- An attempt first signals at the machine's door on the local network (`LanDoor.swift`, `Signaling.swift`), at every
  address `endpoint.info` and `endpoint.changed` report in `lan`, remembered per machine and key. The app sends a
  fresh nonce and says nothing about itself until the machine signed it with the pinned key
  (`pulsar-lan-door-v1`). The broker joins when no door is ready within 1000 ms, or at once when every door failed,
  which is also what a refused Local Network permission comes to. A door attempt gets STUN and no TURN. An attempt
  that won at a door and fails before its channel opens passes the local network over for five minutes.
- A machine first admits the device with an account statement. After the pinned handshake the app keeps that
  pairing, bound to the machine ID and both public keys, so later attempts need no account request. A revoked
  pairing stays a refusal; the app does not regain access through another statement. The statement goes into the
  offer as the address book answered it, v2 fields included, and those fields stay out of the signed signal bytes.
- `stasel/WebRTC` is pinned to `153.0.0`, commit `4266157cd08f92115de885ab12d87196a8db87e1`, in `RuimteTransport`.
  The machine link exchanges no audio or video and declares no microphone, camera or background-audio capability;
  only Voice's own peer carries audio.
- `RuimteVoice` uses LiveKit's build of WebRTC instead (`livekit/webrtc-xcframework`, MIT, pinned to `150.7871.03`,
  commit `a41df9e9bcc7ab1d62131fda75c123ea391e5188`), since only it hands an app the samples of both sides: a renderer
  on an audio track, and its AVAudioEngine device (`.audioEngine`), whose observer wires the engine's nodes and may tap
  the microphone. The platform device hands the microphone to no processing delegate or track sink while Apple's voice
  processing runs, which was tried on a device. Its classes carry an `LK` prefix (`LKRTCPeerConnectionFactory`), so the
  two frameworks live side by side, each with its own audio session object; the app ships both, about 12 MB each for
  an arm64 device. The engine keeps Apple's voice processing.
- `packages/contracts/scripts/generate-swift.ts` generates the daemon API, JSON schemas, constants and fixtures, and
  the closed vocabularies of the agent, task, plan and chat schemas as Swift enums, so a switch stops compiling when
  a case is added. `AgentKind`, `RuntimeMode`, `AgentStatus` and icon names are open on the wire (`x-open-enum`), so
  a value from a newer machine passes validation and shows a generic name and mark. `bun run check` refuses stale
  output.
- `MachineClient` times out reads only, since a mutation ends when the link closes. An event it cannot validate goes
  to rejected-event subscribers, and a chat then attaches again, once.
- Required nullable, optional and optional nullable fields stay distinct; `Presence` holds missing, null and value
  where all three occur. The validator strips unknown object keys like zod.

The web authentication callback is exactly `ruimte://pulsar/callback`, checked with the pending state before the
exchange. `/v1/providers` decides which sign-in options show.

## Constraints

- One ed25519 key serves the account session and machine access. There is no separate trusted shell process, so no
  second key as in the desktop app.
- A visible iPad scene keeps held links alive when another scene backgrounds. Once every scene is in the background,
  connections close, unless Voice runs. No VoIP or other workaround keeps them.
- `NWPathMonitor` reports path changes only; it does not observe libwebrtc's own sockets.
- Push alerts use AES-256-GCM because Bun offers no ChaCha20-Poly1305 through `node:crypto`.
- The app validates `chat.attach` and `chat.history` whole, so a chat item kind or enum value it does not know rejects
  the conversation. The daemon wire only gains optional fields.
- Simulator Keychain tests need local signing. Unsigned, the Keychain answers -34018 and they skip.
- CryptoKit's ed25519 signatures differ per call, so fixtures compare message bytes and verify signatures.

## Notifications and Live Activities

Notifications are opt-in. The phone picks the kinds (an agent needs you, a turn finishes, a process misbehaves) and,
per project, All, Needs you only or Off (`NotificationPreferences`), and hands them to every machine with
`push.subscribe`. The daemon decides what to send (`apps/server/README.md#push-notifications`); the address book only
relays (`apps/pulsar-worker/APNS.md` has the APNs credentials and environments).

Alert content uses ephemeral X25519, HKDF-SHA256 and AES-256-GCM. Routing fields are additional authenticated data,
and the machine signs the whole envelope with ed25519. The notification extension verifies the pinned machine key,
device handle and validity window, then claims the message ID under a shared lock before it shows plaintext.
Background approval actions are claimed once and checked against fresh machine state; an expired or answered request
opens its conversation without sending a decision. Notification callbacks are installed before launch finishes, and
responses that arrive before the account is restored wait in a queue.

A Live Activity is one overview per machine, counting the working agents and those that need you, and ends only when
neither remains. The card has a machine caption, up to two agent rows with attention first and a footer with the
totals; the Dynamic Island follows the same order. Timers use SwiftUI's system timer, so counting up costs no
pushes, and an unknown start time is left out rather than borrowed from the machine. Review on a row opens the
terminal or chat and grants no permission. Machine names, phases, counts and timing are plaintext on purpose; alerts
and read receipts stay encrypted. iPad Live Activities are out of scope.

## Xcode Cloud and TestFlight

The app is an Xcode Cloud product built from the committed project and
`Ruimte.xcodeproj/xcshareddata/xcodecloud/manifest.json`. The `Release` workflow starts on every `v*` tag and archives
for TestFlight and the App Store. `ci_scripts/ci_post_clone.sh` sets `MARKETING_VERSION` from the tag and
`CURRENT_PROJECT_VERSION` from `CI_BUILD_NUMBER`, generates the project and installs the Metal component. Both are set
in the spec because `agvtool` reads a test target's `GENERATE_INFOPLIST_FILE = YES` as a plist path and fails. The
`Check` workflow builds and tests on an iPhone simulator on main and on pull requests that touch `apps/ios`,
`packages/contracts` or `packages/pulsar`. Workflows are edited through the App Store Connect API.

Onboarding refuses a project whose Swift packages live in repositories the team cannot grant access to, and every
package here is someone else's public repository. The product was made from a generated project with the packages
taken out, after which the real project was generated again. Repeat that if the product ever has to be made anew.

The privacy manifest covers local preferences, the shared notification store and elapsed connection timing. Review
the archive's aggregated SDK privacy report and the App Store privacy answers before distribution.

Apple references: [custom build scripts](https://developer.apple.com/documentation/xcode/writing-custom-build-scripts),
[first workflow](https://developer.apple.com/documentation/xcode/configuring-your-first-xcode-cloud-workflow),
[required-reason API declarations](https://developer.apple.com/documentation/technotes/tn3183-adding-required-reason-api-entries-to-your-privacy-manifest).

## Crash reports

A build that ships (Release on a device, so TestFlight and the App Store) reports its crashes and errors, always,
and nothing else (`App/Telemetry`). Debug, the simulator, tests and previews send nothing. A report goes out for a
native crash, a hang of the main thread of two seconds or more, a watchdog termination, and a connection problem with
a machine: a link that drops while open, a read without an answer in time and a machine refused at the protocol
check. The transport hands those to `LinkProblems`, and the app passes them on. Each run is a session, for the share
of runs that crashed. The SDK names the install in it (`did`), and the app in Observatory has "Count users" off, so the
ingest drops that before it stores anything. There is no tracing, no profiling, no logs, no replay, no screenshot or
view hierarchy and no breadcrumbs. Only the DSN and the start in `CrashReports` name the service.

Every report is rebuilt as the desktop's are (`packages/telemetry`): the stack frames without source lines or
variables, the error's type and the first line of its message, a fixed set of tags and the `os`, `device` (model and
architecture only) and `runtime` contexts. Every string loses the app's container, the names of the account, the
machines and the projects this phone knows with their folders, anything that looks like a token, password or key,
e-mail and IP addresses, URL paths, SQL, other paths and quoted text. The same error goes out once a day at most
(`ruimte.telemetry.sent` in the app's defaults). The release is `ruimte-ios@<version>+<build>`.

Reports go to Observatory (`ingest.bmnw.nl`). `ci_scripts/ci_post_xcodebuild.sh` uploads the archive's dSYMs there
when the workflow has an `OBSERVATORY_UPLOAD_TOKEN` secret, and never fails the build. Without the secret a crash
arrives with addresses only.

## Device acceptance

What only a device can show (connection timing, push on a production build, VoiceOver, iPad multitasking) is in
[`docs/ACCEPTANCE.md`](../../docs/ACCEPTANCE.md#iphone-and-ipad).
