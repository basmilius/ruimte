# Ruimte for iPhone and iPad

A native remote client for Ruimte machines, for iOS and iPadOS 27 (`project.yml`). It opens projects, chats, terminals, files, drawings, diagrams and devices on a machine and runs no daemon of its own. Browser pages use an isolated `WKWebView` without a machine bridge.

## Design decisions

The app follows the desktop wherever a phone can. These are the deliberate differences and the rules a phone adds.

- Project saves are three-way merges with explicit conflict resolution. An unknown view or node kind survives a save.
- A visual reply is a `WKWebView` per card, loaded from memory under `ruimte-visual://` with the desktop sandbox host page's policy (`ChatVisualContract.swift`, generated from `packages/csp` by `Scripts/generate-visual.ts`). It runs on an opaque origin without files or storage, and its main frame never navigates away. Tapped links open in Safari.
- New chat outside a project asks `project.newChat`, which hands back the agent's unused chat instead of making another.
- Deleting a chat, terminal or a canvas holding one ends its session and the agents it opened (`chat.kill`, `session.kill`). The confirmation counts them.
- A terminal attaches with `follow: true`, so a phone never resizes the desktop's PTY. An unapproved project command waits above the keys until someone taps Run (`session.runHeld`).
- A file edit is written against the mtime it was read at (`fs.write` with `expectedMtime`). A file that changed on the machine refuses and keeps the edit. Mention adds `@path` to the chat's draft (`ChatDraftInbox` when the chat is open).
- Update on a machine's page asks `endpoint.installUpdate` with `confirm: false` first, shows what a restart would end, and installs only after confirmation. Keep awake with the lid closed shows as unavailable until the sudoers rule is installed on the Mac.
- A device on a machine's page is a read-only preview: `device.list` every three seconds while the page shows, `device.open` with JPEG frames only.
- The phone is a person to the machine. An unapproved launch shows its command, folder and environment, and only Launch on that sheet sends `approve`. Saving launches writes the whole list against its rev.
- Output is read-only and shows only while the machine names `artifact.list`. A saved page runs in the visual reply's sandbox, images open in Quick Look, and Share reads a file only once a person picks a destination. Without a link the page says the machine is unreachable and shows nothing kept.
- Force quit asks first, and the machine refuses a pid that now names another process.
- Git conflicts are resolved in the app, never through markers, with a Swift port of `@adecore/merge` that fingerprints as the daemon does. A merge into a branch checked out nowhere is refused.
- `Format` in `RuimtePulsar` ports `@adecore/ui/format`: the iOS region writes the notation, the app language the words.
- Usage counts in euros in a EUR region (at the machine's ECB rate) and dollars elsewhere, until a person picks a currency.
- Widgets never connect. They show what the app wrote into the app group (`NeedsYouWidgetRecorder`, `ProjectWidgetRecorder`), refreshed at most every half hour.

## Navigation on an iPhone

Five tabs (Now, Projects, Routines, Machines, Search) are the root of one stack (`PhoneHome`, `PhoneRouter`). Settings is a sheet from the avatar.

Now reads each machine's open projects with `project.sidebar`, again on `project.changed`, `project.summary` and `session.list-changed` and every 15 seconds while it shows. `NowBoard` groups them into Needs you, Working, Finished and Coming up. A needs-you card answers the chat's oldest request in place; `request-not-found` counts as answered.

Routines (`ScheduledPage`, `ScheduledBoard`) lists every machine's routines with `routine.list`, again on `routine.changed` (`routine.watch`, renewed after every reconnect). Making, changing and approving a routine happen on the machine.

A snooze set offline waits on the phone, across restarts, and goes out once the link is back unless it ran out.

## The iPad

The iPad keeps the iPhone's pages without tabs (`PadHome`, `PadRouter`): a sidebar with Now, Routines, Machines and the open projects, and Search on ⌘K. Files, Git and sub-agents open in an inspector with its own stack (`PadInspectorPane`).

## Views

- Terminal keys follow the cursor mode the program asked for (`TerminalKeys`).
- A canvas only pans and zooms on a phone. Its move and resize locks are this phone's, in the project's local state.
- A drawing lets only the Pencil draw once a Pencil touched the page, or with Only Draw with Apple Pencil on. Tool options are per phone.
- Change with an agent on a diagram sends the question to a chat with `chat.send`, naming `ruimte-context view diagram` and the file (`DiagramAgentPrompt`).
- A device view polls `device.list` every two seconds while it waits and every five while it shows. A booted simulator streams `device.frame` events in JPEG. A phone or Android emulator streams video, which the machine refuses for this format, so the page says it shows on the computer only.
- A device's tools sheet shows each tool the device announces (`DeviceTools`). Capture and clipboard also need `device.capture` and `device.clipboard` on the machine. Erase asks first; a phone is never erased.
- With a hardware keyboard, a device that announces `keyboard` takes the keys (`DeviceKeyView`). ⌘V pastes this phone's clipboard into the device; other ⌘ chords stay the app's.

## First run and settings

Onboarding (`App/Onboarding`) is Welcome, Add a machine and notifications. A machine puts itself on the account, so Add a machine only explains. The notification step follows only a sign-in from the welcome and is remembered as `ruimte.ios.onboarding.notifications`.

- Machine switches under Agents go through `endpoint.setIdentity`, which sends an unchosen name as null. Computer Use only shows its state.
- Delete account follows App Store guideline 5.1.1(v). The person types the account's name from `GET /v1/account` (`DELETE` without one), compared as `confirmsAccountDeletion` in `packages/pulsar` does. An account with an Apple identity gets a fresh Sign in with Apple authorization right before `DELETE /v1/account`, sent as `appleAuthorizationCode` so the address book revokes first. A refusal deletes nothing.

## AI conversations

History loads in pages of 60 items, the earlier page once the reader is within one and a half screens of the top. The daemon fills a page up to 512 KiB, and a larger item travels alone without truncation.

A reconnect offers the last applied `seq` as `since`. When the machine's log no longer holds those events, or an event is unreadable, the whole thread reloads.

Compare models reads `GET /v1/models/benchmarks` on every opening. The data's terms allow a chart, so there is no table and no copy.

`@` offers files and `#` the project's views, as `ChatReferables` mirrors the desktop's `referables.ts`. `references` is sent only to a machine with `viewReferences` in `endpoint.info`. `Tests/Fixtures/view-references.json` holds iPhone, desktop and daemon to one payload.

A lost send acknowledgement keeps the draft and asks the person to check the conversation before retrying.

A machine without a request the app uses (forks, bookmarks, snoozes, plans) says it needs an update.

## Build locally

From the repository root, with Xcode 27, XcodeGen and Bun installed:

```sh
bun install --frozen-lockfile
bun run --cwd packages/contracts generate:swift
xcodebuild -downloadComponent MetalToolchain
xcodegen generate --spec apps/ios/project.yml
open apps/ios/Ruimte.xcodeproj
```

Set `DEVELOPMENT_TEAM = YOUR_TEAM_ID` in `apps/ios/Signing.xcconfig` (ignored by git, optional for simulator builds and CI) to keep your team across regeneration. The bundle ID is `app.ruimte.mobile`, the extensions `app.ruimte.mobile.notifications` and `app.ruimte.mobile.activity`, with automatic signing. Regenerate from `project.yml` when adding files or dependencies, and commit the generated project and resolved packages without user state or build products.

Pins: SwiftTerm 1.15.0, Highlightr 2.3.0, Sentry 9.30.2, WebRTC 153.0.0, LiveKit's WebRTC 150.7871.03, and [LucideSwift](https://github.com/ajaxjiang96/lucide-swift) 0.9.5 with upstream icons 1.46.0 (notices in `App/Design/Lucide-LICENSE.txt`). SwiftTerm's shaders need the Metal Toolchain. A ```` ```mermaid ```` fence is laid out by Pele at the version `@adecore/agents-react` pins, copied by `Scripts/generate-mermaid.ts` to `App/Resources/pele.js` with its notice. It runs in one web view in its own content world, and each diagram shows as an image.

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

The `RuimteDeviceChecks` scheme runs `RuimteUITests`. Debug and Release share a bundle ID, so one replaces the other on the device. Release sets `PUSH_ENVIRONMENT: production` while a local development profile grants `aps-environment: development`, so test notifications on a Debug build.

## Intelligent UI

`RuimteIntelligentUI` bundles the shared bounded interpreter for JavaScriptCore. Model text is never executable source. `UiBlockModel` reads live queries only while a block is visible and connected, at most once per ten seconds.

`bun run --cwd packages/contracts generate:swift` regenerates the interpreter and parity fixtures, which `bun run check` verifies. `IntelligentUIPresentationTests` holds the port to the desktop's results. Run `swift test --package-path apps/ios/Packages/RuimteIntelligentUI`.

## Languages

English and Dutch, following the device; English is the source and fallback. Each target has its own String Catalog (`Localizable.xcstrings`, and `InfoPlist.xcstrings` for permission prompts and display names). Package strings pass `bundle: .module`. A sentence that travels as a `String` (a model's title, an error, a label for `MobileRow` or `Button(_:lucideIcon:)`) goes through `String(localized:)`. A count is one key with plural variations. Names, paths, git refs, wire values, model and CLI names and machine output stay as they are. The Dutch follows `apps/client/src/i18n/README.md`. `LocalizationTests` fails on a missing Dutch key or a changed placeholder.

## Voice

The machine runs Voice (`voice.start`, `voice.stop`, `voice.confirm`, events `voice.status` and `voice.activity`, in `packages/contracts/src/voice.ts`). It mints the GPT-Live session with its own OpenAI key and runs every tool. The phone carries only microphone, reply and captions, over its own WebRTC peer to OpenAI in `RuimteVoice` (`VoiceMediaPeer`), and ignores function calls on its `oai-events` channel. `RuimteTransport` carries no audio.

- The mic shows only where the machine answers `voice.start` and `voice.keyStatus` says it holds a key. The mic and ⌘⇧M open `VoicePanel`.
- One session per app process, owned by the scene that started it (`VoiceCoordinator`).
- `AudioSessionController` holds the one audio session, configured as `LKRTCAudioSessionConfiguration.setWebRTC` expects. Anything that sets another category ends Voice.
- Voice continues in the background and on a locked screen (the `audio` background mode, `VoiceCoordinator.linkScene`). A call, another app taking the audio, or a dropped link ends Voice; what it started on the machine goes on.
- The waveform is held to the desktop's math by fixtures (`VoiceWaveformBands`, `VoiceWaveformMeter`). Only the newest 256 samples per side stay in memory (`VoiceSampleWindow`); nothing is kept or logged.
- The Live Activity (`VoiceLiveActivities`) is local only, without push. Its Mute and Stop are `LiveActivityIntent`s in `Shared/VoiceLive`.
- Language and voice are the machine's (`voice.preferences`, `voice.setPreferences`). The phone keeps no copy.
- Every build declares `NSMicrophoneUsageDescription` (in `project.yml`, worded in `InfoPlist.xcstrings`), so the App Store privacy label lists audio shared with OpenAI. `MicrophoneDeclarationTests` holds it.

Run `swift test --package-path apps/ios/Packages/RuimteVoice`.

## Native Apple sign-in

The system authorization sheet, with no browser callback and no web fallback. The app gets a one-time nonce from Pulsar, sends back Apple's identity token and code, and exchanges the returned login code with PKCE and the device key. See `apps/pulsar-worker/README.md` for the Apple configuration.

## How the connection is built

- `RuimtePulsar` owns the device key, Keychain store, PKCE, address-book API and session rotation. Every scene shares one `SessionVault` and ed25519 key. Keychain items use `AfterFirstUnlockThisDeviceOnly` without synchronization. Access tokens stay in memory.
- `RuimteTransport` shares each broker socket by URL and public key, waits for its ICE response before gathering, and refreshes expired credentials. One held connection per machine serves all scenes. The last release leaves a 30-second grace period; background closes links and foreground reconnects those still held. Liveness reads libwebrtc transport packets, not ping replies.
- ICE prefers a direct route, with TURN as fallback. Relay-only exists only in Connection diagnostics, on its own link (`diagnostic:<machine id>`).
- An attempt first signals at the machine's local door (`LanDoor.swift`, `Signaling.swift`), at every `lan` address from `endpoint.info` and `endpoint.changed`. The app sends a fresh nonce and says nothing about itself until the machine signed it with the pinned key (`pulsar-lan-door-v1`). The broker joins when no door is ready within 1000 ms, or at once when every door failed (also with Local Network permission refused). A door attempt gets STUN and no TURN. A door win that fails before its channel opens skips the local network for five minutes.
- A machine first admits the device with an account statement. After the pinned handshake the app keeps that pairing, bound to the machine ID and both public keys. A revoked pairing stays a refusal; the app never regains access through another statement. The statement goes into the offer as the address book answered it, and its v2 fields stay out of the signed signal bytes.
- `stasel/WebRTC` is pinned to `153.0.0`, commit `4266157cd08f92115de885ab12d87196a8db87e1`, in `RuimteTransport`. The machine link carries no audio or video and declares no microphone, camera or background audio.
- `RuimteVoice` uses LiveKit's WebRTC (`livekit/webrtc-xcframework`, MIT, `150.7871.03`, commit `a41df9e9bcc7ab1d62131fda75c123ea391e5188`), the only build that hands an app the samples of both sides with Apple's voice processing on. Its `LK` prefix lets both frameworks ship side by side.
- `packages/contracts/scripts/generate-swift.ts` generates the daemon API, schemas, constants, fixtures and closed vocabularies as Swift enums. `AgentKind`, `RuntimeMode`, `AgentStatus` and icon names are open on the wire (`x-open-enum`).
- `MachineClient` times out reads only, since a mutation ends when the link closes.

The web authentication callback is exactly `ruimte://pulsar/callback`, checked with the pending state before the exchange. `/v1/providers` decides which sign-in options show.

## Constraints

- One ed25519 key serves the account session and machine access; there is no second key as in the desktop app.
- Once every scene is in the background, connections close unless Voice runs. No VoIP or other workaround keeps them.
- `NWPathMonitor` reports path changes only, not libwebrtc's own sockets.
- Push alerts use AES-256-GCM because Bun offers no ChaCha20-Poly1305 through `node:crypto`.
- Simulator Keychain tests need local signing. Unsigned, the Keychain answers -34018 and they skip.
- CryptoKit's ed25519 signatures differ per call, so fixtures compare message bytes and verify signatures.

## Notifications and Live Activities

Notifications are opt-in. The phone picks the kinds (needs you, turn finished, process misbehaves) and per project All, Needs you only or Off (`NotificationPreferences`), and hands them to every machine with `push.subscribe`. The daemon decides what to send (`apps/server/README.md#push-notifications`); the address book relays (`apps/pulsar-worker/APNS.md`).

Alert content uses ephemeral X25519, HKDF-SHA256 and AES-256-GCM, with routing fields as additional authenticated data and the whole envelope signed with ed25519. The notification extension verifies the pinned machine key, device handle and validity window, then claims the message ID under a shared lock before it shows plaintext. A background approval action is claimed once and checked against fresh machine state; an expired or answered request opens its conversation without sending a decision. Responses that arrive before the account is restored wait in a queue.

A Live Activity is one overview per machine, counting working agents and those that need you, and ends when neither remains. Review on a row opens the terminal or chat and grants no permission. Machine names, phases, counts and timing are plaintext on purpose; alerts and read receipts stay encrypted. iPad Live Activities are out of scope.

## Xcode Cloud and TestFlight

The app is an Xcode Cloud product built from the committed project and `Ruimte.xcodeproj/xcshareddata/xcodecloud/manifest.json`. Workflows are edited through the App Store Connect API.

- `Release` starts on every `v*` tag and archives for TestFlight and the App Store. `ci_scripts/ci_post_clone.sh` sets `MARKETING_VERSION` from the tag and `CURRENT_PROJECT_VERSION` from `CI_BUILD_NUMBER`, generates the project and installs the Metal component. Both versions live in the spec because `agvtool` fails on a test target with `GENERATE_INFOPLIST_FILE = YES`.
- `Check` builds and tests on an iPhone simulator on main and on pull requests touching `apps/ios`, `packages/contracts` or `packages/pulsar`.

Onboarding refuses a project whose Swift packages live in repositories the team cannot grant access to. The product was made from a generated project without packages, then the real project was generated again; repeat that if it ever has to be made anew.

The privacy manifest covers local preferences, the shared notification store and elapsed connection timing. Review the archive's SDK privacy report and the App Store privacy answers before distribution. Apple references: [custom build scripts](https://developer.apple.com/documentation/xcode/writing-custom-build-scripts), [first workflow](https://developer.apple.com/documentation/xcode/configuring-your-first-xcode-cloud-workflow), [required-reason API declarations](https://developer.apple.com/documentation/technotes/tn3183-adding-required-reason-api-entries-to-your-privacy-manifest).

## Crash reports

A shipping build (Release on a device) always reports crashes, errors and the metrics below, and nothing else (`App/Telemetry`). Debug, the simulator, tests and previews send nothing. A report goes out for:

- a native crash, a main-thread hang of two seconds or more, or a watchdog termination
- a link that drops while open and is not back within 30 seconds
- a read without an answer in time
- a machine refused at the protocol check

The SDK's install id (`did`) is dropped at ingest because "Count users" is off for the app in Observatory. No tracing, profiling, logs, replay, screenshot or view hierarchy. The only breadcrumbs are the fixed words in `CrashReports.breadcrumbs`.

Every report is rebuilt as the desktop's (`packages/telemetry`): frames without source lines or variables, the error type and its message's first line, fixed tags and the `os`, `device` (model and architecture) and `runtime` contexts. Every string loses the app container, the names of the account, machines and projects with their folders, anything like a token, password or key, e-mail and IP addresses, URL paths, SQL, other paths and quoted text. The same error goes out once a day at most (`ruimte.telemetry.sent`). The release is `ruimte-ios@<version>+<build>`.

Reports go to Observatory (`ingest.bmnw.nl`). `ci_scripts/ci_post_xcodebuild.sh` uploads the dSYMs when the workflow has an `OBSERVATORY_UPLOAD_TOKEN` secret and never fails the build.

The same builds send the desktop client's four metrics with its names, units and attributes (`apps/client/src/telemetry/metrics.ts`):

- `link.connect`: milliseconds, `path` of `lan`, `direct` or `turn`, `outcome` of `ok` or `failed`
- `link.reconnect`: a count, `reason` of `dropped`, `failed`, `refused`, `timeout` or `switch`
- `request.duration`: milliseconds, `path` of the link, reads only and never `bytes.read`
- `workspace.load`: milliseconds from opening a project to the first frame of its page

`AppMetrics` aggregates for a quarter of an hour, as `MetricWindow` in `packages/telemetry` does, and keeps only the attributes in `AppMetrics.attributes`, so the SDK's `user.id` never goes along.

## Usage statistics

A shipping build counts a few things per UTC day and sends each finished day once to Observatory's iOS usage ingest, in the daemon's batch shape (`App/Telemetry`), with `launcher` `ios` and `platform` `ios` or `ipados`. It counts only what a machine cannot see: screens shown (`screens.now`, `projects`, `routines`, `machines`, `search`, `project`, `canvas`, `chat`, `terminal`, `machine`, `voice`, `settings`; a repeat counts once) and actions (`actions.messageSent`, `approvalAnswered`, `questionAnswered`, `chatStarted`, `attachmentAdded`). `UsageCounter` is the whole list. No day carries an id, name, path or text.

It follows the machines' `usageStats` switch (`endpoint.info`, `endpoint.changed`). The phone counts only after hearing from a machine of the account, and only while every machine it heard from has the switch on. One that says off stops counting and deletes unsent days. A machine that leaves the account loses its say. Days and switches live in `usage/stats.json` under Application Support, written at most once a minute and on backgrounding. The app sends at launch and on foreground, at most once an hour, up to seven days a batch and none older than eight days. A 400 drops a batch; any other failure keeps it.

## Device acceptance

What only a device can show (connection timing, push on a production build, VoiceOver, iPad multitasking) is in [`docs/ACCEPTANCE.md`](../../docs/ACCEPTANCE.md#iphone-and-ipad).
