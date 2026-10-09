import Foundation
import Observation
import RuimtePulsar

public struct ImageSaveFolder: Identifiable, Equatable, Sendable {
    public var id: String { directory }
    public let directory: String
    public let name: String
}

public enum ImageSaveFailure: Error, LocalizedError {
    case invalidTarget

    public var errorDescription: String? { "The machine returned an invalid image destination." }
}

@MainActor @Observable
public final class ImageSaveModel {
    public typealias Request = @MainActor @Sendable (String, JSONValue) async throws -> JSONValue
    public let folder: String
    public let projectName: String
    public private(set) var directory = ""
    public private(set) var name: String
    public private(set) var checking = false
    public private(set) var pending = false
    public private(set) var closed = false
    public private(set) var error: String?
    public private(set) var savedPath: String?
    public private(set) var folders: [String: [ImageSaveFolder]] = [:]
    public private(set) var loadingFolders: Set<String> = []
    public private(set) var folderErrors: [String: String] = [:]
    public private(set) var truncatedFolders: Set<String> = []
    @ObservationIgnored private let source: [String: JSONValue]
    @ObservationIgnored private let request: Request
    @ObservationIgnored private let done: @MainActor (String?) -> Void
    @ObservationIgnored private var checkID = 0
    private var checkedPath: String?
    private var target: JSONValue?

    public init(
        chatID: String, attachmentID: String, root: JSONValue, request: @escaping Request,
        done: @escaping @MainActor (String?) -> Void
    ) throws {
        guard let folder = root["folder"]?.stringValue, folder.hasPrefix("/"),
            let projectName = root["projectName"]?.stringValue, let name = root["name"]?.stringValue,
            !chatID.isEmpty, !attachmentID.isEmpty
        else { throw ImageSaveFailure.invalidTarget }
        self.folder = folder
        self.projectName = projectName
        self.name = name
        source = ["chatId": .string(chatID), "attachmentId": .string(attachmentID)]
        self.request = request
        self.done = done
    }

    public var destinationPath: String { path(directory.isEmpty ? name : "\(directory)/\(name)") }
    public var exists: Bool { target?["exists"]?.boolValue == true }
    public var canSave: Bool { checked && !exists }
    public var canReplace: Bool { checked && exists && !(target?["revision"]?.stringValue ?? "").isEmpty }
    private var checked: Bool {
        !closed && !pending && !checking && Self.validFileName(name) && checkedPath == destinationPath && target != nil
    }

    public static func validFileName(_ name: String) -> Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && name != "." && name != ".."
            && !name.contains(where: { $0 == "/" || $0 == "\\" || $0 == "\0" })
    }

    public func setName(_ name: String) {
        guard !pending && !closed else { return }
        self.name = name
        invalidateCheck()
    }

    public func selectDirectory(_ directory: String) {
        guard !pending && !closed && Self.validDirectory(directory) else { return }
        self.directory = directory
        invalidateCheck()
    }

    public func check() async {
        guard !pending && !closed else { return }
        invalidateCheck()
        guard Self.validFileName(name) else { return }
        let id = checkID
        let path = destinationPath
        checking = true
        defer { if checkID == id && !closed { checking = false } }
        do {
            let target = try await request("chat.imageTarget", payload(["path": .string(path)]))
            guard checkID == id && !closed else { return }
            guard target["folder"]?.stringValue == folder, target["exists"]?.boolValue != nil,
                target["revision"] == .null || target["revision"]?.stringValue != nil
            else { throw ImageSaveFailure.invalidTarget }
            self.target = target
            checkedPath = path
        } catch {
            if checkID == id && !closed { self.error = error.localizedDescription }
        }
    }

    public func save(replace: Bool = false) async {
        guard replace ? canReplace : canSave else { return }
        let path = destinationPath
        var fields: [String: JSONValue] = ["path": .string(path)]
        if replace { fields["replace"] = target?["revision"] }
        pending = true
        error = nil
        do {
            let result = try await request("chat.saveImage", payload(fields))
            guard let savedPath = result["path"]?.stringValue, !savedPath.isEmpty else {
                throw ImageSaveFailure.invalidTarget
            }
            self.savedPath = savedPath
            pending = false
            closed = true
            checkID += 1
            done(savedPath)
        } catch {
            pending = false
            await check()
            if !closed && destinationPath == path { self.error = error.localizedDescription }
        }
    }

    public func close() {
        guard !closed && !pending else { return }
        closed = true
        invalidateCheck()
        done(nil)
    }

    public func loadFolders(_ directory: String = "") async {
        guard !closed && !pending && Self.validDirectory(directory), folders[directory] == nil,
            !loadingFolders.contains(directory)
        else { return }
        loadingFolders.insert(directory)
        folderErrors[directory] = nil
        defer { loadingFolders.remove(directory) }
        do {
            let result = try await request(
                "fs.list", .object(["path": .string(path(directory)), "depth": .number(1), "hidden": .bool(true)]))
            guard !closed else { return }
            var seen: Set<String> = []
            folders[directory] = (result["entries"]?.arrayValue ?? []).compactMap { entry in
                guard entry["kind"] == .string("directory"), let name = entry["name"]?.stringValue,
                    Self.validFileName(name), name != ".git", name != ".ruimte", seen.insert(name).inserted
                else { return nil }
                return ImageSaveFolder(directory: directory.isEmpty ? name : "\(directory)/\(name)", name: name)
            }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
            if result["truncated"]?.boolValue == true { truncatedFolders.insert(directory) }
        } catch {
            if !closed { folderErrors[directory] = error.localizedDescription }
        }
    }

    private func invalidateCheck() {
        checkID += 1
        checkedPath = nil
        target = nil
        checking = false
        error = nil
    }

    private func path(_ relative: String) -> String {
        relative.isEmpty ? folder : (folder.hasSuffix("/") ? "\(folder)\(relative)" : "\(folder)/\(relative)")
    }

    private static func validDirectory(_ directory: String) -> Bool {
        directory.isEmpty
            || directory.split(separator: "/", omittingEmptySubsequences: false).allSatisfy {
                Self.validFileName(String($0))
            }
    }

    private func payload(_ fields: [String: JSONValue]) -> JSONValue {
        .object(fields.merging(source, uniquingKeysWith: { _, identity in identity }))
    }
}
