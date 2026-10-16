import MeridianConformance
import XCTest
@testable import MeridianUI

final class CoreTests: XCTestCase {
    static func corpus() throws -> Meridian_Conformance_CoreCorpus {
        let path = SchemaTests.root.appendingPathComponent("schemas/conformance/core.json")
        return try Meridian_Conformance_CoreCorpus(jsonUTF8Data: Data(contentsOf: path))
    }

    func testRealRustFormatterMatchesEverySharedGolden() throws {
        let cases = try Self.corpus().valueFormats
        XCTAssertEqual(cases.count, 355)
        XCTAssertEqual(cases.filter { $0.hasNowMs }.count, 133)
        XCTAssertEqual(cases.filter { $0.name.hasPrefix("no-clock-") }.count, 133)
        for test in cases {
            let display = try Meridian_Ui_V1_ValueDisplay(serializedBytes: test.display)
            let expected = try Meridian_Ui_V1_FormattedValue(serializedBytes: test.expected)
            let result = try MeridianCore.format(test.input, display: display,
                nowMilliseconds: test.hasNowMs ? test.nowMs : nil)
            XCTAssertEqual(result, expected, test.name)
        }
    }

    func testRealRustUnicodeRegexContract() throws {
        let cases = try Self.corpus().formPatterns
        XCTAssertEqual(cases.count, 16)
        for test in cases {
            if test.validPattern {
                XCTAssertEqual(try MeridianCore.matchesFormPattern(test.pattern, value: test.input),
                               test.matches, test.name)
            } else {
                XCTAssertThrowsError(try MeridianCore.matchesFormPattern(test.pattern, value: test.input), test.name)
            }
        }
        XCTAssertTrue(try MeridianCore.matchesFormPattern("a\\x00b", value: "a\0b"))
    }

    func testBridgeRejectsOversizedInputAndNonJSONNumbers() throws {
        var input = Google_Protobuf_Value()
        input.stringValue = String(repeating: "x", count: 1024 * 1024)
        XCTAssertThrowsError(try MeridianCore.format(input, display: .init())) { error in
            XCTAssertEqual(error as? MeridianCoreError, .nativeStatus(3))
        }
        input.numberValue = .nan
        XCTAssertThrowsError(try MeridianCore.format(input, display: .init())) { error in
            XCTAssertEqual(error as? MeridianCoreError, .nativeStatus(2))
        }
    }
}
