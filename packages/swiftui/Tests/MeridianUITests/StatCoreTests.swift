import XCTest
@testable import MeridianUI

final class StatCoreTests: XCTestCase {
    func testActualRustStatKernelPreservesZeroPreviousAndHonestTone() throws {
        var panel = Meridian_Ui_V1_StatPanel()
        panel.value = 12
        panel.previous = 0
        panel.unit = "ms"
        panel.series = [0, 12]
        var result = try MeridianCore.computeStat(panel)
        XCTAssertEqual(result.formattedValue, "12 ms")
        XCTAssertEqual(result.formattedDelta, "+12")
        XCTAssertTrue(result.hasFormattedDelta)
        XCTAssertEqual(result.trend, .up)
        XCTAssertEqual(result.tone, .neutral)
        XCTAssertEqual(result.series, [0, 12])
        panel.higherIsBetter = false
        result = try MeridianCore.computeStat(panel)
        XCTAssertEqual(result.tone, .danger)
        panel.higherIsBetter = true
        XCTAssertEqual(try MeridianCore.computeStat(panel).tone, .success)
    }

    func testResponseUsesDottedPathsAndServerLabelWithoutTrustingDirection() throws {
        var panel = Meridian_Ui_V1_StatPanel()
        panel.value = 7
        panel.previous = 3
        panel.valueField = "metric.current"
        panel.previousField = "metric.prior"
        panel.displayField = "shown"
        panel.higherIsBetter = true
        let response = try Google_Protobuf_Value(jsonString: #"{"metric":{"current":0,"prior":2},"shown":"Server amount","trend":"up"}"#)
        let result = try MeridianCore.computeStat(panel, response: response)
        XCTAssertEqual(result.formattedValue, "Server amount")
        XCTAssertEqual(result.formattedDelta, "-2")
        XCTAssertEqual(result.trend, .down)
        XCTAssertEqual(result.tone, .danger)
        XCTAssertEqual(panel.value, 7)
    }

    func testSeriesFallbackAndEmptyOverrideKeepPresence() throws {
        var panel = Meridian_Ui_V1_StatPanel()
        XCTAssertFalse(try MeridianCore.computeStat(panel).hasFormattedDelta)
        panel.series = [10, 4]
        var result = try MeridianCore.computeStat(panel)
        XCTAssertEqual(result.formattedDelta, "-6")
        XCTAssertEqual(result.trend, .down)
        panel.deltaOverride = ""
        result = try MeridianCore.computeStat(panel)
        XCTAssertTrue(result.hasFormattedDelta)
        XCTAssertEqual(result.formattedDelta, "")
        panel.trendOverride = .flat
        XCTAssertEqual(try MeridianCore.computeStat(panel).trend, .flat)
    }

    func testNumericDisplayUsesCoreAndNonnumericRetainsLegacy() throws {
        var panel = Meridian_Ui_V1_StatPanel()
        panel.value = 1234.6
        panel.format = .currency
        panel.valueDisplay.type = .integer
        // Even INTEGER preserves raw precision unless explicitly declared.
        XCTAssertEqual(try MeridianCore.computeStat(panel).formattedValue, "1,234.6")
        panel.valueDisplay.number.fractionDigits = 0
        XCTAssertEqual(try MeridianCore.computeStat(panel).formattedValue, "1,235")
        panel.valueDisplay.type = .text
        XCTAssertEqual(try MeridianCore.computeStat(panel).formattedValue, "$1,234.60")
    }

    func testLimitsAndNonfiniteDynamicResponseFailWithoutEcho() throws {
        var panel = Meridian_Ui_V1_StatPanel()
        panel.caption = String(repeating: "x", count: 1024 * 1024 + 1)
        XCTAssertThrowsError(try MeridianCore.computeStat(panel)) {
            XCTAssertEqual($0 as? MeridianCoreError, .nativeStatus(3))
        }
        var response = Google_Protobuf_Value()
        response.numberValue = .infinity
        XCTAssertThrowsError(try MeridianCore.computeStat(.init(), response: response)) {
            XCTAssertEqual($0 as? MeridianCoreError, .nativeStatus(2))
        }
    }
}
