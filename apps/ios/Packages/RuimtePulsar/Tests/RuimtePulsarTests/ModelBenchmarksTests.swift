import Foundation
import Testing

@testable import RuimtePulsar

@Suite struct ModelBenchmarksTests {
    private func answer(_ request: URLRequest, status: Int, body: String) -> (Data, HTTPURLResponse) {
        (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }

    @Test func benchmarksAreReadWithoutAnAccount() async throws {
        let client = AddressBookClient(fetch: { request in
            #expect(request.httpMethod == "GET")
            #expect(request.url?.path == "/v1/models/benchmarks")
            #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
            return answer(
                request, status: 200,
                body: #"""
                    {"fetchedAt":1800000000000,"models":[
                    {"id":"claude-opus","name":"Claude Opus","provider":"claude","legacy":false,
                     "points":[{"effort":"low","intelligence":61.5,"costPerTask":0.12}]},
                    {"id":"gpt-old","name":"GPT Old","provider":"codex","legacy":true,"points":[]}]}
                    """#)
        })
        let result = try await client.modelBenchmarks()
        #expect(result.fetchedAt == 1_800_000_000_000)
        #expect(result.models.map(\.id) == ["claude-opus", "gpt-old"])
        #expect(result.models[0].points == [BenchmarkPoint(effort: "low", intelligence: 61.5, costPerTask: 0.12)])
        #expect(result.models[1].legacy)
    }

    @Test func noBenchmarksYetComesBackAsItsOwnCode() async throws {
        let client = AddressBookClient(fetch: { request in
            answer(request, status: 503, body: #"{"error":{"code":"no-benchmarks","message":"Not yet"}}"#)
        })
        do {
            _ = try await client.modelBenchmarks()
            Issue.record("Expected the request to fail")
        } catch let error as AddressBookRequestError {
            #expect(error.code == "no-benchmarks")
            #expect(error.status == 503)
        }
    }

    @Test func aModelOutsideTheSchemaIsRejected() async throws {
        let client = AddressBookClient(fetch: { request in
            answer(request, status: 200, body: #"{"fetchedAt":1,"models":[{"id":"x"}]}"#)
        })
        await #expect(throws: AddressBookRequestError.self) { try await client.modelBenchmarks() }
    }
}
