import MapKit
import Network
import Observation
import RuimtePulsar
import SwiftUI

/// One Place of a Map as the list and the markers read it. There is no geocoding: a place without a latitude and a
/// longitude keeps its row and gets no marker.
struct UiMapPlace: Identifiable, Equatable {
    let id: String
    let number: Int
    let name: String
    let detail: String
    let address: String
    let lat: Double?
    let lon: Double?
    let value: JSONValue?

    var hasPoint: Bool { lat != nil && lon != nil }

    var coordinate: CLLocationCoordinate2D? {
        guard let lat, let lon else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }

    /// The valid places of a Map in the order written, numbered from one. A place the interpreter refused is not in it
    /// and draws as its text below the list.
    static func of(_ map: UiNode) -> [Self] {
        map.children(of: "Place").enumerated().map { index, place in
            let lat = place.number("lat")
            let lon = place.number("lon")
            let point = lat.flatMap { lat in lon.map { (lat, $0) } }.flatMap {
                (-90...90).contains($0.0) && (-180...180).contains($0.1) ? $0 : nil
            }
            let address = place.string("address") ?? ""
            let name = place.label
            return Self(
                id: place.id, number: index + 1, name: name.isEmpty ? address : name,
                detail: place.string("detail") ?? "", address: name.isEmpty ? "" : address, lat: point?.0,
                lon: point?.1, value: place.props["value"])
        }
    }
}

/// The part of the world the markers fit in, with room around them for a marker to stand whole.
struct UiMapFrame: Equatable {
    let latitude: Double
    let longitude: Double
    let latitudeSpan: Double
    let longitudeSpan: Double

    private static let margin = 1.5
    /// About two kilometers, so a single place or two next door do not zoom to the street.
    private static let smallest = 0.02

    /// Nil when no place has a point.
    static func fit(_ places: [UiMapPlace]) -> Self? {
        let points = places.compactMap { place in place.lat.flatMap { lat in place.lon.map { (lat, $0) } } }
        guard let first = points.first else { return nil }
        var south = first.0
        var north = first.0
        var west = first.1
        var east = first.1
        for (lat, lon) in points {
            south = min(south, lat)
            north = max(north, lat)
            west = min(west, lon)
            east = max(east, lon)
        }
        return Self(
            latitude: (south + north) / 2, longitude: (west + east) / 2,
            latitudeSpan: min(170, max(smallest, (north - south) * margin)),
            longitudeSpan: min(350, max(smallest, (east - west) * margin)))
    }

    var region: MKCoordinateRegion {
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
            span: MKCoordinateSpan(latitudeDelta: latitudeSpan, longitudeDelta: longitudeSpan))
    }

    /// Where a point stands in the frame, from the top left corner, for the map without a base map.
    func unit(lat: Double, lon: Double) -> CGPoint {
        CGPoint(
            x: (lon - (longitude - longitudeSpan / 2)) / longitudeSpan,
            y: ((latitude + latitudeSpan / 2) - lat) / latitudeSpan)
    }
}

/// Whether the phone has a network path, since a base map drawn offline would be blank.
@MainActor @Observable final class UiMapReachability {
    static let shared = UiMapReachability()
    private(set) var online = true
    @ObservationIgnored private let monitor = NWPathMonitor()
    @ObservationIgnored private var started = false

    func start() {
        guard !started else { return }
        started = true
        monitor.pathUpdateHandler = { [weak self] path in
            let satisfied = path.status == .satisfied
            Task { @MainActor in self?.online = satisfied }
        }
        monitor.start(queue: DispatchQueue(label: "app.ruimte.map-reachability", qos: .utility))
    }
}

/// The places of a map as MapKit draws them, or as dots when the base map is off or out of reach, over a numbered
/// list that is also what VoiceOver reads. Nothing here asks for the location of the person.
struct UiMapView: View {
    let node: UiNode
    let context: UiRenderContext
    @AppStorage(UiMapSetting.key) private var tiles = true
    @State private var position: MapCameraPosition
    @State private var wide = false
    private let reachability = UiMapReachability.shared

    private static let wideFrom: CGFloat = 420

    init(node: UiNode, context: UiRenderContext) {
        self.node = node
        self.context = context
        _position = State(initialValue: UiMapFrame.fit(UiMapPlace.of(node)).map { .region($0.region) } ?? .automatic)
    }

