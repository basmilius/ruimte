import ComputerUseCore
import Darwin
import Foundation
import Testing

/// Two connected ends of a stream socket, closed with the value.
private final class SocketPair: Sendable {
    let server: Int32
    let client: Int32

    init() {
        var ends: [Int32] = [-1, -1]
        socketpair(AF_UNIX, SOCK_STREAM, 0, &ends)
        server = ends[0]
        client = ends[1]
        UnixSocket.disableSigpipe(server)
        UnixSocket.disableSigpipe(client)
    }

    deinit {
        close(server)
        close(client)
    }
}

struct UnixSocketTests {
    @Test func readsARequestUpToTheHalfClose() {
        let pair = SocketPair()
        UnixSocket.writeAll(pair.client, Data("hello".utf8))
        shutdown(pair.client, SHUT_WR)
        #expect(UnixSocket.readAll(pair.server, maxBytes: 5, until: .now + .seconds(5)) == .complete(Data("hello".utf8)))
    }

    @Test func readsTheAnswerAfterItsOwnHalfClose() {
        let pair = SocketPair()
        UnixSocket.writeAll(pair.client, Data("request".utf8))
        shutdown(pair.client, SHUT_WR)
        UnixSocket.writeAll(pair.server, Data("answer".utf8))
        shutdown(pair.server, SHUT_WR)
        #expect(UnixSocket.readAll(pair.client, maxBytes: 64, until: .now + .seconds(5)) == .complete(Data("answer".utf8)))
    }

    @Test func refusesARequestPastItsLimitBeforeItEnds() {
        let pair = SocketPair()
        UnixSocket.writeAll(pair.client, Data(count: 6))
        #expect(UnixSocket.readAll(pair.server, maxBytes: 5, until: .now + .seconds(5)) == .tooLarge)
    }

    @Test func aPeerThatKeepsSendingAByteAtATimeRunsOutOfTime() async {
        let pair = SocketPair()
        let writer = Task.detached {
            while !Task.isCancelled {
                guard UnixSocket.writeAll(pair.client, Data([1])) else { return }
                try? await Task.sleep(for: .milliseconds(20))
            }
        }
        defer { writer.cancel() }
        let started = ContinuousClock.now
        #expect(UnixSocket.readAll(pair.server, maxBytes: 1024, until: .now + .milliseconds(300)) == .timedOut)
        #expect(started.duration(to: .now) < .seconds(3))
    }

    @Test func aDeadlineThatPassedReadsNothing() {
        let pair = SocketPair()
        UnixSocket.writeAll(pair.client, Data("late".utf8))
        shutdown(pair.client, SHUT_WR)
        #expect(UnixSocket.readAll(pair.server, maxBytes: 1024, until: .now - .seconds(1)) == .timedOut)
    }

    @Test func anAnswerToAPeerThatStoppedReadingGivesUpAtItsDeadline() {
        let pair = SocketPair()
        #expect(!UnixSocket.writeAll(pair.server, Data(count: 16 * 1024 * 1024), until: .now + .milliseconds(200)))
    }

    @Test func anAnswerToAPeerThatReadsArrivesWhole() {
        let pair = SocketPair()
        let answer = Data((0..<300_000).map { UInt8($0 % 251) })
        let writer = Thread {
            _ = UnixSocket.writeAll(pair.server, answer, until: .now + .seconds(5))
            shutdown(pair.server, SHUT_WR)
        }
        writer.start()
        #expect(UnixSocket.readAll(pair.client, maxBytes: answer.count, until: .now + .seconds(5)) == .complete(answer))
    }
}
