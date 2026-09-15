# Ruimte for iPhone and iPad

Phase 0 is a native connection test app. It signs in to Pulsar, lists account machines,
connects through the broker and WebRTC, and displays `server.hello`. It requires iOS or
iPadOS 26. Later phases wait for Bas to complete the device checks below.

## Build locally

From the repository root, with Xcode 27, XcodeGen and Bun installed:

```sh
bun install --frozen-lockfile
bun run --cwd packages/contracts generate:swift
xcodegen generate --spec apps/ios/project.yml
open apps/ios/Ruimte.xcodeproj
```

Choose the Ruimte scheme and your iPhone or iPad. Select your development team in
Signing & Capabilities, enable Developer Mode on the device if requested, and run.
The bundle ID is `app.ruimte.mobile`. The project uses automatic signing. The generated
Xcode project and build products stay outside Git.

For simulator tests, replace the destination with an installed simulator if needed:

```sh
xcodebuild -project apps/ios/Ruimte.xcodeproj -scheme Ruimte \
    -destination 'platform=iOS Simulator,name=iPhone 18 Pro,OS=27.0' \
    -parallel-testing-enabled NO -derivedDataPath /tmp/ruimte-ios-xcode \
    test CODE_SIGN_IDENTITY=-
```

Keep local ad hoc signing enabled. `CODE_SIGNING_ALLOWED=NO` removes the simulator's
application identity and Keychain access fails with `errSecMissingEntitlement`.
No provisioning profile, distribution certificate or deployment is needed for these
simulator tests. A physical device needs your development signing identity.

```sh
swift test --package-path apps/ios/Packages/RuimtePulsar --scratch-path /tmp/ruimte-ios-pulsar-build
swift test --package-path apps/ios/Packages/RuimteTransport --scratch-path /tmp/ruimte-ios-transport-build
bun run check
bun test
```

## How the connection is built

- `RuimtePulsar` owns the device key, Keychain store, PKCE, address-book API and session
  rotation. Every scene shares the same `SessionVault` and ed25519 key. Keychain items use
  `AfterFirstUnlockThisDeviceOnly` without synchronization. Access tokens stay in memory.
- `RuimteTransport` shares each broker socket by URL and public key, waits for its ICE
  response before gathering, and refreshes expired credentials. One held connection per
  machine serves all scenes. The last release leaves a 30-second grace period; background
  closes links and foreground reconnects those still held. `NWPathMonitor` detects path
  changes. Liveness reads libwebrtc transport packets, not just ping replies.
- Normal ICE selection prefers a usable direct route, as in the existing clients. TURN
  supplies a fallback when direct candidates cannot connect. Relay-only is off by default
  and is available solely through the test app's diagnostic switch.
- `stasel/WebRTC` is pinned to release `153.0.0`, commit
  `4266157cd08f92115de885ab12d87196a8db87e1`. The native adapter exchanges no audio/video
  tracks and declares no microphone, camera or background-audio capability.
- `packages/contracts/scripts/generate-swift.ts` generates the phase-0 models, JSON
  schemas, constants and TypeScript fixtures from `packages/pulsar` and
  `packages/contracts`. `bun run check` refuses stale output. Full daemon API generation
  belongs to phase 1. The generated `ProjectCanvasDefaults` projection exists only to
  test the source schema's default; the app does not open or edit a canvas.
- Required nullable fields, optional fields and optional nullable fields remain distinct.
  `Presence` represents missing, null and value when all three occur. The validator strips
  unknown object keys like Zod. The statement lifetime refinement is an explicit generator
  override because JSON Schema does not preserve Zod refinements.

The authentication callback is exactly `ruimte://pulsar/callback`, checked with the
pending state before exchange. `/v1/providers` controls the login options; Apple uses
its existing Worker redirect flow. Native Apple token exchange and HTTPS pairing-link
entry are later phases. This app contains no local daemon.

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
Phase 0 remains awaiting device acceptance until these measurements are recorded.
