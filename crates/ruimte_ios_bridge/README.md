# ruimte_ios_bridge

`ruimte_ios_bridge` is the macOS library for physical Apple device capture and input. It joins Apple's existing wireless `remoted` tunnel through `remotepairingd`, receives the CoreDevice RTP display stream, and forwards complete Annex-B HEVC access units over Ruimte's RDEV pipe. A direct usbmuxd route remains available for a cabled device.

The Rust server links this crate and starts its own private helper command as a child process. The process isolates private XPC and CoreDevice code from the daemon. There is no standalone bridge CLI and no screenshot fallback in the physical-device backend. Linux builds expose an unsupported-platform error without compiling Apple framework dependencies.

Readiness follows the first complete HEVC access unit. The helper retains the audio receiver, native tunnel and HEVC depacketizer throughout capture. A startup deadline reports failure when no usable video arrives.

From the repository root:

```sh
cargo check --locked -p ruimte_ios_bridge
cargo test --locked -p ruimte_ios_bridge --lib
cargo build --locked -p ruimte_server --bin ruimte-server
```

Use the physical-device view in Ruimte to exercise the full transport. The Mac and phone must already be paired, Developer Mode must be enabled, and Apple's Device Hub must see the unlocked phone. `xcrun devicectl list devices` checks discovery. The bridge requires noninteractive pairing and will not trigger a new pairing flow itself.

The library uses the MIT-licensed `idevice` and `block2` crates. Apple's CoreDevice and `remotepairingd` protocols are private and may require changes with future OS releases. No Python installation is required.

Read-only streaming on an iPhone 18 Pro Max passed debug HTTP, debug WebSocket events and a packaged production server. FFmpeg and Chromium WebCodecs decoded every captured frame with no sequence gaps. This does not establish physical HID coverage. Evidence and remaining limits are in [VERIFICATION.md](../../docs/rust-daemon/VERIFICATION.md).
