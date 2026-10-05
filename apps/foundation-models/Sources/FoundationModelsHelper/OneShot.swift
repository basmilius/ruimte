import Foundation
import FoundationModels

/// Single generations without a conversation: no session store, no tools, no network. A request carries its
/// own instructions and prompt, and its text streams back as snapshots until `done`.
actor OneShot {
    private let output: Output
    private var active: [String: Task<Void, Never>] = [:]

    init(output: Output = Output()) {
        self.output = output
    }

    func serve() async {
        switch SystemLanguageModel.default.availability {
        case .available: await output.send(Frame(type: "availability", available: true))
        case .unavailable(let reason):
            await output.send(Frame(type: "availability", available: false, reason: String(describing: reason)))
            return
        }
        do {
            for try await line in FileHandle.standardInput.bytes.lines {
                guard line.utf8.count <= 65_536,
                      let request = try? JSONDecoder().decode(Request.self, from: Data(line.utf8)) else { continue }
                handle(request)
            }
        } catch { }
        for task in active.values { task.cancel() }
    }

    private func handle(_ request: Request) {
        switch request.type {
        case "generate":
            guard let id = request.id, let prompt = request.prompt else { return }
            guard active[id] == nil else { return }
            active[id] = Task { await self.generate(id: id, request: request, prompt: prompt) }
        case "cancel":
            if let id = request.id { active[id]?.cancel() }
        default: break
        }
    }

    private func generate(id: String, request: Request, prompt: String) async {
        let completion: Frame
        do {
            let model = SystemLanguageModel.default
            let session = LanguageModelSession(model: model, tools: [], instructions: request.instructions ?? "")
            let limit = min(max(request.maxTokens ?? 512, 16), 1024)
            let promptTokens = try await model.tokenCount(for: prompt)
            let instructionTokens = try await model.tokenCount(for: session.transcript)
            guard promptTokens + instructionTokens + limit <= model.contextSize else {
                throw OneShotError.tooLarge
            }
            let options = GenerationOptions(temperature: request.temperature, maximumResponseTokens: limit)
            var last = ""
            for try await snapshot in session.streamResponse(to: prompt, options: options) {
                try Task.checkCancellation()
                last = snapshot.content
                await output.send(Frame(type: "text.snapshot", id: id, text: last))
            }
            try Task.checkCancellation()
            completion = Frame(type: "done", id: id, text: last, state: "done")
        } catch {
            completion = Frame(type: "done", id: id, text: Task.isCancelled ? nil : String(describing: error),
                               state: Task.isCancelled ? "aborted" : "error")
        }
        active[id] = nil
        await output.send(completion)
    }
}

enum OneShotError: Error, CustomStringConvertible {
    case tooLarge

    var description: String {
        switch self {
        case .tooLarge: "The request is too large for the on-device model."
        }
    }
}
