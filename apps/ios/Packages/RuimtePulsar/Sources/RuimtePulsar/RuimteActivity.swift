#if os(iOS) && canImport(ActivityKit)
    import ActivityKit

    extension PushActivityContent: Hashable {
        public func hash(into hasher: inout Hasher) {
            hasher.combine(title)
            hasher.combine(phase.rawValue)
            hasher.combine(startedAt)
            hasher.combine(runningCount)
            hasher.combine(attentionCount)
            for agent in agents ?? [] {
                hasher.combine(agent.nodeId)
                hasher.combine(agent.target.rawValue)
                hasher.combine(agent.title)
                hasher.combine(agent.phase.rawValue)
            }
        }
    }

    extension RuimteActivityAttributes: ActivityAttributes {
        public typealias ContentState = PushActivityContent
    }
#endif

extension PushActivityContentPhase {
    public static func chat(_ info: JSONValue) -> Self {
        switch info["status"]?.stringValue {
        case "needs-you": .needsYou
        case "running": .running
        default: .done
        }
    }
}