    var body: some View {
        let places = UiMapPlace.of(node)
        let current = node.boundValue ?? node.props["value"]
        let selected = places.first { $0.value != nil && $0.value == current }?.id
        let frame = UiMapFrame.fit(places)
        let drawn = tiles && reachability.online
        VStack(alignment: .leading, spacing: 6) {
            if let frame {
                surface(places.filter(\.hasPoint), frame: frame, selected: selected, drawn: drawn)
                if let note = Self.note(tiles: tiles, online: reachability.online) {
                    Text(note).font(.caption).foregroundStyle(MobileStyle.faint)
                }
            }
            VStack(alignment: .leading, spacing: 0) {
                ForEach(places) { place in
                    UiMapRow(place: place, selected: place.id == selected, pick: pick(place))
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(String(localized: "Map of \(places.count) places"))
            if node.omitted > 0 {
                Text("\(node.omitted) more places not shown").font(.caption).foregroundStyle(MobileStyle.faint)
            }
            ForEach(node.children.filter { $0.type == "Place" && $0.error != nil }) { refused in
                UiNodeView(node: refused, parent: node.type, context: context)
            }
        }
        .padding(.horizontal, 8)
        .modifier(UiPending(complete: node.complete))
        .onGeometryChange(for: Bool.self, of: { $0.size.width >= Self.wideFrom }) { wide = $0 }
        .onAppear { reachability.start() }
    }

    /// Why the base map is not there, or nil when it is.
    static func note(tiles: Bool, online: Bool) -> String? {
        if !tiles { return String(localized: "Map tiles are off.") }
        if !online { return String(localized: "No map tiles offline. The places stay listed.") }
        return nil
    }

    private func pick(_ place: UiMapPlace) -> (() -> Void)? {
        guard node.bindings["value"] != nil, let value = place.value else { return nil }
        return { context.change(node, to: value) }
    }

    @ViewBuilder private func surface(
        _ markers: [UiMapPlace], frame: UiMapFrame, selected: String?, drawn: Bool
    ) -> some View {
        Group {
            if drawn {
                Map(position: $position, interactionModes: [.pan, .zoom]) {
                    ForEach(markers) { place in
                        if let coordinate = place.coordinate {
                            Annotation(place.name, coordinate: coordinate, anchor: .center) {
                                marker(place, selected: place.id == selected)
                            }
                            .annotationTitles(.hidden)
                        }
                    }
                }
                .mapStyle(.standard(pointsOfInterest: .excludingAll))
                .onChange(of: frame) { _, next in position = .region(next.region) }
            } else {
                GeometryReader { geometry in
                    ZStack(alignment: .topLeading) {
                        MobileStyle.hover
                        ForEach(markers) { place in
                            let point = frame.unit(lat: place.lat ?? 0, lon: place.lon ?? 0)
                            marker(place, selected: place.id == selected)
                                .position(
                                    x: point.x * geometry.size.width, y: point.y * geometry.size.height)
                        }
                    }
                }
            }
        }
        .frame(height: wide ? 240 : 200)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(MobileStyle.border) }
        .accessibilityHidden(true)
    }

    @ViewBuilder private func marker(_ place: UiMapPlace, selected: Bool) -> some View {
        let chip = UiMapChip(number: place.number, selected: selected, side: 24)
        if let action = pick(place) {
            Button(action: action) { chip.padding(10).contentShape(Circle()) }.buttonStyle(.plain)
        } else {
            chip
        }
    }
}

/// The preference that decides whether MapKit draws a base map at all: Apple receives the area that is looked at.
enum UiMapSetting {
    static let key = "ruimte.chat.mapTiles"
}

/// The number that ties a row to its marker; the accent says which place is picked.
struct UiMapChip: View {
    let number: Int
    let selected: Bool
    let side: CGFloat

    var body: some View {
        Text(verbatim: "\(number)").font(.caption.weight(.medium)).monospacedDigit()
            .foregroundStyle(selected ? MobileStyle.onAccent : MobileStyle.surface)
            .frame(width: side, height: side)
            .background(selected ? MobileStyle.accent : MobileStyle.text, in: Circle())
    }
}

private struct UiMapRow: View {
    let place: UiMapPlace
    let selected: Bool
    let pick: (() -> Void)?

    var body: some View {
        if let pick {
            Button(action: pick) { content }.buttonStyle(.plain)
                .accessibilityAddTraits(.isButton)
        } else {
            content
        }
    }

    private var content: some View {
        HStack(alignment: .top, spacing: 8) {
            UiMapChip(number: place.number, selected: selected, side: 20).padding(.top, 1)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: place.name).font(.subheadline).foregroundStyle(MobileStyle.text)
                if !place.detail.isEmpty {
                    Text(verbatim: place.detail).font(.caption).foregroundStyle(MobileStyle.muted)
                }
                if !place.address.isEmpty {
                    Text(verbatim: place.address).font(.caption).foregroundStyle(MobileStyle.faint)
                }
                if !place.hasPoint {
                    Text("Not on the map").font(.caption).foregroundStyle(MobileStyle.faint)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 8).padding(.vertical, 6)
        .frame(minHeight: 44, alignment: .top)
        .background(selected ? MobileStyle.hover : .clear, in: RoundedRectangle(cornerRadius: 8))
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }

    private var spoken: String {
        var parts = ["\(place.number)", place.name]
        parts.append(contentsOf: [place.detail, place.address].filter { !$0.isEmpty })
        if !place.hasPoint { parts.append(String(localized: "Not on the map")) }
        return parts.joined(separator: ", ")
    }
}
