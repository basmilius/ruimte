import SwiftUI

/// The last step of the first run: what notifications bring, with an example of each, before the system asks. Either
/// answer ends the step, and the app opens on Now.
struct NotificationStepPage: View {
    @Bindable var coordinator: NotificationCoordinator
    let onboarding: Onboarding
    let machines: [String]

    private var activities: Bool { coordinator.supportsActivities }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 32) {
                VStack(alignment: .leading, spacing: 8) {
                    if let connected = Onboarding.connected(machines) {
                        Label(connected, lucideIcon: "check", iconSize: 14)
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(MobileStyle.positive)
                            .padding(.bottom, 8)
                    }
                    Text("Hear when an agent needs you")
                        .font(.title2.weight(.bold))
                        .accessibilityAddTraits(.isHeader)
                    Text(
                        activities
                            ? "Approve, answer or snooze straight from the notification. A Live Activity shows what is still running."
                            : "Approve, answer or snooze straight from the notification."
                    )
                    .font(.subheadline)
                    .foregroundStyle(MobileStyle.muted)
                }
                VStack(spacing: 8) {
                    ExampleNotification()
                    if activities {
                        ExampleActivity()
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Example: Claude wants to edit pool.ts in Recept Maker.")
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: 480, alignment: .leading)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 24)
            .padding(.top, 48)
            .padding(.bottom, 24)
        }
        .scrollBounceBehavior(.basedOnSize)
        .safeAreaInset(edge: .bottom) { actions }
        .background(MobileStyle.surface)
        .accessibilityIdentifier("onboarding.notifications")
    }

    private var actions: some View {
        VStack(spacing: 4) {
            Button(action: turnOn) {
                HStack(spacing: 8) {
                    if coordinator.busy {
                        ProgressView()
                    } else {
                        Image(lucide: "bell", size: 18).accessibilityHidden(true)
                    }
                    Text("Turn on notifications")
                }
            }
            .buttonStyle(SolidCapsuleButtonStyle())
            .disabled(coordinator.busy)
            .accessibilityIdentifier("onboarding.notifications.enable")
            Button("Not now") { onboarding.finish() }
                .font(.subheadline)
                .foregroundStyle(MobileStyle.muted)
                .frame(maxWidth: .infinity, minHeight: 44)
                .disabled(coordinator.busy)
                .accessibilityIdentifier("onboarding.notifications.skip")
        }
        .frame(maxWidth: 480)
        .padding(.horizontal, 20)
        .padding(.bottom, 8)
    }

    private func turnOn() {
        Task {
            await coordinator.enable()
            onboarding.finish()
        }
    }
}

private struct ExampleNotification: View {
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            AppIconImage(size: 38, lifted: false)
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text("Refactor reconnect loop").fontWeight(.semibold).lineLimit(1)
                    Spacer(minLength: 8)
                    Text("now", comment: "Time of a notification that just arrived")
                        .font(.caption).foregroundStyle(MobileStyle.faint)
                }
                Text("Claude wants to edit pool.ts in Recept Maker.").foregroundStyle(MobileStyle.text.opacity(0.8))
            }
            .font(.subheadline)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .modifier(ExampleCard())
    }
}

private struct ExampleActivity: View {
    var body: some View {
        HStack(spacing: 10) {
            AppIconImage(size: 22, lifted: false)
            Text("Ruimte").frame(maxWidth: .infinity, alignment: .leading)
            Text("1 needs you").fontWeight(.semibold).foregroundStyle(MobileStyle.statusNeedsYou)
            Text("3 working").fontWeight(.semibold).foregroundStyle(MobileStyle.statusRunning)
        }
        .font(.subheadline)
        .lineLimit(1)
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .modifier(ExampleCard())
    }
}

private struct ExampleCard: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(MobileStyle.panel, in: .rect(cornerRadius: 26))
            .overlay(RoundedRectangle(cornerRadius: 26).strokeBorder(MobileStyle.text.opacity(0.06)))
    }
}
