import Foundation
import RuimtePulsar

@main
enum ChatHistoryBenchmark {
    static func main() throws {
        let values = (0..<2871).map { index in
            JSONValue.object([
                "id": .string("m\(index)"), "kind": .string("assistant"),
                "text": .string(String(repeating: "output ", count: 900)),
            ])
        }
        print("dataset\titems\tbytes\titerations\tmedian_ms\tmin_ms\tmax_ms")
        for (name, items) in [("full", values), ("page", Array(values.suffix(60)))] {
            let data = try JSONValue.array(items).encoded()
            for _ in 0..<2 { try decode(data, expectedCount: items.count) }
            var samples: [Double] = []
            for _ in 0..<10 {
                let elapsed = try ContinuousClock().measure { try decode(data, expectedCount: items.count) }
                let parts = elapsed.components
                samples.append(Double(parts.seconds) * 1000 + Double(parts.attoseconds) / 1e15)
            }
            samples.sort()
            let median = (samples[4] + samples[5]) / 2
            let times = [median, samples[0], samples[9]].map { String(format: "%.3f", $0) }.joined(separator: "\t")
            print("\(name)\t\(items.count)\t\(data.count)\t\(samples.count)\t\(times)")
        }
    }

    private static func decode(_ data: Data, expectedCount: Int) throws {
        guard try JSONValue.decode(data).arrayValue?.count == expectedCount else {
            throw DecodeFailure.unexpectedCount
        }
    }

    private enum DecodeFailure: Error {
        case unexpectedCount
    }
}
