import RuimteVoice

/// One row of the Voice sheet's timeline.
enum VoiceTimelineItem: Identifiable, Equatable {
    case line(VoiceUtterance)
    case action(VoiceActivityLine)
    /// The conversation ended; the timeline stays until the next start.
    case ended

    var id: String {
        switch self {
        case .line(let line): "line:\(line.id)"
        case .action(let action): "action:\(action.id)"
        case .ended: "ended"
        }
    }
}

/// What was said and what Voice did, in one timeline: each action under the Voice sentence that led to it.
enum VoiceTimeline {
    /// An action stands under the Voice line that was the last line when it came in. One that came in after a line of
    /// the person stands under Voice's answer to that line, or under the person's line while no answer followed. One
    /// from before every kept line stands at the top.
    static func items(lines: [VoiceUtterance], activity: [VoiceActivityLine], ended: Bool) -> [VoiceTimelineItem] {
        var placed: [Int: [VoiceActivityLine]] = [:]
        for action in activity {
            placed[place(action, in: lines), default: []].append(action)
        }
        var items = (placed[-1] ?? []).map(VoiceTimelineItem.action)
        for (index, line) in lines.enumerated() {
            items.append(.line(line))
            items += (placed[index] ?? []).map(VoiceTimelineItem.action)
        }
        if ended { items.append(.ended) }
        return items
    }

    /// The index of the line an action stands under, or -1 for the top.
    private static func place(_ action: VoiceActivityLine, in lines: [VoiceUtterance]) -> Int {
        guard let after = action.after, let last = lines.lastIndex(where: { $0.id <= after }) else { return -1 }
        if lines[last].speaker == .model { return last }
        return lines[(last + 1)...].firstIndex { $0.speaker == .model } ?? last
    }
}
