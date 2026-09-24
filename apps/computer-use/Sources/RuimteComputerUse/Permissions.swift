import AppKit
import ApplicationServices
import ComputerUseCore
import CoreGraphics

@MainActor
enum Permissions {
    private static let accessibilityPane = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
    private static let screenRecordingPane = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"

    static var appPath: String {
        Bundle.main.bundleURL.path
    }

    static var appName: String {
        Bundle.main.bundleURL.deletingPathExtension().lastPathComponent
    }

    static func requireAccessibility() throws {
        guard AXIsProcessTrusted() else {
            throw AgentError("Accessibility is not granted to \(appName). Run `cu doctor` and follow its steps.")
        }
    }

    static func doctor(prompt: Bool) -> [String: Any] {
        let accessibility = AXIsProcessTrusted()
        let screenRecording = CGPreflightScreenCaptureAccess()
        var steps: [String] = []
        var prompted: [String] = []

        if !accessibility {
            steps.append("Open System Settings > Privacy & Security > Accessibility and turn on \"\(appName)\" (\(appPath)). If it is not in the list, click +, choose that app and turn it on.")
            if prompt {
                // The literal key: the imported kAXTrustedCheckOptionPrompt global is not concurrency-safe in Swift 6.
                AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
                prompted.append("accessibility prompt")
            }
        }
        if !screenRecording {
            steps.append("Open System Settings > Privacy & Security > Screen & System Audio Recording and turn on \"\(appName)\" (\(appPath)). If it is not in the list, click +, choose that app and turn it on.")
            steps.append("After granting Screen Recording, run `cu quit`; macOS only applies it to a fresh launch, and the next cu command starts the agent again.")
            if prompt {
                CGRequestScreenCaptureAccess()
                prompted.append("screen recording prompt")
            }
        }
        if prompt, let pane = !accessibility ? accessibilityPane : (!screenRecording ? screenRecordingPane : nil), let url = URL(string: pane) {
            NSWorkspace.shared.open(url)
            prompted.append(!accessibility ? "opened the Accessibility pane" : "opened the Screen Recording pane")
        }

        var result: [String: Any] = [
            "agent": [
                "app": appPath,
                "bundleId": Bundle.main.bundleIdentifier ?? "",
                "pid": Int(ProcessInfo.processInfo.processIdentifier),
            ],
            "accessibility": ["granted": accessibility, "neededFor": "state, click, type, key, set-value and the Esc stop"],
            "screenRecording": ["granted": screenRecording, "neededFor": "the window screenshot in state and clicks by --x/--y"],
            "ready": accessibility && screenRecording,
        ]
        if !steps.isEmpty {
            result["steps"] = steps
        }
        if !prompted.isEmpty {
            result["prompted"] = prompted
        }
        return result
    }
}
