import Foundation
import MeridianCoreFFI
import MeridianProtos

public enum MeridianCoreError: Error, Equatable {
    case incompatibleABI
    case nativeStatus(Int32)
}

/// Native calls always execute the actual Rust kernel from the static package.
/// There is no Swift formatter or Foundation-regex substitute.
public enum MeridianCore {
    public static func format(
        _ value: Google_Protobuf_Value, display: Meridian_Ui_V1_ValueDisplay,
        nowMilliseconds: Double? = nil
    ) throws -> Meridian_Ui_V1_FormattedValue {
        guard meridian_core_abi_version() == MERIDIAN_CORE_ABI_VERSION else {
            throw MeridianCoreError.incompatibleABI
        }
        let declaration = try display.serializedData()
        let input = try value.serializedData()
        var output: UnsafeMutablePointer<UInt8>?
        var count = 0
        let status = declaration.withUnsafeBytes { declarationBytes in
            input.withUnsafeBytes { inputBytes in
                meridian_core_format_value(
                    declarationBytes.bindMemory(to: UInt8.self).baseAddress, declarationBytes.count,
                    inputBytes.bindMemory(to: UInt8.self).baseAddress, inputBytes.count,
                    nowMilliseconds == nil ? 0 : 1, nowMilliseconds ?? 0, &output, &count
                )
            }
        }
        defer { meridian_core_buffer_free(output, count) }
        guard status == 0, let output else { throw MeridianCoreError.nativeStatus(status) }
        return try Meridian_Ui_V1_FormattedValue(serializedBytes: Data(bytes: output, count: count))
    }

    /// Pure computation over already admitted data, not a fetch capability.
    public static func computeStat(
        _ panel: Meridian_Ui_V1_StatPanel, response: Google_Protobuf_Value? = nil
    ) throws -> Meridian_Ui_V1_ComputedStat {
        guard meridian_core_abi_version() == MERIDIAN_CORE_ABI_VERSION else {
            throw MeridianCoreError.incompatibleABI
        }
        let declaration = try panel.serializedData()
        let input = try response?.serializedData() ?? Data()
        var output: UnsafeMutablePointer<UInt8>?
        var count = 0
        let status = declaration.withUnsafeBytes { declarationBytes in
            input.withUnsafeBytes { inputBytes in
                meridian_core_compute_stat(
                    declarationBytes.bindMemory(to: UInt8.self).baseAddress, declarationBytes.count,
                    response == nil ? 0 : 1,
                    inputBytes.bindMemory(to: UInt8.self).baseAddress, inputBytes.count, &output, &count
                )
            }
        }
        defer { meridian_core_buffer_free(output, count) }
        guard status == 0, let output else { throw MeridianCoreError.nativeStatus(status) }
        return try Meridian_Ui_V1_ComputedStat(serializedBytes: Data(bytes: output, count: count))
    }

    public static func matchesFormPattern(_ pattern: String, value: String) throws -> Bool {
        guard meridian_core_abi_version() == MERIDIAN_CORE_ABI_VERSION else {
            throw MeridianCoreError.incompatibleABI
        }
        let expression = Array(pattern.utf8), input = Array(value.utf8)
        var matched: UInt8 = 0
        let status = expression.withUnsafeBufferPointer { expression in
            input.withUnsafeBufferPointer { input in
                meridian_core_matches_form_pattern(
                    expression.baseAddress, expression.count, input.baseAddress, input.count, &matched
                )
            }
        }
        guard status == 0 else { throw MeridianCoreError.nativeStatus(status) }
        return matched != 0
    }
}
