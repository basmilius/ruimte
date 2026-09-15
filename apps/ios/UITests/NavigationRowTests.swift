import XCTest

@MainActor
final class NavigationRowTests: XCTestCase {
    func testProjectAndViewRowsRespondToTouch() throws {
        let app = XCUIApplication()
        app.launch()

        let project = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "projects.project."))
            .firstMatch
        guard project.waitForExistence(timeout: 30) else {
            throw XCTSkip("This device check needs a signed-in app with an available project.")
        }

        let machines = app.buttons["sidebar.machines"]
        if machines.exists {
            machines.tap()
            XCTAssertTrue(app.navigationBars["Machines"].waitForExistence(timeout: 5))
            app.buttons["sidebar.projects"].tap()
            XCTAssertTrue(project.waitForExistence(timeout: 5))
        }

        let recent = app.buttons["projects.recent"]
        if recent.exists {
            recent.tap()
            let navigation = app.navigationBars["Recently closed"]
            XCTAssertTrue(navigation.waitForExistence(timeout: 5))
            navigation.buttons.firstMatch.tap()
        }

        project.tap()
        let view = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "workspace.view.")).firstMatch
        XCTAssertTrue(view.waitForExistence(timeout: 20))
        let destinationID = view.identifier.replacingOccurrences(of: "workspace.view.", with: "workspace.destination.")
        view.tap()
        let destination = app.descendants(matching: .any).matching(identifier: destinationID).firstMatch
        XCTAssertTrue(destination.waitForExistence(timeout: 10), app.debugDescription)

        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "view-opened-by-touch"
        capture.lifetime = .keepAlways
        add(capture)
    }
}
