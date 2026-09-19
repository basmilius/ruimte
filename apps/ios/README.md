# Ruimte for iPhone and iPad

A native remote client for your Ruimte machines, requiring iOS or iPadOS 26. It opens
projects, chats, terminals, files, drawings and diagrams without running a local daemon.
The canvas supports navigation, nodes and context links; existing nodes keep their position
and size. Browser pages use an isolated WKWebView without a machine bridge.

## Included

- Native Sign in with Apple, GitHub web sign-in, HTTPS pairing links and
  shared authenticated WebRTC connections. Normal ICE selection allows direct connections;
  TURN is a fallback. The relay-only switch is confined to connection diagnostics.
- Project creation and navigation, view ordering and names, local camera/selection, and
  three-way merges with explicit conflict resolution. Unknown view/node kinds survive saves.
  Separators group the view list into sections; rows show the name and desktop Lucide or chosen emoji icon.
  Projects use native grouped lists with a separate recently closed page. Custom image icons,
  including `.idea/icon.svg`, use the existing authenticated `projectIcon` byte resource and dark variant.
  A cold start reopens the project you left open; if that fails, the list says why and offers Try again.
  Going back to the list forgets it. An empty canvas offers tiles for the installed agents from `provider.list`
  and for each kind of node, and an empty drawing or diagram says so until its first element.
- Native chat timeline, streaming, markdown/code highlighting, model options, drafts,
  attachments, context selection, approvals and questions. The composer styles Markdown
  while editing and shows selected files and skills as inline badges.
- Drawing with a finger or Apple Pencil, pressure, pen colors and widths, whole-element
  erasing, undo, pan and zoom. Selection, shapes and text creation are included.
  Unsaved drawing drafts persist locally for recovery.
- SwiftTerm terminals with snapshots, output, resync, keyboard controls and paste confirmation.
  `session.attach` uses `follow:true` so opening a phone never resizes the desktop PTY.
- File and media previews, filesystem updates, Git changes/staging/commits,
  usage and machine access management. Destructive actions require confirmation.
  Usage follows the OS region: EUR regions use the supplied exchange rate; other regions use USD.
  Missing or invalid rates keep dollar amounts and show an explanation.
- Optional encrypted push alerts and approval actions, per-session follows, a notification
  service extension and Live Activities. APNs delivery requires the service configuration below.

## AI conversations

The timeline shows a Working timer, live Thinking text and individual running tools
with summaries, elapsed time and the last output lines. Active labels shimmer; new
words fade in. The conversation menu offers Words, Blocks and Whole streaming modes.
Reduce Motion shows text directly and keeps static activity labels.

Completed turns fold their work behind a duration label while keeping the answer and
warnings visible. Subagent messages stay under their agent, with a separate result and
links from automatic follow-up turns. Changed files use checkpoint diffs when available,
then provider patches or replacement fragments. Tool output initially shows 4,000
characters; large diffs initially show 400 lines, with explicit expansion controls.

A chat with sub-agents offers Sub-agents in the conversation menu. It opens a list with Active and Done
sections, most recently updated first, each entry with its state, the latest tool call or
reply (or the report a sub-agent handed back) and its running time or end time. An entry, or a
subagent row in the timeline, opens that conversation read-only on its own page; Back returns
one level. Swipe or long-press an active entry to stop a task (after a confirmation that counts
what ends) or mark a sub-agent of the CLI's own as stopped. Long-press the composer's Stop for
Stop with sub-agents. Task marks appear on the nodes a task opened, wake turns say how many
tasks woke them, and a failed task or a wake the machine gave up on leaves an unseen mark.
Model and permission picks are remembered and sent to every connected machine for the chats it
starts on its own. Older machines keep working: requests they do not know are ignored.

