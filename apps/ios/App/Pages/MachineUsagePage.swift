import Charts
import RuimtePulsar
import RuimteTransport
import SwiftUI

struct MachineUsagePage: View {
    let client: any MachineRequesting
    @State private var state = RemotePageState()
    @State private var limits: JSONValue?
    @State private var accounts: ProviderAccountList?
    @State private var days = 7
    @Environment(\.locale) private var locale
    private var models: [JSONValue] { state.value?.list("models") ?? [] }
    private var buckets: [JSONValue] { state.value?.list("buckets") ?? [] }
    private var money: UsageMoneyFormatter { UsageMoneyFormatter(locale: locale, rate: state.value?["rate"]) }
    var body: some View {
        VStack(spacing: 0) {
            Picker("Period", selection: $days) {
                Text("Week").tag(7)
                Text("Month").tag(30)
            }.pickerStyle(.segmented)
                .padding(.horizontal, 20)
                .padding(.top, 8)
            usageList
        }
        .navigationTitle("Usage")
        .task(id: days) {
            await RemotePageLifecycle.run(
                client: client, events: ["usage.changed", "usage.limitsChanged", "providers.changed"],
                subscription: {
                    client.acquireSubscription(
                        start: "usage.subscribe", stop: "usage.unsubscribe", payload: .object([:]),
                        stopPayload: .object([:]))
                }, load: load)
        }
    }

    private var usageList: some View {
        MobileList {
            RemotePageStatus(state: state) { Task { await load() } }
            if let value = state.value {
                Section("Overview") {
                    LabeledContent("Sessions", value: Int(value.number("sessions")).formatted())
                    LabeledContent(
                        "Known cost",
                        value: money.string(usd: models.reduce(0) { $0 + $1.number("costUsd") }))
                    if let explanation = money.explanation {
                        Text(explanation).font(.caption).foregroundStyle(MobileStyle.muted)
                    }
                    if models.contains(where: { $0["costUsd"] == .null }) {
                        Text("Some models have no known price and are excluded from the total.").font(.caption)
                            .foregroundStyle(MobileStyle.muted)
                    }
                    if value["scan"]?["failed"] == .bool(true) {
                        Text("The latest usage scan failed. These are the last available totals.").foregroundStyle(
                            .orange)
                    }
                }
                if !buckets.isEmpty {
                    Section("Daily cost") {
                        Chart(Array(buckets.enumerated()), id: \.offset) { item in
                            BarMark(
                                x: .value("Day", item.element.text("slot")),
                                y: .value(money.currencyCode, money.amount(usd: item.element.number("costUsd")))
                            )
                            .foregroundStyle(by: .value("Provider", item.element.text("provider")))
                        }
                        .chartYAxis {
                            AxisMarks { value in
                                AxisGridLine()
                                AxisTick()
                                AxisValueLabel {
                                    if let amount = value.as(Double.self) { Text(money.string(amount: amount)) }
                                }
                            }
                        }
                        .frame(height: 200)
                        .accessibilityLabel(
                            money.currencyCode == "EUR" ? "Daily usage cost in euros" : "Daily usage cost in US dollars"
                        )
                    }
                }
                Section("Models") {
                    ForEach(Array(models.enumerated()), id: \.offset) { item in
                        let model = item.element
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(ModelName.fromSlug(model.text("model"))).font(.headline)
                                Spacer()
                                Text(
                                    model["costUsd"]?.numberValue.map { money.string(usd: $0) }
                                        ?? "Unknown cost")
                            }
                            Text(
                                "\(model.text("provider")) · \(Int(model["totals"]?.number("calls") ?? 0).formatted()) calls"
                            ).font(.caption).foregroundStyle(MobileStyle.muted)
                        }.monospacedDigit().padding(.vertical, 4)
                    }
                    if models.isEmpty { Text("No usage in this period.").foregroundStyle(MobileStyle.muted) }
                }
            }
            ForEach(UsageLimitSection.sections(limits: limits, accounts: accounts)) { section in
                Section {
                    limitRows(section)
                } header: {
                    HStack(spacing: 6) {
                        if section.named { AccountDot(color: section.color) }
                        Text(section.title)
                    }
                }
            }
        }
        .refreshable { await load() }
    }
    @ViewBuilder private func limitRows(_ section: UsageLimitSection) -> some View {
        switch section.quiet {
        case .signedOut:
            Text("Not logged in. Log in on the machine to see its limits.").foregroundStyle(MobileStyle.muted)
        case .notRead(let message):
            Text(message ?? "Not read yet. Its limits appear once the machine has read them.")
                .foregroundStyle(MobileStyle.muted)
        case nil:
            if let provider = section.entry {
                if let plan = provider["plan"]?.stringValue { Text(plan).font(.headline) }
                if let unavailable = provider["unavailable"], unavailable != .null {
                    Text(unavailable.text("message", fallback: unavailable.text("reason"))).foregroundStyle(
                        .secondary)
                }
                ForEach(provider.list("windows"), id: \.stableID) { window in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(window.text("label"))
                            Spacer()
                            Text(window.number("used").formatted(.percent.precision(.fractionLength(0))))
                                .monospacedDigit()
                        }
                        ProgressView(value: window.number("used"))
                        if let resets = window["resetsAt"]?.numberValue {
                            Text("Resets \(Date(timeIntervalSince1970: resets / 1000), style: .relative)").font(
                                .caption
                            ).foregroundStyle(MobileStyle.muted)
                        }
                    }.padding(.vertical, 4)
                }
            }
        }
    }

    private func load() async {
        await state.load {
            let formatter = DateFormatter()
            formatter.calendar = Calendar(identifier: .gregorian)
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = .current
            formatter.dateFormat = "yyyy-MM-dd"
            let now = Date()
            let from = Calendar.current.date(byAdding: .day, value: -(days - 1), to: now) ?? now
            let result = try await client.request(
                "usage.summary",
                payload: .object([
                    "from": .string(formatter.string(from: from)), "to": .string(formatter.string(from: now)),
                    "resolution": .string("day"), "timeZone": .string(TimeZone.current.identifier),
                ]))
            limits = try await client.request("usage.limits")
            // A machine from before accounts does not know the request, and its limits read as they always did.
            accounts = (try? await client.request(WireRequest.providersList.rawValue)).map(ProviderAccountList.init)
            return result
        }
    }
}
