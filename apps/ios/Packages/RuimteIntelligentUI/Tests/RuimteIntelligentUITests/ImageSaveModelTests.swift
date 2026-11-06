import Foundation
import RuimtePulsar
import Testing

@testable import RuimteIntelligentUI

private func imageTarget(exists: Bool = false, revision: String? = nil, folder: String = "/project") -> JSONValue {
    .object([
        "folder": .string(folder), "projectName": .string("Project"), "name": .string("rabbit.png"),
        "exists": .bool(exists), "revision": revision.map(JSONValue.string) ?? .null,
    ])
}
private let imageRoot = imageTarget()

@MainActor private final class ImageSaveRequests {
    var calls: [(WireRequest, JSONValue)] = []
    var handler: @MainActor (WireRequest, JSONValue) async throws -> JSONValue = { name, payload in
        name == .chatImageTarget ? imageRoot : .object(["path": payload["path"] ?? .null])
    }
    func request(_ name: WireRequest, _ payload: JSONValue) async throws -> JSONValue {
        calls.append((name, payload))
        return try await handler(name, payload)
    }
}

@MainActor struct ImageSaveModelTests {
    @Test func onlyCheckedTargetsSaveAndRepeatedActionsSendOneWrite() async throws {
        let requests = ImageSaveRequests()
        let started = Gate<Bool>()
        let finish = Gate<JSONValue>()
        var results: [String?] = []
        requests.handler = { name, payload in
            if name == .chatSaveImage {
                await started.release(true)
                return await finish.wait()
            }
            return imageRoot
        }
        let model = try ImageSaveModel(
            chatID: "chat", attachmentID: "image", root: imageRoot, request: requests.request
        ) { results.append($0) }
        await model.save()
        #expect(requests.calls.isEmpty)
        await model.check()
        #expect(model.canSave)
        let write = Task { await model.save() }
        _ = await started.wait()
        #expect(model.pending)
        model.setName("other.png")
        model.selectDirectory("assets")
        model.close()
        await model.save()
        #expect(model.name == "rabbit.png")
        #expect(model.directory.isEmpty)
        #expect(!model.closed)
        #expect(requests.calls.count == 2)
        #expect(
            requests.calls.last?.1
                == .object([
                    "chatId": .string("chat"), "attachmentId": .string("image"), "path": .string("/project/rabbit.png"),
                ]))
        await finish.release(.object(["path": .string("/project/rabbit.png")]))
        await write.value
        #expect(model.closed)
        #expect(!model.pending)
        #expect(model.savedPath == "/project/rabbit.png")
        #expect(results == ["/project/rabbit.png"])
        model.close()
        #expect(results.count == 1)
    }

    @Test func replacingRequiresAnExplicitActionAndTheCheckedRevision() async throws {
        let requests = ImageSaveRequests()
        requests.handler = { name, payload in
            name == .chatImageTarget
                ? imageTarget(exists: true, revision: "checked-version")
                : .object(["path": payload["path"] ?? .null])
        }
        let model = try ImageSaveModel(
            chatID: "chat", attachmentID: "image", root: imageRoot, request: requests.request
        ) { _ in }
        await model.check()
        #expect(model.exists)
        #expect(!model.canSave)
        #expect(model.canReplace)
        await model.save()
        #expect(requests.calls.count == 1)
        await model.save(replace: true)
        #expect(requests.calls.last?.1["replace"] == .string("checked-version"))
        #expect(model.closed)
    }

    @Test func aLateCheckCannotApproveANewerName() async throws {
        let requests = ImageSaveRequests()
        let started = Gate<Bool>()
        let finish = Gate<JSONValue>()
        requests.handler = { _, payload in
            if payload["path"] == .string("/project/rabbit.png") {
                await started.release(true)
                return await finish.wait()
            }
            return imageRoot
        }
        let model = try ImageSaveModel(
            chatID: "chat", attachmentID: "image", root: imageRoot, request: requests.request
        ) { _ in }
        let old = Task { await model.check() }
        _ = await started.wait()
        model.setName("other.png")
        #expect(!model.canSave)
        await model.check()
        #expect(model.canSave)
        await finish.release(imageTarget(exists: true, revision: "old-file"))
        await old.value
        #expect(model.canSave)
        #expect(!model.exists)
        #expect(model.destinationPath == "/project/other.png")
    }

    @Test func cancellingInvalidatesAReadAndResolvesOnce() async throws {
        let requests = ImageSaveRequests()
        let started = Gate<Bool>()
        let finish = Gate<JSONValue>()
        var results: [String?] = []
        requests.handler = { _, _ in
            await started.release(true)
            return await finish.wait()
        }
        let model = try ImageSaveModel(
            chatID: "chat", attachmentID: "image", root: imageRoot, request: requests.request
        ) { results.append($0) }
        let checking = Task { await model.check() }
        _ = await started.wait()
        model.close()
        model.close()
        await finish.release(imageRoot)
        await checking.value
        #expect(model.closed)
        #expect(!model.checking)
        #expect(!model.canSave)
        #expect(results.count == 1)
        #expect(results[0] == nil)
        await model.save()
        #expect(requests.calls.count == 1)
    }

    @Test func aFailedWriteRechecksTheDestinationBeforeOfferingReplace() async throws {
        struct Appeared: LocalizedError { var errorDescription: String? { "A file appeared" } }
        let requests = ImageSaveRequests()
        var checks = 0
        requests.handler = { name, _ in
            if name == .chatSaveImage { throw Appeared() }
            checks += 1
            return checks == 1
                ? imageRoot : imageTarget(exists: true, revision: "new-file")
        }
        let model = try ImageSaveModel(
            chatID: "chat", attachmentID: "image", root: imageRoot, request: requests.request
        ) { _ in }
        await model.check()
        await model.save()
        #expect(!model.pending)
        #expect(!model.closed)
        #expect(model.error == "A file appeared")
        #expect(!model.canSave)
        #expect(model.canReplace)
        #expect(requests.calls.map(\.0) == [.chatImageTarget, .chatSaveImage, .chatImageTarget])
    }

    @Test func folderReadsStayUnderTheRootAndExcludeFilesLinksAndState() async throws {
        let requests = ImageSaveRequests()
        let entry = { (kind: String, name: String) -> JSONValue in
            .object([
                "kind": .string(kind), "name": .string(name), "path": .string("/ignored-by-client"), "size": .null,
                "mtime": .number(0), "hidden": .bool(false), "ignored": .bool(false),
            ])
        }
        requests.handler = { _, _ in
            .object([
                "path": .string("/project"), "truncated": .bool(true),
                "entries": .array([
                    entry("directory", "assets"), entry("directory", "assets"), entry("symlink", "linked"),
                    entry("file", "image.png"), entry("directory", ".git"), entry("directory", ".ruimte"),
                    entry("directory", "../outside"),
                ]),
            ])
        }
        let model = try ImageSaveModel(
            chatID: "chat", attachmentID: "image", root: imageRoot, request: requests.request
        ) { _ in }
        await model.loadFolders()
        #expect(model.folders[""]?.map(\.directory) == ["assets"])
        #expect(model.truncatedFolders.contains(""))
        await model.loadFolders()
        await model.loadFolders("../outside")
        #expect(requests.calls.count == 1)
        model.selectDirectory("assets")
        #expect(model.destinationPath == "/project/assets/rabbit.png")
        model.selectDirectory("/outside")
        #expect(model.directory == "assets")
        await model.loadFolders("assets")
        #expect(requests.calls.last?.1["path"] == .string("/project/assets"))
        #expect(model.folders["assets"]?.first?.directory == "assets/assets")
    }

    @Test func invalidNamesAndChangedProjectRootsCannotAuthorizeWrites() async throws {
        let requests = ImageSaveRequests()
        let model = try ImageSaveModel(
            chatID: "chat", attachmentID: "image", root: imageRoot, request: requests.request
        ) { _ in }
        for name in ["", " ", ".", "..", "../image.png", "assets/image.png", "assets\\image.png", "image\0.png"] {
            model.setName(name)
            await model.check()
            #expect(!model.canSave)
        }
        #expect(requests.calls.isEmpty)
        model.setName("日本語 🐇.png")
        requests.handler = { _, _ in imageTarget(folder: "/other-project") }
        await model.check()
        #expect(!model.canSave)
        #expect(model.error != nil)
        await model.save()
        #expect(requests.calls.count == 1)
    }
}
