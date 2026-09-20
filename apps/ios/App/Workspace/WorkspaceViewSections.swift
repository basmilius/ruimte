import Foundation
import RuimtePulsar

struct WorkspaceViewSection: Identifiable {
    enum ID: Hashable {
        case leading
        case divider(String)
    }
    let id: ID
    let title: String?
    var items: [JSONValue]
}

enum WorkspaceViewSections {
    /* The rows that divide the list rather than stand in it: a line, and a heading over what
       follows. A phone has no room for a rule between rows, so both open a section here and the
       one that carries a name gives that section its title. */
    static func isDivider(_ view: JSONValue) -> Bool {
        view.text("kind") == "separator" || view.text("kind") == "subheader"
    }

    static func split(_ views: [JSONValue], search: String = "") -> [WorkspaceViewSection] {
        var sections = [WorkspaceViewSection(id: .leading, title: nil, items: [])]
        for item in views {
            if isDivider(item) {
                let title = item.text("name").trimmingCharacters(in: .whitespacesAndNewlines)
                sections.append(
                    WorkspaceViewSection(
                        id: .divider(item.stableID), title: title.isEmpty ? nil : title, items: []
                    ))
            } else if search.isEmpty || item.text("name").localizedCaseInsensitiveContains(search) {
                sections[sections.count - 1].items.append(item)
            }
        }
        return sections.filter { !$0.items.isEmpty }
    }

    static func moving(
        _ views: [JSONValue], sectionID: WorkspaceViewSection.ID, expectedIDs: [String],
        from offsets: IndexSet, to destination: Int
    ) -> [JSONValue]? {
        guard let section = split(views).first(where: { $0.id == sectionID }),
            section.items.map(\.stableID) == expectedIDs,
            destination >= 0, destination <= section.items.count,
            !offsets.isEmpty, offsets.allSatisfy({ section.items.indices.contains($0) })
        else { return nil }
        let moved = offsets.map { section.items[$0] }
        var items = section.items.enumerated().filter { !offsets.contains($0.offset) }.map(
            \.element)
        items.insert(contentsOf: moved, at: destination - offsets.filter { $0 < destination }.count)
        let ids = Set(expectedIDs)
        guard ids.count == expectedIDs.count,
            views.filter({ ids.contains($0.stableID) }).count == ids.count
        else { return nil }
        var index = 0
        // Only this section's slots move; dividers and remote edits in other sections keep their positions.
        return views.map { view in
            guard ids.contains(view.stableID), !isDivider(view) else { return view }
            defer { index += 1 }
            return items[index]
        }
    }
}
