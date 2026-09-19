import RuimtePulsar
import RuimteTransport
import SwiftUI
import UIKit

struct DrawingEditorPage: View {
    @State private var model: DrawingEditorModel
    @State private var discard = false
    @State private var showStyle = false
    @State private var edit: DrawingTextEdit?
    @State private var share: DrawingShare?
    @State private var viewport: DrawingViewportRequest?
    @State private var exporting = false
    @Environment(\.colorScheme) private var colorScheme

    init(client: any MachineRequesting, machineID: String, projectID: String, viewID: String) {
        _model = State(
            initialValue: DrawingEditorModel(client: client, machineID: machineID, projectID: projectID, viewID: viewID)
        )
    }
    var body: some View {
        Group {
            if let scene = model.scene {
                MobileScrollViewport { insets in
                    DrawingCanvas(
                        model: model, scene: scene, viewportInsets: insets, viewportRequest: viewport,
                        editText: { element, isNew in edit = DrawingTextEdit(element: element, isNew: isNew) },
                        showStyle: { showStyle = true })
                }
                .overlay {
                    if model.elements.isEmpty {
                        ContentUnavailableView(
                            "Nothing drawn yet", lucideIcon: "pen-tool",
                            description: Text(
                                "Pick a pen or a shape from the tools below and draw with a finger or Apple Pencil.")
                        )
                        .allowsHitTesting(false)
                        .accessibilityIdentifier("drawing.empty")
                    }
                }
            } else if let problem = model.problem {
                ContentUnavailableView("Could not open drawing", lucideIcon: "pen-tool", description: Text(problem))
            } else {
                MobileLoadingRow("Loading drawing").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 8) {
                if let problem = model.problem {
                    HStack {
                        Text(problem).font(.caption)
                        Button("Retry") { Task { await model.reload() } }
                        if model.dirty { Button("Discard", role: .destructive) { discard = true } }
                    }.padding(12).background(.regularMaterial, in: .rect(cornerRadius: 16))
                }
                toolbar
            }.padding(.horizontal, 12).padding(.vertical, 8)
        }
        .confirmationDialog("Discard unsaved changes on this device?", isPresented: $discard, titleVisibility: .visible)
        {
            Button("Discard local changes", role: .destructive) { model.discardDraft() }
        }
        .mobileSheet(isPresented: $showStyle) { styleSheet.presentationDetents([.medium, .large]) }
        .mobileSheet(item: $edit) { editing in
            DrawingTextSheet(edit: editing) { text in
                model.updateText(editing.element, text: text, isNew: editing.isNew)
            }
            .presentationDetents([.medium, .large])
        }
        .sheet(item: $share) { DrawingShareSheet(url: $0.url) }
        .task { await model.start() }
        .onDisappear { model.stop() }
    }

