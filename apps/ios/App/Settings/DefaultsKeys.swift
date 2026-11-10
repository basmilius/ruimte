import SwiftUI

/// A `UserDefaults` entry with the value it reads as before a person sets it, so every screen that shows or changes
/// the setting agrees on both.
struct DefaultsKey<Value: Sendable>: Sendable {
    let name: String
    let fallback: Value
}

extension AppStorage {
    init(_ key: DefaultsKey<Value>) where Value == String {
        self.init(wrappedValue: key.fallback, key.name)
    }

    init(_ key: DefaultsKey<Value>) where Value == Bool {
        self.init(wrappedValue: key.fallback, key.name)
    }

    init(_ key: DefaultsKey<Value>) where Value == Double {
        self.init(wrappedValue: key.fallback, key.name)
    }

    init(_ key: DefaultsKey<Value>) where Value: RawRepresentable, Value.RawValue == String {
        self.init(wrappedValue: key.fallback, key.name)
    }
}

/// The settings more than one screen reads. A name here is stored on every install, so it never changes.
enum Settings {
    static let appearance = DefaultsKey(name: "ruimte.ios.appearance", fallback: "system")
    static let terminalFontSize = DefaultsKey(name: "ruimte.ios.terminalFontSize", fallback: 14.0)
    static let showHiddenFiles = DefaultsKey(name: "ruimte.ios.showHiddenFiles", fallback: false)
    static let chatStreaming = DefaultsKey(name: "ruimte.chat.streaming", fallback: ChatStreamingMode.words)
}

/// A machine's last project list, kept so the home screen draws before the machine answers.
enum ProjectsCache {
    static func key(machineID: String) -> String { "ruimte.ios.projects.\(machineID)" }

    /// Names the machine the list came from, so a machine that was replaced does not show the old one's projects.
    static func publicKeyKey(machineID: String) -> String { key(machineID: machineID) + ".publicKey" }
}
