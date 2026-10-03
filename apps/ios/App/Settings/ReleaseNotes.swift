import Foundation
import SwiftUI

/// What changed in this version, from `release-notes.json` in the app bundle, so the notes read the same offline.
/// The file names the version it was written for; a patch release without notes of its own keeps the last ones.
struct ReleaseNotes: Decodable, Equatable, Identifiable {
    struct Item: Decodable, Equatable, Identifiable {
        let icon: String
        let title: String
        let detail: String
        var id: String { title }
    }

    let version: String
    let items: [Item]
    var id: String { version }

    static func bundled(_ bundle: Bundle = .main) -> ReleaseNotes? {
        guard let url = bundle.url(forResource: "release-notes", withExtension: "json"),
            let data = try? Data(contentsOf: url)
        else { return nil }
        return try? JSONDecoder().decode(ReleaseNotes.self, from: data)
    }
}

/// Whether the notes show by themselves: once, at the first launch after an update from a version older than the
/// notes. A fresh install has nothing to compare with, and a build older than its notes never shows them.
enum ReleaseNotesGate {
    static let lastLaunchedKey = "ruimte.ios.lastLaunchedVersion"

    static func shouldShow(notes: String, app: String, lastLaunched: String?) -> Bool {
        guard let lastLaunched else { return false }
        return compare(lastLaunched, notes) == .orderedAscending && compare(notes, app) != .orderedDescending
    }

    /// Reads the version this phone last launched, records the running one and says whether to show the notes.
    static func check(notes: ReleaseNotes?, app: String, defaults: UserDefaults = .standard) -> Bool {
        let lastLaunched = defaults.string(forKey: lastLaunchedKey)
        defaults.set(app, forKey: lastLaunchedKey)
        guard let notes else { return false }
        return shouldShow(notes: notes.version, app: app, lastLaunched: lastLaunched)
    }

    /// Dotted versions compared number by number, a missing part counting as zero.
    static func compare(_ first: String, _ second: String) -> ComparisonResult {
        let one = numbers(first)
        let other = numbers(second)
        for index in 0..<max(one.count, other.count) {
            let left = index < one.count ? one[index] : 0
            let right = index < other.count ? other[index] : 0
            if left != right { return left < right ? .orderedAscending : .orderedDescending }
        }
        return .orderedSame
    }

    private static func numbers(_ version: String) -> [Int] {
        version.split(separator: ".").map { Int($0.prefix { $0.isNumber }) ?? 0 }
    }
}

struct AppVersion {
    static var marketing: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0" }
    static var build: String { Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0" }
}

/// The desktop's release notes dialog as a sheet: the light app icon, what is new and Continue.
struct ReleaseNotesSheet: View {
    let notes: ReleaseNotes
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 28) {
                    VStack(spacing: 6) {
                        AppIconImage(size: 76)
                        Text("Ruimte was updated").font(.title2.weight(.bold)).padding(.top, 10)
                        Text("Version \(notes.version)").font(.subheadline).foregroundStyle(MobileStyle.muted)
                    }
                    .padding(.top, 36)
                    .accessibilityElement(children: .combine)
                    VStack(alignment: .leading, spacing: 18) {
                        ForEach(notes.items) { item in
                            HStack(alignment: .top, spacing: 14) {
                                Image(lucide: item.icon, size: 18)
                                    .frame(width: 38, height: 38)
                                    .background(MobileStyle.active, in: .rect(cornerRadius: 10))
                                    .accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.title).font(.callout.weight(.semibold))
                                    Text(item.detail).font(.subheadline).foregroundStyle(MobileStyle.muted)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                    .padding(.horizontal, 8)
                }
                .padding(.horizontal, 24)
            }
            .scrollBounceBehavior(.basedOnSize)
            Button {
                dismiss()
            } label: {
                Text("Continue").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 8)
            }
            .buttonStyle(.glassProminent)
            .padding(.horizontal, 24)
            .padding(.bottom, 16)
            .accessibilityIdentifier("releaseNotes.continue")
        }
        .modifier(MobilePageSurface())
    }
}

/// The light app icon, the one every design shows whatever the appearance.
struct AppIconImage: View {
    let size: CGFloat

    var body: some View {
        Image("RuimteLogo")
            .renderingMode(.original)
            .resizable()
            .frame(width: size, height: size)
            .clipShape(.rect(cornerRadius: size * 0.235, style: .continuous))
            .shadow(color: .black.opacity(0.3), radius: 14, y: 8)
            .accessibilityHidden(true)
    }
}
