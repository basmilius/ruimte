import ActivityKit
import RuimtePulsar
import SwiftUI
import WidgetKit

/// Voice's Live Activity: that Voice is on while the app is out of sight, with Mute and Stop. A tap opens the sheet.
struct VoiceActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: VoiceLiveAttributes.self) { context in
            VoiceLiveCard(content: context.state, machine: context.attributes.machine)
                .padding(.horizontal, 16).padding(.vertical, 14)
                .activityBackgroundTint(VoiceLiveColors.tint)
                .activitySystemActionForegroundColor(.white)
                .widgetURL(VoiceLiveAttributes.url)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VoiceLiveGlyph(content: context.state, size: 20).frame(width: 28, height: 28)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VoiceLiveTimer(content: context.state).font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.white.opacity(0.8)).frame(maxWidth: 64).padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(spacing: 2) {
                        Text(VoiceLiveText.title(context.state)).font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(.white).lineLimit(1)
                        Text(VoiceLiveText.subtitle(context.state, machine: context.attributes.machine))
                            .font(.system(size: 12)).foregroundStyle(.white.opacity(0.55)).lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if context.state.phase != .ended {
                        VoiceLiveButtons(content: context.state, height: 38).padding(.top, 6)
                    }
                }
            } compactLeading: {
                VoiceLiveGlyph(content: context.state, size: 16).frame(width: 18, height: 18)
            } compactTrailing: {
                VoiceLiveTimer(content: context.state).font(.system(size: 12, weight: .medium))
                    .foregroundStyle(VoiceLiveColors.voice).frame(width: 44).padding(.trailing, 2)
            } minimal: {
                VoiceLiveGlyph(content: context.state, size: 16).frame(width: 18, height: 18)
            }
            .keylineTint(VoiceLiveColors.voice)
            .widgetURL(VoiceLiveAttributes.url)
        }
    }
}
