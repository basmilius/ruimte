import Foundation

/// The `$RUIMTE_HOME` the helper serves, and where its files sit inside it.
public struct Home: Sendable, Equatable {
    public static let releaseBundleIdentifier = "app.ruimte.computer-use"
    public static let developmentBundleIdentifier = "app.ruimte.computer-use.dev"

    public let path: String

    public init(path: String) {
        self.path = URL(fileURLWithPath: path).standardizedFileURL.path
    }

    public var directory: String {
        path + "/computer-use"
    }

    public var socketPath: String {
        directory + "/agent.sock"
    }

    public var secretPath: String {
        path + "/local.key"
    }

    /// Written by the daemon, so the pill speaks the language of the interface.
    public var overlayConfigPath: String {
        directory + "/overlay.json"
    }

    public var screenshotDirectory: String {
        directory + "/screenshots"
    }

    public static func isDevelopment(bundleIdentifier: String?) -> Bool {
        bundleIdentifier == developmentBundleIdentifier
    }

    /// An explicit path wins, then `RUIMTE_HOME`, then the default of the daemon this build pairs with:
    /// `~/.ruimte` for an installed Ruimte, `~/.ruimte-dev` for a checkout.
    public static func resolve(explicit: String?, environment: [String: String], development: Bool, userHome: String) -> Home {
        if let explicit, !explicit.isEmpty {
            return Home(path: explicit)
        }
        if let fromEnvironment = environment["RUIMTE_HOME"], !fromEnvironment.isEmpty {
            return Home(path: fromEnvironment)
        }
        return Home(path: userHome + (development ? "/.ruimte-dev" : "/.ruimte"))
    }

    /// The value after `--home` or in `--home=<dir>`; `open` may add arguments of its own around it.
    public static func argument(in arguments: [String]) -> String? {
        for (index, argument) in arguments.enumerated() {
            if argument == "--home", index + 1 < arguments.count {
                return arguments[index + 1]
            }
            if argument.hasPrefix("--home=") {
                return String(argument.dropFirst("--home=".count))
            }
        }
        return nil
    }
}
