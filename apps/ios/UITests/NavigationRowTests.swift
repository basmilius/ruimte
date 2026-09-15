import XCTest

@MainActor
final class NavigationRowTests: XCTestCase {
    func testProjectAndViewRowsRespondToTouch() throws {
        let app = XCUIApplication()
        app.launch()

        let configuredProject = ProcessInfo.processInfo.environment["RUIMTE_TEST_PROJECT_ID"]
        let project =
            configuredProject.map { app.buttons["projects.project.\($0)"] }
            ?? app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "projects.project.")).firstMatch
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
        let configuredChat = ProcessInfo.processInfo.environment["RUIMTE_TEST_CHAT_ID"]
        let view =
            configuredChat.map { app.buttons["workspace.view.\($0)"] }
            ?? app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "workspace.view.")).firstMatch
        XCTAssertTrue(view.waitForExistence(timeout: 20))
        if !view.isHittable { app.swipeUp() }
        let destinationID = view.identifier.replacingOccurrences(of: "workspace.view.", with: "workspace.destination.")
        view.tap()
        let destination = app.descendants(matching: .any).matching(identifier: destinationID).firstMatch
        XCTAssertTrue(destination.waitForExistence(timeout: 10), app.debugDescription)

        if configuredChat != nil {
            let messages = app.collectionViews["chat.timeline"].cells
            XCTAssertTrue(
                messages.firstMatch.waitForExistence(timeout: 30), "The chat must render its received history.")
        }

        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "view-opened-by-touch"
        capture.lifetime = .keepAlways
        add(capture)
    }
}
