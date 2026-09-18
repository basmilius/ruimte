# iOS device bridge

This macOS-only app keeps private physical-device protocols outside the daemon. Its primary route joins Apple's existing wireless `remoted` tunnel through `remotepairingd`, so the iPhone does not need a USB connection. It receives the CoreDevice display service's RTP stream and forwards complete Annex-B HEVC access units over Ruimte's existing helper pipe. The same session sends touch, multitouch, hardware-button and rotation events through CoreDevice HID. A direct usbmuxd route remains available as a fallback for a cabled device.

The implementation is Rust and uses the MIT-licensed [`idevice`](https://github.com/jkcoxson/idevice) and [`block2`](https://github.com/madsmtm/objc2/tree/main/crates/block2) crates. It does not install or launch Python. The CoreDevice and `remotepairingd` protocols are private and may need updates for future macOS and iOS releases.

Build the app with `cargo build --release --locked`.

## Test the Rust transport

Unlock the iPhone and enable Developer Mode. The Mac and iPhone must already be paired, as they are when the device works in Apple's Device Hub. Check that Apple's tooling can see it over the network:

```sh
xcrun devicectl list devices
```

Then test the Rust wireless transport without starting Ruimte:

```sh
cargo run --manifest-path apps/ios-device-bridge/Cargo.toml --release -- probe --transport wireless --timeout 20
```

Pass `--udid <hardware-udid>` when more than one device is connected. A successful probe waits for one complete HEVC access unit and prints JSON like this:

```json
{"codec":"hevc","frameBytes":34597,"ok":true,"packets":31,"transport":"remotepairingd"}
```

The probe does not save screen contents or print a device identifier. Use `--transport usb` only to diagnose the secondary cabled route.

Interactive input is available through Ruimte while a physical stream is open. iOS authenticates synthetic HID events against the active display session, so input cannot be tested with the standalone frame probe. Open the device in Ruimte and use the screen or device toolbar to test touch, Home, Lock, Siri and rotation.

This table isolates the failing layer:

| `devicectl` | Rust probe | Meaning |
| --- | --- | --- |
| Device missing | Fails with `no matching wireless device` | Check that Device Hub sees the unlocked phone and that both devices are on the same network. |
| Device visible | Fails before `Remote Service Discovery` | The `remotepairingd` assertion or Apple tunnel needs investigation. |
| Device visible | Fails after the display service starts | The display protocol or RTP handling needs investigation. |
| Device visible | Prints `"ok":true` | The Rust transport and first video frame work. |
