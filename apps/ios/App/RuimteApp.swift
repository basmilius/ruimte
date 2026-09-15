import SwiftUI

@main
struct RuimteApp: App {
    @State private var runtime = AppRuntime()

    var body: some Scene {
        WindowGroup {
            ConnectionScreen(runtime: runtime)
        }
    }
}
