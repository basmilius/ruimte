import Testing

@testable import RuimteTransport

@MainActor struct RevSaveTests {
    private let conflict = MachineClientError.server(code: "rev-conflict", message: "Moved on")

    /// Fails with a conflict a number of times, then writes.
    private final class Machine {
        var conflicts: Int
        var sent = 0
        init(conflicts: Int) { self.conflicts = conflicts }

        func write() throws -> Int {
            sent += 1
            if conflicts > 0 {
                conflicts -= 1
                throw MachineClientError.server(code: "rev-conflict", message: "Moved on")
            }
            return sent
        }
    }

    @Test func aWriteThatLandsIsSaved() async {
        var save = RevSave()
        let machine = Machine(conflicts: 0)
        guard case .saved(let sent) = await save.send({ try machine.write() }) else {
            Issue.record("not saved")
            return
        }
        #expect(sent == 1)
    }

    @Test func aConflictReloadsAndSendsAgain() async {
        var save = RevSave()
        let machine = Machine(conflicts: 1)
        var reloads = 0
        let outcome = await save.send({ try machine.write() }, reload: { reloads += 1; return true })
        guard case .saved = outcome else {
            Issue.record("not saved")
            return
        }
        #expect(reloads == 1)
        #expect(machine.sent == 2)
    }

    @Test func theThirdConflictSurfaces() async {
        var save = RevSave()
        let machine = Machine(conflicts: 3)
        var reloads = 0
        let outcome = await save.send({ try machine.write() }, reload: { reloads += 1; return true })
        guard case .conflict(let error) = outcome else {
            Issue.record("not a conflict")
            return
        }
        #expect(error as? MachineClientError == conflict)
        #expect(reloads == RevSave.retries)
        #expect(machine.sent == 3)
    }

    @Test func theRetriesAreCountedAcrossSendsOfOneValue() async {
        var save = RevSave()
        let machine = Machine(conflicts: 2)
        _ = await save.send({ try machine.write() }, reload: { true })
        machine.conflicts = 1
        let outcome = await save.send({ try machine.write() }, reload: { true })
        guard case .conflict = outcome else {
            Issue.record("not a conflict")
            return
        }
    }

    @Test func aReloadWithNothingNewerSurfacesTheConflict() async {
        var save = RevSave()
        let machine = Machine(conflicts: 1)
        let outcome = await save.send({ try machine.write() }, reload: { false })
        guard case .conflict = outcome else {
            Issue.record("not a conflict")
            return
        }
        #expect(machine.sent == 1)
    }

    @Test func withoutAReloadTheFirstConflictSurfaces() async {
        var save = RevSave()
        let machine = Machine(conflicts: 1)
        guard case .conflict = await save.send({ try machine.write() }) else {
            Issue.record("not a conflict")
            return
        }
        #expect(machine.sent == 1)
    }

    @Test func anotherRefusalIsNeitherReloadedNorRetried() async {
        var save = RevSave()
        var reloads = 0
        let outcome: RevSave.Outcome<Int> = await save.send(
            { throw MachineClientError.server(code: "invalid", message: "No") }, reload: { reloads += 1; return true })
        guard case .failed = outcome else {
            Issue.record("not failed")
            return
        }
        #expect(reloads == 0)
    }
}
