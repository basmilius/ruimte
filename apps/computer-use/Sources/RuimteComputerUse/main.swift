import AppKit
import ComputerUseCore

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let home = Home.resolve(
        explicit: Home.argument(in: CommandLine.arguments),
        environment: ProcessInfo.processInfo.environment,
        development: Home.isDevelopment(bundleIdentifier: Bundle.main.bundleIdentifier),
        userHome: NSHomeDirectory()
    )
    private var agent: Agent?
    private var server: SocketServer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let agent = Agent(home: home)
        let server = SocketServer(path: home.socketPath) { data in
            await agent.handle(data)
        }
        do {
            try server.start()
        } catch {
            NSLog("Ruimte Computer Use: \(error)")
            NSApp.terminate(nil)
            return
        }
        self.agent = agent
        self.server = server
    }

    func applicationWillTerminate(_ notification: Notification) {
        if server != nil {
            unlink(home.socketPath)
        }
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.accessory)
application.run()