A chat whose agent keeps a plan shows its progress beside Sub-agents as the desktop pill: "6/11" with a double check
on a raised capsule, a red dot for a failed step and an accent dot for a plan made since the chat was last opened; the
phone never opens a plan on its own. While the agent works on a step the check turns into a spinning ring. The sheet
is drawn after the desktop plan panel: the chat as its title, a header with the plan's title, kind, counters, status
line and a progress bar, which never move with the agent's progress. While a step is active the toolbar holds its
spinning ring (or the pause once the agent stopped), kept for 1.5 seconds after the step ends so it does not flicker
between steps; a tap scrolls to that step, unfolding or clearing whatever hides it, and cycles through several. The overflow menu holds the filter (All, Open or Issues: failed,
blocked or warning), Collapse done, Expand all and Collapse all, kept on the phone, and Copy as Markdown. Sections,
text blocks and steps follow as custom rows with the same Lucide circles, one column per row: a step under a section
lines up with the section's caret and a child sits under its parent's title. A parent shows "2/3" instead of a circle,
and a tap anywhere on a section or parent folds it. Warning (amber) and info (blue) are outcomes like passed. The step the
agent works on spins with an accent background while its turn runs; once the agent stopped it shows a pause and
"<Agent> stopped here". A step a person set shows "you" and the time; who else set a step and a lock's reason sit in
its long-press menu and its VoiceOver value. In a steps plan the circle toggles open and done; in a test plan the
circle opens the outcomes and a swipe gives Passed, Info, Failed, Warning or Skipped; Failed, Warning and Info ask for
a note. Long-press a step for every state, Add note, Unlock and Copy. A chat with several plans switches in the title
menu, newest first. Changes go through `plan.apply`, and a refusal from the machine is shown.
One `plan.list` per connection fills the pills, and `plan.changed` and `plan.removed` keep them current.

Long-press a message you sent, an answer or a turn's duration label for Fork from here. A sheet
asks what the desktop dialog asks: the title, the CLI and model to continue with, a node beside the
original or a view of its own (a chat view always forks into a view), and in a repository a git
worktree on a free branch with the work after the turn undone. The conversation menu forks after the
last turn that ended. Once the machine has written the fork into the project, the app opens it. A
fork shows "Fork of <original>" under its title; the title menu and the conversation menu offer
Summarize for <original> and Show original. In the original, the summary note shows its first line,
folds the rest open and offers Open fork, and a turn that was forked says so beside its duration.
A machine without these requests says it needs an update and nothing else changes.

With three or more messages, Messages in the conversation menu lists what you sent and the turns tasks woke: a
popover on iPad, a sheet on iPhone. It opens scrolled to what is on screen, marks those messages,
searches, jumps on a tap and offers Copy and Fork from here on a long press or a swipe.

Messages support nested lists, tasks, quotes, tables, matching code fences and reference
links. Long prompts can fold; mentions and skills retain their styling. Message context
menus copy text or Markdown. File links open the machine's native file viewer, including
line references. Raster attachments and supported image reads show thumbnails; tapping
a thumbnail opens the original through Quick Look.

Text deltas update observable message records without rebuilding the timeline structure.
Completed Markdown segments are cached, code highlighting processes the latest pending
text at bounded intervals, and the collection keeps its existing reading anchors.
History uses an optional 60-item first page and a Load older messages control. The daemon
uses a 512 KiB item budget per page; a larger atomic item travels alone, without truncation.
Pending approvals and questions are included separately. Cursors expire after clear/reset,
and history replies apply before the next stream event. Older daemons still return their
full snapshot; the app accepts it and does not issue unsupported history requests.
Pagination becomes live only after the daemon is updated.

The current implementation summary and remaining checks are recorded in the
[iOS report](../../docs/reports/2026-09-15-ios-app.html).
Physical iPhone builds were installed at milestones. Visual timing, selection during
streaming, VoiceOver, larger text and iPad multitasking still require hands-on acceptance.

## Build locally

From the repository root, with Xcode 27, XcodeGen and Bun installed:

```sh
bun install --frozen-lockfile
bun run --cwd packages/contracts generate:swift
xcodebuild -downloadComponent MetalToolchain
xcodegen generate --spec apps/ios/project.yml
open apps/ios/Ruimte.xcodeproj
```

