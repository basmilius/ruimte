import Carbon.HIToolbox
import Foundation

/// ⌥Space and ⌥⎋ while a session runs. A registered hot key is taken out of the stream, so the app in front never
/// types a space or sees an Escape, and it needs no Accessibility grant, unlike a global key monitor.
@MainActor
final class Hotkeys {
    enum Action: UInt32 {
        case togglePause = 1
        case stop = 2
    }

    nonisolated private static let signature: OSType = 0x5275_696D
    private static var handler: ((Action) -> Void)?
    private static var installed = false
    private var references: [EventHotKeyRef] = []

    init(handler: @escaping (Action) -> Void) {
        Self.handler = handler
        Self.installHandler()
    }

    var isRegistered: Bool {
        !references.isEmpty
    }

    func register() {
        guard references.isEmpty else {
            return
        }
        let keys: [(UInt32, Action)] = [(UInt32(kVK_Space), .togglePause), (UInt32(kVK_Escape), .stop)]
        for (keyCode, action) in keys {
            var reference: EventHotKeyRef?
            let identifier = EventHotKeyID(signature: Self.signature, id: action.rawValue)
            if RegisterEventHotKey(keyCode, UInt32(optionKey), identifier, GetApplicationEventTarget(), 0, &reference) == noErr, let reference {
                references.append(reference)
            }
        }
    }

    func unregister() {
        for reference in references {
            UnregisterEventHotKey(reference)
        }
        references.removeAll()
    }

    private static func installHandler() {
        guard !installed else {
            return
        }
        installed = true
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, event, _ in
            var identifier = EventHotKeyID()
            let status = GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil, MemoryLayout<EventHotKeyID>.size, nil, &identifier)
            guard status == noErr, identifier.signature == Hotkeys.signature, let action = Action(rawValue: identifier.id) else {
                return OSStatus(eventNotHandledErr)
            }
            // Carbon delivers hot keys on the main thread's event loop.
            MainActor.assumeIsolated {
                Hotkeys.handler?(action)
            }
            return noErr
        }, 1, &spec, nil, nil)
    }
}
