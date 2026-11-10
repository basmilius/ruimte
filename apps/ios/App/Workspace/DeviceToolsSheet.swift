import RuimtePulsar
import RuimteShared
import RuimteTransport
import SwiftUI
import UIKit

/// The tools of a device, with the sections of the desktop's tools panel; each shows only when the device
/// announces its tool.
struct DeviceToolsSheet: View {
    @State private var model: DeviceToolsModel
    @Environment(\.dismiss) private var dismiss
    @State private var appID = ""
    @State private var url = ""
    @State private var permission = "camera"
    @State private var push = String(localized: "Hello from Ruimte")
    @State private var battery = 50.0
    @State private var charging = false
    @State private var shared: DrawingShare?

    init(client: any MachineRequesting, device: DeviceInfo) {
        _model = State(initialValue: DeviceToolsModel(client: client, device: device))
    }

    private var app: String { appID.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var appPlaceholder: String {
        model.device.platform == .android ? String(localized: "Package name") : String(localized: "Bundle ID")
    }
    private var idle: Bool { !model.pending && model.settings != nil }

    var body: some View {
        NavigationStack {
            MobileForm {
                if let problem = model.problem {
                    Text(problem).foregroundStyle(MobileStyle.statusError)
                }
                if model.canCapture || model.canClipboard { captureSection }
                if DeviceTools.display.contains(where: model.has) { displaySection }
                if model.has("statusBar") || model.has("battery") { statusSection }
                if model.has("biometrics") { biometricSection }
                if model.has("location") || model.has("clearLocation") { locationSection }
                if DeviceTools.apps.contains(where: model.has) || model.has("permissions") || model.has("push") {
                    appSection
                }
            }
            .disabled(model.settings == nil)
            .navigationTitle("Device tools")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(role: .close) { dismiss() } }
                if model.pending { ToolbarItem(placement: .confirmationAction) { ProgressView() } }
            }
        }
        .presentationDetents([.medium, .large])
        .task { await model.load() }
        .sheet(item: $shared) { DrawingShareSheet(url: $0.url) }
    }

    private var captureSection: some View {
        Section {
            if model.canCapture {
                Button(String(localized: "Share screenshot"), lucideIcon: "share") {
                    Task { if let url = await model.capture() { shared = DrawingShare(url: url) } }
                }
            }
            if model.canClipboard {
                Button(String(localized: "Send my clipboard"), lucideIcon: "clipboard-paste") {
                    Task { await model.sendClipboard() }
                }
                Button(String(localized: "Copy the device's clipboard"), lucideIcon: "clipboard-copy") {
                    Task { await model.copyClipboard() }
                }
            }
        } header: {
            Text("Screen and clipboard")
        }
    }

    private var displaySection: some View {
        Section("Display") {
            if model.has("appearance") {
                Picker("Appearance", selection: choice("appearance", fallback: "light", action: "setAppearance")) {
                    Text("Light").tag("light")
                    Text("Dark").tag("dark")
                }
            }
            if model.has("textSize") {
                Picker("Text size", selection: choice("textSize", fallback: "default", action: "setTextSize")) {
                    ForEach(DeviceTools.textSizes, id: \.self) { Text(Self.textSizeName($0)).tag($0) }
                }
            }
            if model.has("liquidGlass") {
                Picker("Liquid Glass", selection: choice("liquidGlass", fallback: "clear", action: "setLiquidGlass")) {
                    Text("Clear").tag("clear")
                    Text("Tinted").tag("tinted")
                }
            }
            if model.has("colorFilter") {
                Picker("Color filter", selection: choice("colorFilter", fallback: "none", action: "setColorFilter")) {
                    ForEach(DeviceTools.colorFilters, id: \.self) { Text(Self.colorFilterName($0)).tag($0) }
                }
            }
            ForEach(DeviceTools.toggles.filter(model.has), id: \.self) { setting in
                Toggle(Self.toggleName(setting), isOn: toggle(setting)).disabled(model.settings?.toggle(setting) == nil)
            }
        }
    }

    private var statusSection: some View {
        Section("Status bar") {
            if model.has("statusBar") {
                Picker("Status bar", selection: choice("statusBar", fallback: "default", action: "setStatusBar")) {
                    Text("Clean").tag("clean")
                    Text("Default").tag("default")
                }
            }
            if model.has("battery") {
                LabeledContent("Battery", value: Format.number(battery.rounded()) + "%")
                Slider(value: $battery, in: 0...100, step: 5)
                Toggle("Charging", isOn: $charging)
                HStack {
                    Button("Set battery") {
                        Task {
                            await model.act(
                                "setBattery", ["level": .number(battery.rounded()), "charging": .bool(charging)])
                        }
                    }
                    Spacer()
                    Button("Reset") { Task { await model.act("resetBattery") } }
                }
                .buttonStyle(.mobileCapsuleSmall)
            }
        }
        .onChange(of: model.settings?.battery) { _, value in
            guard let value else { return }
            battery = Double(value.level)
            charging = value.charging
        }
    }

    private var biometricSection: some View {
        Section("Biometrics") {
            let ios = model.device.platform == .ios
            if ios {
                Toggle("Enrolled", isOn: enrolled)
            }
            ForEach(ios ? ["face", "finger"] : ["finger"], id: \.self) { sensor in
                HStack {
                    Text(sensor == "face" ? "Face ID" : ios ? "Touch ID" : String(localized: "Fingerprint"))
                    Spacer()
                    Button("Match") {
                        Task { await model.act("biometric", ["sensor": .string(sensor), "event": .string("match")]) }
                    }
                    Button("No match") {
                        Task { await model.act("biometric", ["sensor": .string(sensor), "event": .string("nomatch")]) }
                    }
                }
                .buttonStyle(.mobileCapsuleSmall)
            }
        }
    }

    private var locationSection: some View {
        Section("Location") {
            if model.has("location") {
                ForEach(DeviceTools.locations, id: \.name) { place in
                    Button(place.name) {
                        Task {
                            await model.act(
                                "setLocation",
                                ["latitude": .number(place.latitude), "longitude": .number(place.longitude)])
                        }
                    }
                }
            }
            if model.has("clearLocation") {
                Button("Clear location", role: .destructive) { Task { await model.act("clearLocation") } }
            }
        }
    }

    private var appSection: some View {
        Section {
            TextField(appPlaceholder, text: $appID)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
            if model.has("launchApp") || model.has("terminateApp") {
                HStack {
                    if model.has("launchApp") {
                        Button("Launch") { Task { await model.act("launchApp", ["appId": .string(app)]) } }
                    }
                    Spacer()
                    if model.has("terminateApp") {
                        Button("Terminate") { Task { await model.act("terminateApp", ["appId": .string(app)]) } }
                    }
                }
                .buttonStyle(.mobileCapsuleSmall).disabled(app.isEmpty || !idle)
            }
            if model.has("permissions") {
                Picker("Permission", selection: $permission) {
                    ForEach(DeviceTools.permissions(model.device), id: \.self) { Text(Self.permissionName($0)).tag($0) }
                }
                HStack {
                    ForEach(WireVocabulary.devicePermissionDecisions, id: \.self) { decision in
                        Button(Self.decisionName(decision)) {
                            Task {
                                await model.act(
                                    "setPermission",
                                    [
                                        "appId": .string(app), "permission": .string(permission),
                                        "decision": .string(decision),
                                    ])
                            }
                        }
                        if decision != "reset" { Spacer() }
                    }
                }
                .buttonStyle(.mobileCapsuleSmall).disabled(app.isEmpty || !idle)
            }
            if model.has("push") {
                TextField("Notification text", text: $push)
                Button("Send push") {
                    Task { await model.act("sendPush", ["appId": .string(app), "payload": .string(push)]) }
                }
                .disabled(app.isEmpty || push.isEmpty || !idle)
            }
            if model.has("openUrl") {
                TextField("https://", text: $url)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                Button("Open link") { Task { await model.act("openUrl", ["url": .string(url)]) } }
                    .disabled(url.trimmingCharacters(in: .whitespaces).isEmpty || !idle)
            }
        } header: {
            Text("Apps")
        }
    }

    private func choice(_ key: String, fallback: String, action: String) -> Binding<String> {
        Binding(
            get: { model.settings?.choice(key) ?? fallback },
            set: { value in Task { await model.act(action, ["value": .string(value)]) } })
    }

    private func toggle(_ setting: String) -> Binding<Bool> {
        Binding(
            get: { model.settings?.toggle(setting) ?? false },
            set: { value in Task { await model.act("setToggle", ["setting": .string(setting), "value": .bool(value)]) }
            })
    }

    private var enrolled: Binding<Bool> {
        Binding(
            get: { model.settings?.toggle("biometricEnrolled") ?? false },
            set: { value in
                Task {
                    await model.act(
                        "biometric", ["sensor": .string("face"), "event": .string(value ? "enroll" : "unenroll")])
                }
            })
    }

    static func textSizeName(_ size: String) -> String {
        switch size {
        case "small": String(localized: "Small", comment: "A text size of a device")
        case "large": String(localized: "Large", comment: "A text size of a device")
        case "extra-large": String(localized: "Extra large", comment: "A text size of a device")
        default: String(localized: "Default", comment: "A text size of a device")
        }
    }

    static func colorFilterName(_ filter: String) -> String {
        switch filter {
        case "grayscale": String(localized: "Grayscale")
        case "red-green": String(localized: "Red/green")
        case "green-red": String(localized: "Green/red")
        case "blue-yellow": String(localized: "Blue/yellow")
        default: String(localized: "None", comment: "No color filter on a device")
        }
    }

    static func toggleName(_ setting: String) -> String {
        switch setting {
        case "reduceMotion": String(localized: "Reduce motion")
        case "increaseContrast": String(localized: "Increase contrast")
        case "reduceTransparency": String(localized: "Reduce transparency")
        case "showBorders": String(localized: "Show borders")
        default: "VoiceOver"
        }
    }

    static func permissionName(_ permission: String) -> String {
        switch permission {
        case "camera": String(localized: "Camera", comment: "A permission of an app on a device")
        case "microphone": String(localized: "Microphone", comment: "A permission of an app on a device")
        case "photos": String(localized: "Photos", comment: "A permission of an app on a device")
        case "contacts": String(localized: "Contacts", comment: "A permission of an app on a device")
        case "calendar": String(localized: "Calendar", comment: "A permission of an app on a device")
        case "reminders": String(localized: "Reminders", comment: "A permission of an app on a device")
        case "location": String(localized: "Location", comment: "A permission of an app on a device")
        case "motion": String(localized: "Motion", comment: "A permission of an app on a device")
        case "media-library": String(localized: "Media library", comment: "A permission of an app on a device")
        default: "Face ID"
        }
    }

    static func decisionName(_ decision: String) -> String {
        switch decision {
        case "grant": String(localized: "Grant", comment: "Grant a permission to an app on a device")
        case "revoke": String(localized: "Revoke", comment: "Revoke a permission of an app on a device")
        default: String(localized: "Reset", comment: "Reset a permission of an app on a device")
        }
    }
}

