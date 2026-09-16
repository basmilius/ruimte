import XCTest

@testable import Ruimte

final class LastProjectTests: XCTestCase {
    private func defaults() -> UserDefaults {
        let name = "LastProjectTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return defaults
    }

    func testNothingIsRememberedOnAFreshDevice() {
        XCTAssertNil(LastProject.read(from: defaults()))
    }

    func testTheLatestProjectReplacesTheOneBefore() {
        let store = defaults()
        LastProject.remember(machineID: "machine-a", projectID: "one", in: store)
        LastProject.remember(machineID: "machine-b", projectID: "two", in: store)
        XCTAssertEqual(LastProject.read(from: store), LastProject(machineID: "machine-b", projectID: "two"))
    }

    func testLeavingAProjectForgetsIt() {
        let store = defaults()
        LastProject.remember(machineID: "machine-a", projectID: "one", in: store)
        LastProject.forget(in: store)
        XCTAssertNil(LastProject.read(from: store))
    }

    func testAnUnreadableValueIsIgnored() {
        let store = defaults()
        store.set(Data("not json".utf8), forKey: LastProject.storageKey)
        XCTAssertNil(LastProject.read(from: store))
    }
}