    private var toolbar: some View {
        GlassEffectContainer(spacing: 4) {
            HStack(spacing: 4) {
                toolButton(.pan)
                toolButton(.select)
                Menu {
                    ForEach(DrawingTool.allCases.filter { ![.pan, .select].contains($0) }) { option in
                        Button {
                            model.tool = option
                        } label: {
                            Label(option.rawValue, lucideIcon: option.symbol)
                        }
                    }
                    Divider()
                    Toggle("Keep the tool", isOn: $model.toolLocked)
                } label: {
                    controlIcon([.pan, .select].contains(model.tool) ? "pen-tool" : model.tool.symbol)
                }.accessibilityLabel("Drawing tools, " + model.tool.rawValue)
                    .glassEffect(.regular.interactive(), in: .circle).hoverEffect(.highlight)
                Button {
                    showStyle = true
                } label: {
                    controlIcon("palette")
                }
                .accessibilityLabel("Style").glassEffect(.regular.interactive(), in: .circle).hoverEffect(.highlight)
                Button {
                    model.undo()
                } label: {
                    controlIcon("undo-2")
                }
                .accessibilityLabel("Undo").disabled(model.history.isEmpty)
                .glassEffect(.regular.interactive(), in: .circle).hoverEffect(.highlight)
                Button {
                    model.redo()
                } label: {
                    controlIcon("redo-2")
                }
                .accessibilityLabel("Redo").disabled(model.future.isEmpty)
                .glassEffect(.regular.interactive(), in: .circle).hoverEffect(.highlight)
                Menu {
                    actions
                } label: {
                    if model.saving || exporting {
                        ProgressView().frame(width: 44, height: 44)
                    } else {
                        controlIcon("ellipsis")
                    }
                }.accessibilityLabel("Drawing actions").hoverEffect(.highlight)
            }.buttonStyle(.plain)
        }
    }
    private func controlIcon(_ name: String) -> some View {
        Image(lucide: name, size: 18).frame(width: 44, height: 44).contentShape(.rect)
    }
    private func toolButton(_ tool: DrawingTool) -> some View {
        Button {
            model.tool = tool
        } label: {
            controlIcon(tool.symbol)
        }
        .accessibilityLabel(tool.rawValue).accessibilityAddTraits(model.tool == tool ? .isSelected : [])
        .glassEffect(
            .regular.tint(model.tool == tool ? Color.primary.opacity(0.12) : .clear).interactive(), in: .circle
        )
        .hoverEffect(.highlight)
    }
    @ViewBuilder private var actions: some View {
        Section("Selection") {
            Toggle("Add to selection", isOn: $model.additiveSelection)
            Button("Select all", lucideIcon: "square-dashed") {
                model.tool = .select
                model.select(Set(model.elements.filter { $0["locked"] != .bool(true) }.map(\.stableID)))
            }
            if !model.selection.isEmpty {
                Button("Deselect", lucideIcon: "square-dashed") { model.selection = [] }
                if model.selected.count == 1, let item = model.selected.first,
                    ["text", "note"].contains(item.text("kind"))
                {
                    Button("Edit text", lucideIcon: "type") { edit = DrawingTextEdit(element: item, isNew: false) }
                }
                Button("Duplicate", lucideIcon: "copy-plus") { model.duplicate() }
                Button("Copy", lucideIcon: "copy") { model.copySelection() }
                Button("Cut", lucideIcon: "scissors") { model.copySelection(cut: true) }
                Button("Bring to front", lucideIcon: "bring-to-front") { model.reorder(front: true) }
                Button("Send to back", lucideIcon: "send-to-back") { model.reorder(front: false) }
                Button("Lock", lucideIcon: "lock") { model.lockSelection() }
                Button("Delete", lucideIcon: "trash", role: .destructive) { model.deleteSelected() }
            }
            Button("Paste", lucideIcon: "clipboard-paste") { model.paste() }
            if model.elements.contains(where: { $0["locked"] == .bool(true) }) {
                Button("Unlock all", lucideIcon: "lock-open") { model.unlockAll() }
            }
        }
        Section("Zoom") {
            Button("Fit drawing", lucideIcon: "maximize") { viewport = DrawingViewportRequest(action: .fitAll) }
            Button("Fit selection", lucideIcon: "scan") { viewport = DrawingViewportRequest(action: .fitSelection) }
                .disabled(model.selection.isEmpty)
            Menu("Zoom level") {
                ForEach([25, 50, 75, 100, 150, 200, 400], id: \.self) { percentage in
                    Button("\(percentage)%") {
                        viewport = DrawingViewportRequest(action: .scale(Double(percentage) / 100))
                    }
                }
            }
            Button("Zoom in", lucideIcon: "zoom-in") { viewport = DrawingViewportRequest(action: .step(0.1)) }
            Button("Zoom out", lucideIcon: "zoom-out") { viewport = DrawingViewportRequest(action: .step(-0.1)) }
        }
        Section(model.selection.isEmpty ? "Export drawing" : "Export selection") {
            Button("Copy PNG", lucideIcon: "copy") { export(.png, copy: true) }.disabled(
                model.exportElements.isEmpty || exporting)
            Button("Copy SVG", lucideIcon: "copy") { export(.svg, copy: true) }.disabled(
                model.exportElements.isEmpty || exporting)
            Button("Share PNG", lucideIcon: "share") { export(.png, copy: false) }.disabled(
                model.exportElements.isEmpty || exporting)
            Button("Share SVG", lucideIcon: "share") { export(.svg, copy: false) }.disabled(
                model.exportElements.isEmpty || exporting)
            Toggle("Include background", isOn: $model.exportBackground)
        }
    }
    private var styleSheet: some View {
        NavigationStack {
            MobileForm {
                Section("Color") {
                    colorPicker("Stroke", selection: binding(\.stroke, "stroke"))
                    colorPicker("Fill", selection: binding(\.fillColor, "fillColor"))
                    colorPicker("Sticky note", selection: binding(\.noteColor, "noteColor"))
                }
                Section("Stroke and fill") {
                    Picker("Width", selection: binding(\.strokeWidth, "strokeWidth")) {
                        Text("Thin").tag(1)
                        Text("Medium").tag(2)
                        Text("Bold").tag(4)
                    }
                    Picker("Stroke", selection: binding(\.strokeStyle, "strokeStyle")) {
                        Text("Solid").tag("solid")
                        Text("Dashed").tag("dashed")
                        Text("Dotted").tag("dotted")
                    }
                    Picker("Fill", selection: binding(\.fill, "fill")) {
                        Text("None").tag("none")
                        Text("Hachure").tag("hachure")
                        Text("Solid").tag("solid")
                    }
                    Picker("Drawing style", selection: binding(\.roughness, "roughness")) {
                        Text("Architect").tag(0)
                        Text("Artist").tag(1)
                        Text("Cartoonist").tag(2)
                    }
                }
                Section("Text") {
                    Picker("Font", selection: binding(\.font, "font")) {
                        Text("Hand").tag("hand")
                        Text("Sans").tag("sans")
                        Text("Mono").tag("mono")
                    }
                    Stepper("Size: \(model.style.textSize)", value: binding(\.textSize, "textSize"), in: 12...96)
                    Picker("Alignment", selection: binding(\.align, "align")) {
                        Text("Left").tag("left")
                        Text("Center").tag("center")
                        Text("Right").tag("right")
                    }
                }
                if model.selected.contains(where: { $0.text("kind") == "line" }) {
                    Section("Arrowheads") {
                        Toggle(
                            "Start",
                            isOn: Binding(
                                get: {
                                    model.selected.first(where: { $0.text("kind") == "line" })?["arrowStart"]
                                        == .bool(true)
                                }, set: { model.setArrow("arrowStart", value: $0) }))
                        Toggle(
                            "End",
                            isOn: Binding(
                                get: {
                                    model.selected.first(where: { $0.text("kind") == "line" })?["arrowEnd"]
                                        == .bool(true)
                                }, set: { model.setArrow("arrowEnd", value: $0) }))
                    }
                }
                Section {
                    Toggle("Keep the tool after drawing", isOn: $model.toolLocked)
                    Toggle("Constrain proportions and angles", isOn: $model.constrain)
                }
            }
            .navigationTitle(model.selection.isEmpty ? "Drawing style" : "Selection style")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showStyle = false } } }
        }
    }
    private func binding<Value>(_ path: WritableKeyPath<DrawingStyle, Value>, _ key: String) -> Binding<Value> {
        Binding(
            get: { model.style[keyPath: path] },
            set: { value in
                model.style[keyPath: path] = value
                model.updateStyle([key])
            })
    }
    private func colorPicker(_ title: String, selection: Binding<String>) -> some View {
        Picker(title, selection: selection) {
            ForEach(DrawingPalette.names, id: \.self) { name in
                HStack {
                    Circle().fill(Color(uiColor: DrawingPalette.color(name))).frame(width: 16, height: 16)
                    Text(name.capitalized)
                }.tag(name)
            }
        }
    }
    private func export(_ format: DrawingExportFormat, copy: Bool) {
        exporting = true
        let elements = model.exportElements
        let background = model.exportBackground
        let dark = colorScheme == .dark
        Task {
            defer { exporting = false }
            do {
                let data = try await DrawingExport.data(
                    elements: elements, format: format, background: background, dark: dark)
                if copy {
                    if format == .svg {
                        UIPasteboard.general.string = String(decoding: data, as: UTF8.self)
                    } else {
                        UIPasteboard.general.setData(data, forPasteboardType: "public.png")
                    }
                } else {
                    let url = FileManager.default.temporaryDirectory.appendingPathComponent(
                        "Drawing-\(UUID().uuidString.prefix(8)).\(format.rawValue)")
                    try data.write(to: url, options: .atomic)
                    share = DrawingShare(url: url)
                }
            } catch { model.problem = error.localizedDescription }
        }
    }
}

struct DrawingTextEdit: Identifiable {
    let id = UUID()
    let element: JSONValue
    let isNew: Bool
}
private struct DrawingTextSheet: View {
    let edit: DrawingTextEdit
    let save: (String) -> Void
    @State private var text = ""
    @FocusState private var focused: Bool
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            TextEditor(text: $text).font(.body).padding(12).focused($focused)
                .navigationTitle(edit.element.text("kind") == "note" ? "Sticky note" : "Text")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") {
                            save(text)
                            dismiss()
                        }
                    }
                }
        }.onAppear {
            text = edit.element.text("text")
            focused = true
        }
    }
}
