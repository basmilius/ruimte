import Foundation
import RuimtePulsar

struct WorkspaceViewSection: Identifiable {
    enum ID: Hashable {
        case leading
        case divider(String)
    }
    let id: ID
    let title: String?
    var items: [ProjectItem]
}

enum WorkspaceViewSections {
    /// The rows that divide the list rather than stand in it: a line, and a heading over what follows. A phone has no
    /// room for a rule between rows, so both open a section here and the one that carries a name titles it.
    static func isDivider(_ view: ProjectItem) -> Bool { view.isDivider }

    static func split(_ views: [ProjectItem], search: String = "") -> [WorkspaceViewSection] {
        var sections = [WorkspaceViewSection(id: .leading, title: nil, items: [])]
        for item in views {
            if isDivider(item) {
                let title = item.name.trimmingCharacters(in: .whitespacesAndNewlines)
                sections.append(
                    WorkspaceViewSection(id: .divider(item.id), title: title.isEmpty ? nil : title, items: []))
            } else if search.isEmpty || item.name.localizedCaseInsensitiveContains(search) {
                sections[sections.count - 1].items.append(item)
            }
        }
        return sections.filter { !$0.items.isEmpty }
    }

    /// Whether a view stands in the list. A chat of the Chats project nobody wrote in yet stays out, as the desktop's
    /// sidebar leaves it out, unless it is the one open. A hidden view (the canvas another machine draws its nodes on,
    /// or an inline chat) and a chat an extension draws are never listed, open or not.
    static func isListed(_ view: ProjectItem, selectedID: String?) -> Bool {
        !ProjectListLogic.isUnlisted(view, emptyChatStays: view.id == selectedID)
    }

    /// Moves rows of one section as the list shows it. A view the list leaves out keeps its slot, so only the slots of
    /// the rows on screen take the new order.
    static func moving(
        _ views: [JSONValue], sectionID: WorkspaceViewSection.ID, expectedIDs: [String],
        from offsets: IndexSet, to destination: Int, listed: (ProjectItem) -> Bool = { _ in true }
    ) -> [JSONValue]? {
        let rows = views.compactMap(\.projectItem)
        guard let section = split(rows.filter(listed)).first(where: { $0.id == sectionID }),
            section.items.map(\.id) == expectedIDs,
            destination >= 0, destination <= section.items.count,
            !offsets.isEmpty, offsets.allSatisfy({ section.items.indices.contains($0) })
        else { return nil }
        let moved = offsets.map { section.items[$0] }
        var reordered = section.items.enumerated().filter { !offsets.contains($0.offset) }.map(\.element)
        reordered.insert(contentsOf: moved, at: destination - offsets.filter { $0 < destination }.count)
        let ids = Set(expectedIDs)
        guard ids.count == expectedIDs.count,
            views.filter({ ids.contains($0.stableID) }).count == ids.count
        else { return nil }
        let dividers = Set(rows.filter(\.isDivider).map(\.id))
        let byID = Dictionary(views.map { ($0.stableID, $0) }, uniquingKeysWith: { first, _ in first })
        var index = 0
        // Only this section's slots move; dividers and remote edits in other sections keep their positions.
        return views.map { view in
            guard ids.contains(view.stableID), !dividers.contains(view.stableID) else { return view }
            defer { index += 1 }
            return byID[reordered[index].id] ?? view
        }
    }
}