Set `DEVELOPMENT_TEAM = YOUR_TEAM_ID` in `apps/ios/Signing.xcconfig` to keep your local
team selection across project regeneration. This file is ignored by git and is optional
for simulator builds and CI. Choose the Ruimte scheme and your iPhone or iPad, enable
Developer Mode on the device if requested, and run.
The bundle ID is `app.ruimte.mobile`; the extensions are `app.ruimte.mobile.notifications`
and `app.ruimte.mobile.activity`. The project uses automatic signing. `project.yml` is the
source of the committed Xcode project; regenerate it when adding files or dependencies.
Commit the generated project and resolved packages, excluding user state and build products.
SwiftTerm is pinned to 1.15.0, Highlightr to 2.3.0 and WebRTC to 153.0.0. SwiftTerm's
shader compilation requires Apple's separate Metal Toolchain.

App icons use [LucideSwift](https://github.com/ajaxjiang96/lucide-swift), pinned to
0.9.5 with upstream icons 1.46.0. Project/view glyphs use native SwiftUI paths; toolbar,
menu and status icons use template images generated from the same paths. These images
are cached in the app. Live Activities also use Lucide. System-provided controls keep
their native icons, and provider logos and custom project SVGs remain separate.
The package and upstream ISC notices are in `App/Design/Lucide-LICENSE.txt`.

In writing mode the chat composer shows its context, photo and model controls. A pending
permission or question takes over the same glass shape, growing upward from the composer.
The request stays in place until it is handled; answering the last request restores the draft,
attachments and selection. Questions show
choices and free text inline, with Previous and Next for a sequence. Only optional questions
can be dismissed. Failed submissions retain their input, and sending disables repeat actions.
The glass container interpolates between measured composer and prompt heights, anchored at
its bottom edge. The editor stays mounted while its content fades and blurs; a shared action
shape grows from the send circle into the prompt button. The send button remains mounted and
disabled for an empty draft; a running turn puts Stop beside it. Prompt actions sit in a bottom
safe-area bar with a soft scroll-edge blur. Reduce Motion switches states directly.
The shape uses concentric corners with a minimum 24-point radius away from screen edges.

Current iteration agreement: build and install only on Bas's physical iPhone,
`00008130-001C7D411E20001C`. No simulator, UI tests or iPad installation. Targeted
protocol, crypto and state tests run on the Mac. Do not restart the running daemon.

```sh
xcodebuild -project apps/ios/Ruimte.xcodeproj -scheme Ruimte -configuration Debug \
    -destination 'generic/platform=iOS' -derivedDataPath /tmp/ruimte-ios-xcode \
    -allowProvisioningUpdates build
xcrun devicectl device install app --device 00008130-001C7D411E20001C \
    /tmp/ruimte-ios-xcode/Build/Products/Debug-iphoneos/Ruimte.app
swift test --package-path apps/ios/Packages/RuimtePulsar --scratch-path /tmp/ruimte-ios-pulsar-build
swift test --package-path apps/ios/Packages/RuimteTransport --scratch-path /tmp/ruimte-ios-transport-build
bun run check
```

## Native Apple sign-in

Apple uses the system authorization sheet, with no browser callback. The app asks
Pulsar for a one-time nonce and sends Apple's identity token and authorization code
back over HTTPS. Pulsar verifies both tokens for `app.ruimte.mobile` and returns a
short-lived login code. The existing PKCE and device-key exchange creates the session.
Apple and web sign-in resolve the same account when their App ID and Services ID are
grouped in Apple Developer.

Deploy Pulsar's `0007_native_apple.sql` migration and `/v1/apple/start` and
`/v1/apple/complete` routes before installing a build that uses native Apple sign-in.
The app requires the Sign in with Apple capability on its provisioning profile.
There is no automatic web fallback when the native service is unavailable. Existing
GitHub sign-in is unchanged. See the Worker README for the Apple configuration.

## How the connection is built

- `RuimtePulsar` owns the device key, Keychain store, PKCE, address-book API and session
  rotation. Every scene shares the same `SessionVault` and ed25519 key. Keychain items use
  `AfterFirstUnlockThisDeviceOnly` without synchronization. Access tokens stay in memory.
- `RuimteTransport` shares each broker socket by URL and public key, waits for its ICE
  response before gathering, and refreshes expired credentials. One held connection per
  machine serves all scenes. The last release leaves a 30-second grace period; background
  closes links and foreground reconnects those still held. `NWPathMonitor` detects path
  changes. Liveness reads libwebrtc transport packets rather than ping replies.
- Normal ICE selection prefers a usable direct route, as in the existing clients. TURN
  supplies a fallback when direct candidates cannot connect. Relay-only is off by default
  and is available solely through the test app's diagnostic switch.
- A machine first admits the device with an account statement. After the pinned channel
  handshake succeeds, the app persists that pairing in local preferences, bound to the
  machine ID and both public keys. Later attempts omit the statement and need no account
  request. A revoked pairing remains a refusal; the app does not silently regain access
  through another statement. Every attempt still verifies the machine key and channel proof.
- `stasel/WebRTC` is pinned to release `153.0.0`, commit
  `4266157cd08f92115de885ab12d87196a8db87e1`. The native adapter exchanges no audio/video
  tracks and declares no microphone, camera or background-audio capability.
- `packages/contracts/scripts/generate-swift.ts` generates the full daemon request/result/event
  API, JSON schemas, constants and TypeScript fixtures. It also generates the closed vocabularies
  of the daemon's own schemas as Swift enums (agent, task, plan and chat), with the plan markers,
  so a switch over one stops compiling when a case is added; their object schemas stay out, since a
  plan step holds its own sub-steps and the resulting `$ref` is not resolved here.
  `bun run check` refuses stale output.
  `MachineClient` correlates responses, bounds timeouts, rejects pending requests on disconnect,
  shares subscriptions/attachments and reads versioned resources in chunks.
- Required nullable fields, optional fields and optional nullable fields remain distinct.
  `Presence` represents missing, null and value when all three occur. The validator strips
  unknown object keys like Zod. The statement lifetime refinement is an explicit generator
  override because JSON Schema does not preserve Zod refinements.

The web authentication callback is exactly `ruimte://pulsar/callback`, checked with the
pending state before exchange. `/v1/providers` controls the login options; Apple uses
the native token exchange described above. HTTPS pairing links are accepted from the
welcome screen and Projects page; redirects are refused to keep a token on its intended
origin. This app contains no local daemon.

## Constraints

- One ed25519 key serves the account session and machine access. There is no separate trusted
  shell process, so no second key as in the desktop app.
- A visible iPad scene keeps held links alive when another scene backgrounds. Once every scene is
  in the background, connections close. No background audio, VoIP or other workaround keeps them.
- `NWPathMonitor` reports path changes only; it does not observe libwebrtc's own sockets.
- Push alerts use AES-256-GCM because the Bun runtime offers no ChaCha20-Poly1305 through
  `node:crypto`.
- The app validates `chat.attach` and `chat.history` whole, so one chat item kind or enum value it
  does not know rejects the conversation. The daemon wire only gains optional fields.
- Simulator Keychain tests need local signing: unsigned, they fail with -34018 (missing entitlement).
- CryptoKit's ed25519 signatures differ per call, so fixtures compare message bytes and verify
  signatures rather than comparing them.

## Device checks for Bas

Use a current installed Ruimte on the MacBook, already registered on your Pulsar account.
Keep the MacBook awake and its existing broker/TURN configuration intact. The app does
not change any production infrastructure.

1. **Sign in.** Open the app and continue with an available provider. Cancel once and
   confirm you can retry. Complete login, close the app, then reopen it. The account and
   machine list should return without another browser login. The displayed public key
   should stay the same. Test Apple too when `/v1/providers` includes it.
2. **Wi-Fi.** Leave "Require relay for this test" off and select the MacBook. Record
   `server.hello`, the machine version, "Selected ICE path" and the milliseconds in
   "Connection to server.hello". The acceptance target is below 5,000 ms. The selected
   route may be direct or relay; "Not measured" is not proof of either.
3. **5G.** Turn Wi-Fi off in Settings, keeping mobile data enabled. Wait for the reconnect
   and record the same fields. Repeat five times with the Reconnect button. Record every
   failure as well as the median and slowest successful time.
4. **TURN explicitly.** Enable "Require relay for this test" and reconnect on both Wi-Fi
   and 5G. `server.hello` plus "Via relay" proves the selected candidate uses TURN. A
   successful ordinary connection alone does not. If this fails, record the error and
   network; code availability does not prove the broker has working production TURN
   credentials or that the relay ports are reachable. Turn this setting off afterward.
5. **Background.** While connected, go Home for at least 30 seconds. Return and record the
   new `server.hello` time. Repeat five times, including one lock/unlock. The target is
   below 3,000 ms after foreground. The previous hello disappears when the link closes;
   only a new answer counts. A machine that becomes unreachable should show its error
   and reconnect when its network returns.
6. **Two iPad windows.** Open Ruimte in two windows and select the same machine in both.
   Hide one window while keeping the other visible. The visible connection should stay
   live. Background the whole app, then return. Held windows should share one new
   connection. Disconnecting one window must not disconnect the other.
7. **Statement origin.** On the desktop, open Settings > Remote, open the MacBook and
   inspect Apps with access. Find "Ruimte on iPhone" or "Ruimte on iPad" and compare its
   public key with the test app. The underlying `auth.sessions` result must show
   `origin: "statement"`, not `"link"`. If this device was already paired manually,
   test with a fresh simulator/device key because existing pairings retain their origin.
8. **Path change and cancellation.** Start a connection, disconnect while it is still
   opening, then select it again. No late result from the canceled attempt should replace
   the current attempt. Switch Wi-Fi/5G while connected and verify a new hello arrives.

Keep a row for each attempt:

| Device / OS | Network | Relay required | Selected path | Hello ms | Foreground ms | Result / error |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

Local build and unit tests cannot establish production relay reachability, browser
login on a device, scene behavior under iPad multitasking, or reconnect latency on 5G.
Record these measurements separately from the local build and tests. Development does not
wait between phases, but these criteria are not established by simulator success.

## Notifications and Live Activities

Notifications are opt-in in Settings and automatically cover agents on every connected
machine; approvals can be enabled independently. The phone registers its APNs token
with the address book and sends its opaque handle, push public key and preferences to
each authenticated machine. Alerts are sent only while the paired key has no connected
client. Older daemons receive a snapshot of known sessions as a compatibility follow list.

Live Activities show one automatic overview per daemon, combining terminal agents and
native chats. The overview counts working agents and agents needing attention, and ends
only when neither remains. Opening another chat does not select or replace the overview.
Several machines can each have an activity; tapping one opens that machine's active
agents. The Worker accepts only the fixed machine-summary collapse ID in automatic mode,
checks account ownership and verifies the signature over the counts as well as routing.
Current and rotated push-to-start/update tokens are uploaded through authenticated
account routes. Opt-out disables remote starts and ends local activities. iPad Live
Activities are outside the current scope. Failed device revocations retain their opaque
handle for retry after local keys are erased.

Notification callbacks are installed in the app delegate before launch finishes. Responses
received before account restoration are queued, and UIKit completion handlers run on the
main thread. A single phone navigation destination replaces a workspace with the selected
notification route without competing navigation bindings.

Background approval actions are claimed once, then checked against fresh machine state.
An expired or already answered request opens its conversation without sending a decision.
The snapshot check also considers approvals outside the loaded history page.

Alert content uses ephemeral X25519, HKDF-SHA256 and AES-256-GCM. Routing fields are
additional authenticated data, and the machine signs the full envelope with ed25519. The
notification extension verifies the pinned machine key, device handle and validity window,
then claims the message ID under a shared lock before displaying plaintext. The nonce,
key derivation and ciphertext are checked against a generated Bun/CryptoKit fixture.
Live Activity machine names, phases, counts and timing are the intentional plaintext exception.

Required configuration and device acceptance:

1. Enable Push Notifications and Time Sensitive Notifications for `app.ruimte.mobile`.
   Register both extension IDs under the same Apple team. Enable app group
   `group.app.ruimte.mobile` for the app and notification extension, with the shared
   `app.ruimte.mobile.push` Keychain group. Regenerate provisioning profiles.
2. Apply the Worker migrations through `0010_pending_activity_updates.sql` to the intended
   environment. Configure `APNS_SANDBOX_KEY` / `APNS_SANDBOX_KEY_ID` and
   `APNS_PRODUCTION_KEY` / `APNS_PRODUCTION_KEY_ID` with the matching APNs credentials.
   The repository now sets `APNS_TEAM_ID=7RGV9KKX87` and `APNS_TOPIC=app.ruimte.mobile`.
   The key must have APNs rights for that team; the Apple login key is not a substitute.
   Missing configuration produces an explicit `not-configured` response; no credentials are embedded here.
3. Deploy the matching Worker and daemon through the project's normal release process.
   Registration is bound to an active account session. Delivery requires an authorized
   machine on the same account; a manually paired machine outside that account cannot
   use this account's push service.
4. On a signed physical device, enable notifications, follow a live session, background
   the app, and test turn completion and both approval choices. Also test an expired
   request, a desktop answer arriving first, revocation, key loss and the generic fallback.
5. Enable Live Activities and follow a turn. Check phase changes, completion, expiry and
   push-to-start on the Lock Screen and Dynamic Island. Try the same node ID on two
   machines to verify that activity routing stays separate.

On September 16, the production Worker secret-name list contained no APNs entries.
The new Worker configuration and migration have not been deployed. The new daemon code
has not been started; existing sessions were left running. Distribution is deferred.

Production APNs delivery and background success rates require those device tests. Unit
tests inject APNs transport and do not send real notifications.

## Xcode Cloud and TestFlight

The shared `Ruimte` scheme and generated Xcode project are committed for Xcode Cloud
onboarding. `ci_scripts/ci_post_clone.sh` generates the project and installs the required
Metal component; `ci_pre_xcodebuild.sh` uses `CI_BUILD_NUMBER` for the build number.
Configure the workflow in Xcode/App Store Connect with this project, an iOS simulator
Test action, and a Release Archive action. Add a TestFlight post-action to the release-tag
workflow after signing and App Store Connect configuration are complete.

The repository contains the existing Ruimte Icon Composer icon and a privacy manifest for
local preferences, the shared notification store and elapsed connection timing. Review the archive's aggregated SDK
privacy report and the account service's App Store privacy answers before distribution.
No Apple distribution credentials, APNs credentials, Xcode Cloud workflow or TestFlight
upload is created by a local source build.

Apple references: [custom build scripts](https://developer.apple.com/documentation/xcode/writing-custom-build-scripts),
[first workflow](https://developer.apple.com/documentation/xcode/configuring-your-first-xcode-cloud-workflow),
[required-reason API declarations](https://developer.apple.com/documentation/technotes/tn3183-adding-required-reason-api-entries-to-your-privacy-manifest).

## Feature acceptance on devices

- Open one project in two iPad windows. Close one, and keep the other chat/terminal live.
  Edit a view name on both clients to exercise conflict resolution; move a node on desktop
  while renaming it on the phone to verify independent changes merge.
- Stream a long chat with tools, images, an approval and a question. Check scrolling,
  keyboard accessibility, draft recovery, reconnect and a 300-line code block.
- Attach to `vim`/`htop`, reconnect, resync and paste multiple lines. Confirm desktop rows
  and columns stay unchanged. Measure the memory and responsiveness of large output.
- Pan a 30-node canvas with 20 edges, rotate the screen, return to the saved camera and
  use VoiceOver/list view. Compare drawing paths and text against desktop.
- Test file watching, image/video previews, Git stage/unstage/commit and confirmed process
  signals against a disposable project before using them on active work.
