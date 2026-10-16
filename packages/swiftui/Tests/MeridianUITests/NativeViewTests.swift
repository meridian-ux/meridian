import AppKit
import SwiftUI
import XCTest
@testable import MeridianUI

@MainActor
final class NativeViewTests: XCTestCase {
    func testEveryFixtureConstructsAndLaysOutWithoutHostEffects() throws {
        var calls = 0
        let host = MeridianHost(admit: { _ in calls += 1; return .allow },
                                execute: { _ in calls += 1 })
        for (name, panel) in try SchemaTests.fixtures() {
            let view = NSHostingView(rootView: MeridianPanel(panel, host: host))
            view.frame = NSRect(x: 0, y: 0, width: 640, height: 480)
            view.layoutSubtreeIfNeeded()
            XCTAssertGreaterThan(view.fittingSize.height, 0, name)
        }
        XCTAssertEqual(calls, 0)
    }

    func testChoiceDefaultUsesOnlyAnExistingID() {
        var panel = Meridian_Ui_V1_ChoicePanel()
        XCTAssertEqual(ChoiceContent.initialSelection(panel), "")
        var first = Meridian_Ui_V1_ChoiceOption()
        first.id = "first"
        var second = first
        second.id = "second"
        panel.options = [first, second]
        panel.defaultOptionID = "missing"
        XCTAssertEqual(ChoiceContent.initialSelection(panel), "first")
        panel.defaultOptionID = "second"
        XCTAssertEqual(ChoiceContent.initialSelection(panel), "second")
    }

    func testThemePresenceAndStrictHex() {
        XCTAssertNil(MeridianSurface.palette(nil, dark: false))
        var theme = Meridian_Theme_V1_Theme()
        theme.light.fg = "#123456"
        XCTAssertEqual(MeridianSurface.palette(theme, dark: true)?.fg, "#123456")
        theme.dark.fg = "#abcdef"
        XCTAssertEqual(MeridianSurface.palette(theme, dark: true)?.fg, "#abcdef")
        XCTAssertEqual(MeridianSurface.rgba("#ff000080")?.0, 1)
        XCTAssertEqual(MeridianSurface.rgba("#ff000080")?.3, 128.0 / 255.0)
        XCTAssertEqual(MeridianSurface.rgba("#000000")?.3, 1)
        for invalid in ["red", "#abc", " #123456", "#123456\n", "#gg0000", "#0000000000"] {
            XCTAssertNil(MeridianSurface.rgba(invalid), invalid)
        }
    }
}
