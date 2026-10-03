import SwiftUI

/// The desktop's About: the light app icon in its orbit, the version, the links of the desktop's about section, the
/// licenses of what the app is built with and the notes of this version.
struct AboutPage: View {
    @State private var releaseNotes: ReleaseNotes?

    var body: some View {
        MobileForm {
            Section {
                VStack(spacing: 6) {
                    AppIconImage(size: 76)
                    Text("Ruimte").font(.title2.weight(.bold)).padding(.top, 10)
                    Text("Space for AI Engineering.").font(.subheadline).foregroundStyle(MobileStyle.muted)
                    Text("\(AppVersion.marketing) (\(AppVersion.build))")
                        .font(.caption.monospaced()).foregroundStyle(MobileStyle.faint).padding(.top, 4)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 24)
                .padding(.bottom, 20)
                .background(IconOrbit())
                .listRowBackground(Color.clear)
                .accessibilityElement(children: .combine)
            }
            Section {
                link("ruimte.app", icon: "globe", url: "https://ruimte.app")
                link("Source on GitHub", icon: "git-branch", url: "https://github.com/basmilius/ruimte")
                link(
                    "Report a problem", icon: "message-circle-question-mark",
                    url: "https://github.com/basmilius/ruimte/issues/new")
                NavigationLink {
                    LicensesPage()
                } label: {
                    Label("Licenses", lucideIcon: "file-text")
                }
                if let notes = ReleaseNotes.bundled() {
                    Button {
                        releaseNotes = notes
                    } label: {
                        Label("What's new in \(notes.version)", lucideIcon: "sparkles")
                    }
                    .foregroundStyle(MobileStyle.text)
                    .accessibilityIdentifier("about.releaseNotes")
                }
            } footer: {
                Text("Projects and sessions stay on your machines. This app connects to them remotely.")
            }
        }
        .navigationTitle("About")
        .navigationBarTitleDisplayMode(.inline)
        .mobileSheet(item: $releaseNotes) { ReleaseNotesSheet(notes: $0) }
    }

    private func link(_ title: String, icon: String, url: String) -> some View {
        Link(destination: URL(string: url)!) {
            Label(title, lucideIcon: icon).foregroundStyle(MobileStyle.text)
        }
    }
}

/// The licenses of the packages and scripts the app ships, from the text files in its bundle.
struct LicensesPage: View {
    private static let files = [
        ("Lucide-LICENSE", "Lucide icons"),
        ("package-licenses", "Packages"),
        ("document-renderer-licenses", "Drawing and diagram renderer"),
    ]

    var body: some View {
        MobileForm {
            ForEach(Self.files, id: \.0) { file, title in
                NavigationLink(title) {
                    LicenseText(title: title, text: Self.text(file))
                }
            }
        }
        .navigationTitle("Licenses")
        .navigationBarTitleDisplayMode(.inline)
    }

    private static func text(_ name: String) -> String {
        Bundle.main.url(forResource: name, withExtension: "txt").flatMap { try? String(contentsOf: $0, encoding: .utf8) }
            ?? "This license text is missing from the app."
    }
}

private struct LicenseText: View {
    let title: String
    let text: String

    var body: some View {
        ScrollView {
            Text(text)
                .font(.caption.monospaced())
                .foregroundStyle(MobileStyle.text)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(20)
        }
        .modifier(MobilePageSurface())
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}