/// Takes a hardware keyboard's keys while a device's screen shows and hands them to the device; touches pass
/// through to the screen beneath.
struct DeviceKeyCatcher: UIViewRepresentable {
    let model: DeviceViewModel

    func makeUIView(context: Context) -> DeviceKeyView {
        let view = DeviceKeyView()
        view.model = model
        return view
    }

    func updateUIView(_ view: DeviceKeyView, context: Context) {
        view.model = model
    }
}

final class DeviceKeyView: UIView {
    weak var model: DeviceViewModel?
    /// The keys sent down, so each gets its up even when the chord changed in between.
    private var held: Set<Int> = []

    override var canBecomeFirstResponder: Bool { true }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil { becomeFirstResponder() }
    }

    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool { false }

    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        var unhandled: Set<UIPress> = []
        for press in presses {
            guard let key = press.key, let model else {
                unhandled.insert(press)
                continue
            }
            switch DeviceKeys.route(usage: key.keyCode.rawValue, command: key.modifierFlags.contains(.command)) {
            case .key(let usage):
                held.insert(usage)
                model.key("down", usage: usage)
            case .paste:
                model.paste()
            case .pass:
                unhandled.insert(press)
            }
        }
        if !unhandled.isEmpty { super.pressesBegan(unhandled, with: event) }
    }

    override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        release(presses, with: event) { super.pressesEnded($0, with: $1) }
    }

    override func pressesCancelled(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        release(presses, with: event) { super.pressesCancelled($0, with: $1) }
    }

    private func release(
        _ presses: Set<UIPress>, with event: UIPressesEvent?, passing: (Set<UIPress>, UIPressesEvent?) -> Void
    ) {
        var unhandled: Set<UIPress> = []
        for press in presses {
            guard let usage = press.key?.keyCode.rawValue, held.remove(usage) != nil else {
                unhandled.insert(press)
                continue
            }
            model?.key("up", usage: usage)
        }
        if !unhandled.isEmpty { passing(unhandled, event) }
    }
}
