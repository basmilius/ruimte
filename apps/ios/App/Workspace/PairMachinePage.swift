import SwiftUI

/// Adding a machine with a pairing link, with the steps that find one on the computer. A link already on the clipboard
/// is filled in when the sheet opens.
struct PairMachinePage: View {
    let runtime: AppRuntime
    @Environment(\.dismiss) private var dismiss
    @State private var model = MachinePairing()
    @FocusState private var editing: Bool
    @ScaledMetric(relativeTo: .body) private var fieldHeight = 56
    @ScaledMetric(relativeTo: .footnote) private var stepSize = 30

    private static let steps = [
        "Open Ruimte on your computer.",
        "Go to Settings, Account, and choose Show pairing link. Or run `ruimte pair` in a terminal there.",
        "Copy the link and paste it below. It works once and expires after ten minutes.",
    ]

    private var subtitle: String {
        runtime.account == nil
            ? "Or sign in with the account your computer uses, and it shows up by itself."
            : "A computer on your account shows up by itself."
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 32) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Paste a pairing link")
                            .font(.title2.weight(.bold))
                            .accessibilityAddTraits(.isHeader)
                        Text(subtitle).font(.subheadline).foregroundStyle(MobileStyle.muted)
                    }
                    VStack(alignment: .leading, spacing: 18) {
                        ForEach(Array(Self.steps.enumerated()), id: \.offset) { index, step in
                            HStack(alignment: .firstTextBaseline, spacing: 14) {
                                Text("\(index + 1)")
                                    .font(.footnote.weight(.semibold))
                                    .frame(width: stepSize, height: stepSize)
                                    .background(MobileStyle.text.opacity(0.08), in: .circle)
                                Text(LocalizedStringKey(step)).font(.callout)
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 480, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 24)
                .padding(.top, 12)
                .padding(.bottom, 24)
            }
            .scrollBounceBehavior(.basedOnSize)
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .bottom) { linkBar }
            .navigationTitle("Add a machine")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .close) { dismiss() }.disabled(model.pairing)
                }
            }
            .interactiveDismissDisabled(model.pairing)
            .task { await model.readClipboard() }
        }
    }

    private var linkBar: some View {
        VStack(spacing: 12) {
            HStack(spacing: 10) {
                Image(lucide: "link", size: 17).foregroundStyle(MobileStyle.muted).accessibilityHidden(true)
                TextField("Paste a pairing link", text: $model.text)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .focused($editing)
                    .onSubmit(connect)
                    .disabled(model.pairing)
                    .accessibilityIdentifier("pairing.link")
                if model.text.isEmpty {
                    PasteButton(payloadType: String.self) { values in
                        if let value = values.first {
                            model.text = value.trimmingCharacters(in: .whitespacesAndNewlines)
                        }
                    }
                    .labelStyle(.iconOnly)
                    .buttonBorderShape(.circle)
                    .tint(MobileStyle.accent)
                } else if !model.pairing {
                    Button {
                        model.text = ""
                    } label: {
                        Image(lucide: "x", size: 15).foregroundStyle(MobileStyle.muted)
                            .frame(width: 32, height: 32).contentShape(.circle)
                    }
                    .accessibilityLabel("Clear")
                }
            }
            .padding(.leading, 18)
            .padding(.trailing, 10)
            .frame(minHeight: fieldHeight)
            .glassEffect(.regular.interactive(), in: .capsule)
            if model.canPair || model.pairing {
                Button(action: connect) {
                    HStack(spacing: 8) {
                        if model.pairing { ProgressView() }
                        Text(model.pairing ? "Connecting…" : "Connect")
                    }
                }
                .buttonStyle(SolidCapsuleButtonStyle())
                .disabled(model.pairing)
                .accessibilityIdentifier("pairing.connect")
            }
            footnote.font(.footnote).multilineTextAlignment(.center)
        }
        .frame(maxWidth: 480)
        .padding(.horizontal, 20)
        .padding(.bottom, 12)
    }

    @ViewBuilder private var footnote: some View {
        if let problem = model.problem {
            Text(problem).foregroundStyle(MobileStyle.statusError)
        } else if model.fromClipboard {
            Text("Ruimte found this link on the clipboard.").foregroundStyle(MobileStyle.muted)
        } else if !model.text.isEmpty && !model.canPair {
            Text("That is not a pairing link. One looks like https://…/pair#code.").foregroundStyle(MobileStyle.muted)
        } else if model.text.isEmpty {
            Text("Ruimte reads a link from the clipboard when you open this screen.").foregroundStyle(MobileStyle.faint)
        }
    }

    private func connect() {
        guard model.canPair else { return }
        editing = false
        Task {
            if await model.pair(runtime: runtime) { dismiss() }
        }
    }
}
