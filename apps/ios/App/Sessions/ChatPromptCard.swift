import RuimtePulsar
import SwiftUI

struct ChatPromptCard: View {
    @Bindable var prompts: ChatPromptState
    let item: JSONValue
    let connected: Bool
    let hasDraft: Bool
    let denyReason: Bool
    let availableHeight: CGFloat
    let perform: @MainActor (String, [String: JSONValue]) async throws -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @FocusState private var answerFocused: Bool
    @FocusState private var reasonFocused: Bool
    @State private var showingFullDiff = false
    @State private var contentHeight: CGFloat = 0
    @State private var actionsHeight: CGFloat = 44

    private var isApproval: Bool { item.text("kind") == "approval" }
    private var questions: [JSONValue] { item.list("questions") }
    private var question: JSONValue {
        questions.isEmpty ? .null : questions[min(prompts.draft.index, questions.count - 1)]
    }
    private var answer: ChatPromptAnswer {
        get { prompts.draft.answers[question.text("id")] ?? ChatPromptAnswer(custom: question.list("choices").isEmpty) }
        nonmutating set { prompts.draft.answers[question.text("id")] = newValue }
    }
    private var sending: Bool { prompts.sendingID != nil }
    private var changes: [ChatFileChange] {
        ChatFileChanges.grouped(
            ChatFileChanges.fromTool(
                .object([
                    "name": item["toolName"] ?? .null, "input": item["input"] ?? .null,
                    "changes": item["input"]?["changes"] ?? .array([]),
                ])))
    }
    private var title: String {
        guard isApproval else { return question.text("question") }
        if let first = changes.first {
            return changes.count == 1
                ? "Edit \((first.path as NSString).lastPathComponent)" : "Edit \(changes.count) files"
        }
        return item.text("toolName") == "Bash" ? "Run command" : item.text("toolName")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                header
                if isApproval { approvalContent } else { questionContent }
                if let error = prompts.error {
                    Text(error).font(.subheadline).foregroundStyle(MobileStyle.statusError)
                        .accessibilityLabel("Could not send. \(error)")
                }
                if !connected {
                    Label("Not connected", lucideIcon: "wifi-off").font(.caption).foregroundStyle(MobileStyle.muted)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            .onGeometryChange(for: CGFloat.self) {
                $0.size.height
            } action: {
                contentHeight = $0
            }
            .padding(.horizontal, 16).padding(.top, 16)
        }
        .scrollBounceBehavior(.basedOnSize)
        .safeAreaBar(edge: .bottom, spacing: 0) {
            actions
                .fixedSize(horizontal: false, vertical: true)
                .onGeometryChange(for: CGFloat.self) {
                    $0.size.height
                } action: {
                    actionsHeight = $0
                }
                .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 16)
        }
        .scrollEdgeEffectStyle(.soft, for: .bottom)
        .frame(minHeight: 0, idealHeight: bodyHeight + actionsHeight + 44, maxHeight: bodyHeight + actionsHeight + 44)
        .preference(
            key: ChatPromptHeightKey.self,
            value: contentHeight > 0
                ? ChatPromptHeight(requestID: item.text("requestId"), height: bodyHeight + actionsHeight + 44) : nil
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("chat.prompt")
        .mobileSheet(isPresented: $showingFullDiff) {
            NavigationStack {
                ScrollView { diffContent.padding() }
                    .navigationTitle("Changes in this request")
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) { Button("Done") { showingFullDiff = false } }
                    }
            }
        }
    }

    private var bodyHeight: CGFloat {
        min(contentHeight, max(120, availableHeight * (dynamicTypeSize.isAccessibilitySize ? 0.68 : 0.5)))
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                Image(lucide: isApproval ? "hand" : "message-circle-question-mark")
                    .foregroundStyle(MobileStyle.statusNeedsYou).accessibilityHidden(true)
                Text(title).font(.subheadline.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            HStack(spacing: 8) {
                if prompts.pending.count > 1 { Text("\(prompts.pending.count) requests waiting").monospacedDigit() }
                if questions.count > 1 {
                    Text("Question \(prompts.draft.index + 1) of \(questions.count)").monospacedDigit()
                }
                if hasDraft { Text("Draft saved") }
            }
            .font(.caption).foregroundStyle(MobileStyle.muted)
        }
    }

    private var approvalContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let description = item["description"]?.stringValue, !description.isEmpty {
                Text(description).font(.subheadline).foregroundStyle(MobileStyle.muted)
            }
            if !changes.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    let first = changes[0]
                    diffHeader(first)
                    ChatDiffView(diff: first.diff.components(separatedBy: "\n").prefix(8).joined(separator: "\n"))
                    if changes.count > 1 {
                        Text("Allow applies to all \(changes.count) files.").font(.caption).padding(.horizontal, 12)
                    }
                    Button("View full diff") { showingFullDiff = true }
                        .font(.caption).frame(minHeight: 44).padding(.horizontal, 12)
                }
                .padding(.vertical, 10).background(MobileStyle.inset, in: RoundedRectangle(cornerRadius: 12))
            } else if let command = item["input"]?["command"]?.stringValue {
                VStack(alignment: .leading, spacing: 8) {
                    if let cwd = item["input"]?["cwd"]?.stringValue {
                        Text(cwd).font(.caption).foregroundStyle(MobileStyle.muted)
                    }
                    Text(command).font(.system(.subheadline, design: .monospaced)).textSelection(.enabled)
                }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(MobileStyle.inset, in: RoundedRectangle(cornerRadius: 12))
            } else {
                DisclosureGroup("Details", isExpanded: $prompts.draft.expanded) {
                    if let data = try? (item["input"] ?? .null).encoded(),
                        let text = String(data: data, encoding: .utf8)
                    {
                        Text(text).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                    }
                }.font(.subheadline)
            }
            if denyReason {
                if prompts.draft.showingReason {
                    TextField("Reason for declining, optional", text: $prompts.draft.denialReason, axis: .vertical)
                        .lineLimit(2...6).focused($reasonFocused)
                        .onAppear { reasonFocused = true }
                        .font(.subheadline).padding(12).background(
                            MobileStyle.inset, in: RoundedRectangle(cornerRadius: 12))
                } else {
                    Button("Add a reason") { prompts.draft.showingReason = true }
                        .font(.caption).frame(minHeight: 44)
                }
            }
            if item["canAllowAlways"]?.boolValue == true, let rule = item["allowAlways"] {
                Text(rule.text("description")).font(.caption).foregroundStyle(MobileStyle.muted)
            }
        }
    }

    private var questionContent: some View {
        VStack(alignment: .leading, spacing: 8) {
            if question["multiSelect"]?.boolValue == true {
                Text("Choose one or more").font(.caption).foregroundStyle(MobileStyle.muted)
            }
            ForEach(Array(question.list("choices").enumerated()), id: \.offset) { _, choice in
                let selected = !answer.custom && answer.choices.contains(choice.text("label"))
                Button {
                    var next = answer
                    next.custom = false
                    let label = choice.text("label")
                    if question["multiSelect"]?.boolValue == true {
                        if next.choices.contains(label) {
                            next.choices.removeAll { $0 == label }
                        } else {
                            next.choices.append(label)
                        }
                    } else {
                        next.choices = [label]
                    }
                    answer = next
                    answerFocused = false
                } label: {
                    option(choice.text("label"), description: choice.text("description"), selected: selected)
                }
                .buttonStyle(.plain).accessibilityAddTraits(selected ? .isSelected : [])
            }
            if !question.list("choices").isEmpty {
                HStack(alignment: .top, spacing: 10) {
                    Image(lucide: answer.custom ? "circle-check" : "circle")
                        .foregroundStyle(answer.custom ? MobileStyle.accent : MobileStyle.muted)
                        .accessibilityHidden(true)
                    TextField(
                        "Something else…",
                        text: Binding(
                            get: { answer.text },
                            set: {
                                answer.text = $0
                                answer.custom = true
                            }),
                        axis: .vertical
                    )
                    .font(.subheadline).lineLimit(1...6).focused($answerFocused)
                    .accessibilityLabel("Your answer")
                    .accessibilityAddTraits(answer.custom ? .isSelected : [])
                    .onChange(of: answerFocused) { _, focused in
                        if focused { answer.custom = true }
                    }
                }
                .padding(.horizontal, 12).padding(.vertical, 10)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .background(
                    answer.custom ? MobileStyle.active : MobileStyle.hover, in: RoundedRectangle(cornerRadius: 12)
                )
                .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(answer.custom ? MobileStyle.muted : .clear) }
                .contentShape(RoundedRectangle(cornerRadius: 12))
                .onTapGesture {
                    answer.custom = true
                    answerFocused = true
                }
            } else {
                TextField(
                    "Your answer", text: Binding(get: { answer.text }, set: { answer.text = $0 }), axis: .vertical
                )
                .lineLimit(2...6).focused($answerFocused)
                .padding(12).background(MobileStyle.inset, in: RoundedRectangle(cornerRadius: 12))
            }
        }.disabled(sending)
    }

    private func option(_ label: String, description: String, selected: Bool) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(lucide: selected ? "circle-check" : question["multiSelect"]?.boolValue == true ? "square" : "circle")
                .foregroundStyle(selected ? MobileStyle.accent : MobileStyle.muted).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.subheadline)
                if !description.isEmpty { Text(description).font(.caption).foregroundStyle(MobileStyle.muted) }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12).padding(.vertical, 10).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .background(selected ? MobileStyle.active : MobileStyle.hover, in: RoundedRectangle(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(selected ? MobileStyle.muted : .clear) }
        .contentShape(RoundedRectangle(cornerRadius: 12))
    }

    private var actions: some View {
        let layout =
            dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(spacing: 12))
        return layout {
            if isApproval {
                Button("Deny") { approve("deny") }.frame(minHeight: 44).disabled(sending || !connected)
                if item["canAllowAlways"]?.boolValue == true, let rule = item["allowAlways"] {
                    Button(rule.text("label")) { approve("allow-always") }
                        .frame(minHeight: 44).disabled(sending || !connected)
                        .accessibilityHint(rule.text("description"))
                }
                if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 0) }
                primary("Allow", icon: "check") { approve("allow") }
            } else {
                if prompts.draft.index > 0 {
                    Button("Previous") { prompts.draft.index -= 1 }.frame(minHeight: 44).disabled(sending)
                } else if item["async"]?.boolValue == true {
                    Button("Dismiss") { submit("chat.dismiss", ["itemId": item["id"] ?? .null]) }
                        .frame(minHeight: 44).disabled(sending || !connected)
                }
                if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 0) }
                primary(
                    prompts.draft.index == questions.count - 1 ? "Answer" : "Next", icon: "arrow-up",
                    enabled: !answer.value.isEmpty
                ) {
                    answerFocused = false
                    if prompts.draft.index < questions.count - 1 {
                        prompts.draft.index += 1
                    } else {
                        var answers: [String: JSONValue] = [:]
                        for question in questions {
                            guard let value = prompts.draft.answers[question.text("id")]?.value, !value.isEmpty else {
                                return
                            }
                            answers[question.text("id")] = .string(value)
                        }
                        submit("chat.answer", ["requestId": item["requestId"] ?? .null, "answers": .object(answers)])
                    }
                }
            }
        }.font(.subheadline)
    }

    private func primary(_ label: String, icon: String, enabled: Bool = true, action: @escaping () -> Void) -> some View
    {
        HStack(spacing: 6) {
            if sending { ProgressView().tint(MobileStyle.onAccent) } else { Image(lucide: icon, size: 16) }
            Text(sending ? "Sending…" : label)
        }
        .font(.subheadline.weight(.semibold)).padding(.horizontal, 16).frame(minHeight: 44)
        .modifier(
            ChatComposerAction(
                prompt: true, icon: icon, title: sending ? "Sending…" : label, loading: sending,
                opacity: sending || !connected || !enabled ? 0.5 : 1,
                enabled: !sending && connected && enabled, perform: action)
        )
        .allowsHitTesting(false).accessibilityHidden(true)
    }

    private var diffContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(changes) { change in
                VStack(alignment: .leading, spacing: 8) {
                    diffHeader(change)
                    ChatDiffView(diff: change.diff)
                }
            }
        }
    }
    private func diffHeader(_ change: ChatFileChange) -> some View {
        HStack(alignment: .top) {
            Text(change.path).textSelection(.enabled)
            Spacer(minLength: 8)
            Text("+\(change.added)").foregroundStyle(MobileStyle.positive)
            Text("-\(change.deleted)").foregroundStyle(MobileStyle.statusError)
        }.font(.system(.caption, design: .monospaced)).padding(.horizontal, 12)
    }
    private func approve(_ decision: String) {
        var values: [String: JSONValue] = ["requestId": item["requestId"] ?? .null, "decision": .string(decision)]
        if decision == "deny", !prompts.draft.denialReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            values["message"] = .string(prompts.draft.denialReason)
        }
        submit("chat.approve", values)
    }
    private func submit(_ action: String, _ values: [String: JSONValue]) {
        Task {
            await prompts.submit(item, connected: connected) {
                try await perform(action, values)
            }
        }
    }
}
