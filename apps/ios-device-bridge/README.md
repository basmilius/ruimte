# iOS device bridge

The macOS-only Rust helper that keeps Apple's private device protocols out of the daemon. Root `CLAUDE.md` describes its routes. It uses the MIT-licensed [`idevice`](https://github.com/jkcoxson/idevice), [`block2`](https://github.com/madsmtm/objc2/tree/main/crates/block2) and [`objc2`](https://github.com/madsmtm/objc2) crates. CoreDevice and `remotepairingd` are private and may break with a new macOS or iOS.

Build with `cargo build --release --locked`.

## Simulator accessibility

`simulator-accessibility --udid <udid>` reads the accessibility tree of the frontmost app on a booted simulator. It needs no Simulator app, privacy grant or entitlement. It loads the private CoreSimulator and AccessibilityPlatformTranslation frameworks at run time (developer directory from `xcode-select -p`). A missing framework, class or selector comes back as `unavailable`, never a crash.

The daemon keeps one process per simulator while an agent operates it, with one JSON request per line on stdin and one reply per line on stdout. Closing stdin ends it.

```sh
echo '{"type":"tree","id":1}' | cargo run --release -- simulator-accessibility --udid <udid>
```

The first line is `{"type":"ready","scale":3.0}` (pixels per point), or an error and exit code 1. A request gets `{"type":"tree","id":1,"scale":3.0,"root":{...},"truncated":false,"ms":34}` or `{"type":"error","id":1,"code":"...","message":"..."}`. A node has `role`, `subrole`, `label`, `value`, `identifier`, `frame` (`x`, `y`, `width`, `height` in points, origin top left), `enabled` and `children`. `timeoutMs` defaults to 10 s, after which the reply is `timeout`.

The first read after a boot takes one to three seconds, later trees 20 to 90 ms. The tree holds the frontmost app or a system alert over it, without web content or offscreen list cells. An agent uses a screenshot for those.

## Test the Rust transport

Unlock the iPhone, enable Developer Mode, and pair it with the Mac (it works in Apple's Device Hub). Check that Apple's tooling sees it, then probe the wireless transport without Ruimte:

```sh
xcrun devicectl list devices
cargo run --manifest-path apps/ios-device-bridge/Cargo.toml --release -- probe --transport wireless --timeout 20
```

Pass `--udid <hardware-udid>` when more than one device is connected. A good probe waits for one complete HEVC access unit and prints:

```json
{"codec":"hevc","frameBytes":34597,"ok":true,"packets":31,"transport":"remotepairingd"}
```

The probe saves no screen contents and prints no device identifier. `--transport usb` is only for diagnosing the cabled route.

iOS checks synthetic HID events against the active display session, so the probe cannot test input. Open the device in Ruimte and try touch, Home, Lock, Siri and rotation there.

| `devicectl` | Rust probe | Meaning |
| --- | --- | --- |
| Device missing | Fails with `no matching wireless device` | Check that Device Hub sees the unlocked phone and both are on the same network. |
| Device visible | Fails before `Remote Service Discovery` | The `remotepairingd` assertion or Apple tunnel needs investigation. |
| Device visible | Fails after the display service starts | The display protocol or RTP handling needs investigation. |
| Device visible | Prints `"ok":true` | The Rust transport and first video frame work. |
