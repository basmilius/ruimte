import Foundation
import RuimtePulsar

#if canImport(UIKit)
    import UIKit
#endif

/// What this app tells a machine of itself in `endpoint.info`, the counterpart of `clientIdentity` in the desktop
/// client. `client` is the kind the machine's anonymous usage counts; the rest is only shown in its list of connected
/// clients. A machine from before the list ignores those fields.
public struct ClientIdentity: Equatable, Sendable {
    public var version: String?
    public var os: String?
    public var osVersion: String?
    public var device: String?

    public init(version: String? = nil, os: String? = nil, osVersion: String? = nil, device: String? = nil) {
        self.version = version
        self.os = os
        self.osVersion = osVersion
        self.device = device
    }

    /// This app on this device; the package also builds for macOS tests, where only the version is known.
    @MainActor public static var current: ClientIdentity {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        #if canImport(UIKit)
            let device = UIDevice.current
            let tablet = device.userInterfaceIdiom == .pad
            return ClientIdentity(
                version: version, os: tablet ? "ipados" : "ios", osVersion: device.systemVersion,
                device: tablet ? "tablet" : "phone")
        #else
            return ClientIdentity(version: version)
        #endif
    }

    var payload: JSONValue {
        // This app keeps what a newer machine sends that it does not know in its place (`WireSchema`).
        var fields: [String: JSONValue] = ["client": .string("ios"), "clientFeatures": .array([.string("tolerantWire")])]
        for (key, value) in [
            ("clientVersion", version), ("clientOs", os), ("clientOsVersion", osVersion), ("clientDevice", device),
        ] {
            if let value, !value.isEmpty { fields[key] = .string(value) }
        }
        return .object(fields)
    }
}
