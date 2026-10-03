import SwiftUI

/// Where a point lands with snap to the grid on: the canvas grid the desktop draws on.
enum DrawingSnap {
    static func point(_ point: CGPoint, enabled: Bool) -> CGPoint {
        guard enabled else { return point }
        return CGPoint(x: CanvasEditing.snap(point.x), y: CanvasEditing.snap(point.y))
    }
}

/// The five places of the tool bar. Each holds the tools of one sort; a second tap on the active one shows them.
enum DrawingSlot: CaseIterable, Identifiable {
    case pen, shape, arrow, text, hand

    var id: Self { self }

    var tools: [DrawingTool] {
        switch self {
        case .pen: [.pen, .eraser]
        case .shape: [.rect, .ellipse, .diamond, .note]
        case .arrow: [.arrow, .line]
        case .text: [.text]
        case .hand: [.pan, .select]
        }
    }

    var title: String {
        switch self {
        case .pen: "Pen"
        case .shape: "Shape"
        case .arrow: "Arrow"
        case .text: "Text"
        case .hand: "Hand"
        }
    }

    static func slot(of tool: DrawingTool) -> DrawingSlot {
        allCases.first { $0.tools.contains(tool) } ?? .hand
    }

    /// The tool a tap on this place picks: the one last used there, else its first.
    func tool(remembered: [DrawingSlot: DrawingTool]) -> DrawingTool {
        remembered[self].flatMap { tools.contains($0) ? $0 : nil } ?? tools[0]
    }
}

/// The drawing's tools as a capsule of glass with the pen color beside it. Tapping the active tool again opens its
/// options above the bar: which tool of its sort, the color, the width and snap to the grid.
struct DrawingToolbar: View {
    @Bindable var model: DrawingEditorModel
    @State private var options = false
    @State private var remembered: [DrawingSlot: DrawingTool] = [:]
    @Namespace private var glass

    private var activeSlot: DrawingSlot { DrawingSlot.slot(of: model.tool) }

    var body: some View {
        GlassEffectContainer(spacing: 10) {
            VStack(spacing: 10) {
                if options {
                    DrawingToolOptions(model: model, slot: activeSlot)
                        .glassEffect(.regular, in: .rect(cornerRadius: 28))
                        .glassEffectID("options", in: glass)
                }
                HStack(spacing: 8) {
                    HStack(spacing: 2) {
                        ForEach(DrawingSlot.allCases) { slot in slotButton(slot) }
                    }
                    .padding(.horizontal, 6)
                    .frame(maxWidth: .infinity)
                    .glassEffect(.regular.interactive(), in: .capsule)
                    .glassEffectID("tools", in: glass)
                    Button {
                        withAnimation(.snappy) { options.toggle() }
                    } label: {
                        Circle().fill(Color(uiColor: DrawingPalette.color(model.style.stroke)))
                            .frame(width: 24, height: 24)
                            .overlay { Circle().strokeBorder(.white.opacity(0.35), lineWidth: 1) }
                            .frame(width: 52, height: 52)
                    }
                    .glassEffect(.regular.interactive(), in: .circle)
                    .accessibilityLabel("Color and width")
                }
            }
        }
        .buttonStyle(.plain)
        .onChange(of: model.tool) { _, tool in remembered[DrawingSlot.slot(of: tool)] = tool }
    }

    private func slotButton(_ slot: DrawingSlot) -> some View {
        let active = slot == activeSlot
        let shown = active ? model.tool : slot.tool(remembered: remembered)
        return Button {
            if active {
                withAnimation(.snappy) { options.toggle() }
            } else {
                model.tool = shown
                if options { withAnimation(.snappy) { options = false } }
            }
        } label: {
            Image(lucide: shown.symbol, size: 18)
                .frame(width: 44, height: 44)
                .background(active ? Color.primary.opacity(0.14) : .clear, in: .circle)
                .contentShape(.circle)
                .frame(maxWidth: .infinity)
        }
        .accessibilityLabel(shown.rawValue)
        .accessibilityHint(active ? "Shows its options" : "")
        .accessibilityAddTraits(active ? .isSelected : [])
    }
}

/// The options of the active sort of tool, the stroke color and width every tool draws with, and snapping.
private struct DrawingToolOptions: View {
    @Bindable var model: DrawingEditorModel
    let slot: DrawingSlot
    private let colors = ["ink", "yellow", "blue", "green", "red", "purple"]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if slot.tools.count > 1 {
                HStack(spacing: 8) {
                    ForEach(slot.tools) { tool in
                        Button {
                            model.tool = tool
                        } label: {
                            VStack(spacing: 4) {
                                Image(lucide: tool.symbol, size: 17)
                                    .frame(width: 44, height: 40)
                                    .background(
                                        model.tool == tool ? Color.primary.opacity(0.14) : Color.primary.opacity(0.05),
                                        in: .rect(cornerRadius: 12))
                                Text(tool.rawValue).font(.caption2).lineLimit(1)
                                    .foregroundStyle(model.tool == tool ? MobileStyle.text : MobileStyle.muted)
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .accessibilityAddTraits(model.tool == tool ? .isSelected : [])
                    }
                }
            }
            HStack(spacing: 0) {
                ForEach(colors, id: \.self) { name in
                    Button {
                        model.style.stroke = name
                        model.updateStyle(["stroke"])
                    } label: {
                        Circle().fill(Color(uiColor: DrawingPalette.color(name)))
                            .frame(width: 30, height: 30)
                            .padding(3)
                            .overlay {
                                if model.style.stroke == name {
                                    Circle().strokeBorder(MobileStyle.text, lineWidth: 2)
                                }
                            }
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .accessibilityLabel(name.capitalized)
                    .accessibilityAddTraits(model.style.stroke == name ? .isSelected : [])
                }
            }
            HStack {
                Text("Width").foregroundStyle(MobileStyle.muted)
                Picker("Width", selection: widthBinding) {
                    Text("Thin").tag(1)
                    Text("Medium").tag(2)
                    Text("Bold").tag(4)
                }
                .pickerStyle(.segmented)
            }
            Toggle("Snap to the grid", isOn: $model.snap)
        }
        .font(.subheadline)
        .padding(16)
    }

    private var widthBinding: Binding<Int> {
        Binding(
            get: { model.style.strokeWidth },
            set: { width in
                model.style.strokeWidth = width
                model.updateStyle(["strokeWidth"])
            })
    }
}
