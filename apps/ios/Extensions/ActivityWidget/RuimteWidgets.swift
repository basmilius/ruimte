import SwiftUI
import WidgetKit

@main struct RuimteWidgets: WidgetBundle {
    var body: some Widget {
        RuimteActivityWidget()
        VoiceActivityWidget()
        UsageWidget()
        ClaudeUsageWidget()
        CodexUsageWidget()
        NeedsYouCountWidget()
        NeedsYouListWidget()
        ProjectWidget()
    }
}
