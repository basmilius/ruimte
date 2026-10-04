import SwiftUI

/// Where a machine comes from: a machine is reached only through the account it is on, and only the machine itself
/// puts it there.
struct AddMachineSheet: View {
    let runtime: AppRuntime
    @Environment(\.dismiss) private var dismiss
    @State private var checking = false
    @ScaledMetric(relativeTo: .callout) private var iconSize = 30

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    Text("A machine on your account shows up here by itself. You put it there from the machine itself.")
                        .font(.subheadline).foregroundStyle(MobileStyle.muted)
                    VStack(alignment: .leading, spacing: 18) {
                        step("terminal", "On the machine, run `npx ruimte login`.")
                        step("monitor", "Or open the Ruimte app there and add it to your account.")
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 480, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 24)
                .padding(.vertical, 12)
            }
            .scrollBounceBehavior(.basedOnSize)
            .safeAreaInset(edge: .bottom) {
                Button(action: check) {
                    HStack(spacing: 8) {
                        if checking { ProgressView() }
                        Text("Check again")
                    }
                }
                .buttonStyle(SolidCapsuleButtonStyle())
                .disabled(checking)
                .frame(maxWidth: 480)
                .padding(.horizontal, 20)
                .padding(.bottom, 12)
            }
            .navigationTitle("Add a machine")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(role: .close) { dismiss() } }
            }
        }
    }

    private func step(_ icon: String, _ text: LocalizedStringKey) -> some View {
        HStack(spacing: 14) {
            Image(lucide: icon, size: 15)
                .frame(width: iconSize, height: iconSize)
                .background(MobileStyle.text.opacity(0.08), in: .circle)
                .accessibilityHidden(true)
            Text(text).font(.callout)
        }
    }

    private func check() {
        let known = runtime.machines.count
        checking = true
        Task {
            defer { checking = false }
            await runtime.refreshMachines()
            if runtime.machines.count > known { dismiss() }
        }
    }
}
