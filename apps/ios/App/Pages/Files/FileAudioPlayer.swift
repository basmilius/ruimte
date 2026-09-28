import AVFoundation
import SwiftUI

/// What a sound file says about itself, read once the asset loads.
struct FileAudioInfo: Equatable {
    var title: String?
    var artist: String?
    /// In seconds; zero when the file does not say.
    var duration: Double

    static func load(from asset: AVAsset, duration: CMTime) async -> FileAudioInfo {
        let metadata = (try? await asset.load(.commonMetadata)) ?? []
        let text = { (identifier: AVMetadataIdentifier) async -> String? in
            guard let item = AVMetadataItem.metadataItems(from: metadata, filteredByIdentifier: identifier).first,
                let value = try? await item.load(.stringValue)?.trimmingCharacters(in: .whitespacesAndNewlines),
                !value.isEmpty
            else { return nil }
            return value
        }
        let seconds = duration.seconds
        return FileAudioInfo(
            title: await text(.commonIdentifierTitle), artist: await text(.commonIdentifierArtist),
            duration: seconds.isFinite ? max(seconds, 0) : 0)
    }
}

/// A sound file's own player: what it is, where it is and one button, since a picture-less video player is mostly
/// an empty black box on a phone.
struct FileAudioPlayer: View {
    let player: AVPlayer
    let name: String
    let info: FileAudioInfo
    @State private var position: Double = 0
    @State private var scrubbing = false
    @State private var playing = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer(minLength: 0)
            Image(lucide: "file-music", size: 56)
                .foregroundStyle(MobileStyle.muted)
                .frame(width: 128, height: 128)
                .background(MobileStyle.panel, in: RoundedRectangle(cornerRadius: 24))
            VStack(spacing: 4) {
                Text(info.title ?? name).font(.headline).multilineTextAlignment(.center).lineLimit(3)
                if let artist = info.artist {
                    Text(artist).font(.subheadline).foregroundStyle(MobileStyle.muted).lineLimit(2)
                }
            }
            VStack(spacing: 6) {
                Slider(value: $position, in: 0...max(info.duration, 0.1)) { editing in
                    scrubbing = editing
                    if !editing { seek(to: position) }
                }
                .accessibilityLabel("Position")
                .accessibilityValue(FileKinds.playbackClock(position, total: info.duration))
                .disabled(info.duration <= 0)
                HStack {
                    Text(verbatim: FileKinds.playbackClock(position, total: info.duration))
                    Spacer()
                    Text(verbatim: "-" + FileKinds.playbackClock(info.duration - position, total: info.duration))
                }
                .font(.caption).monospacedDigit().foregroundStyle(MobileStyle.muted)
                .accessibilityHidden(true)
            }
            Button(action: toggle) {
                Image(lucide: playing ? "pause" : "play", size: 28)
                    .frame(width: 72, height: 72)
                    .background(MobileStyle.accent, in: Circle())
                    .foregroundStyle(MobileStyle.onAccent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(playing ? "Pause" : "Play")
            Spacer(minLength: 0)
        }
        .frame(maxWidth: 480)
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // AVPlayer reports its time only to an observer it holds; reading it four times a second needs nothing torn down.
        .task(id: ObjectIdentifier(player)) {
            while !Task.isCancelled {
                if !scrubbing {
                    let seconds = player.currentTime().seconds
                    position = seconds.isFinite ? min(max(seconds, 0), info.duration) : 0
                }
                playing = player.timeControlStatus != .paused
                try? await Task.sleep(for: .milliseconds(250))
            }
        }
    }

    private func toggle() {
        if playing {
            player.pause()
            playing = false
            return
        }
        if info.duration > 0, position >= info.duration - 0.25 { seek(to: 0) }
        player.play()
        playing = true
    }

    private func seek(to seconds: Double) {
        position = seconds
        player.seek(
            to: CMTime(seconds: seconds, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
    }
}
