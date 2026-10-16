import MeridianProtos
import SwiftUI

private struct MeridianThemeKey: EnvironmentKey {
    static let defaultValue: Meridian_Theme_V1_Theme? = nil
}

extension EnvironmentValues {
    var meridianTheme: Meridian_Theme_V1_Theme? {
        get { self[MeridianThemeKey.self] }
        set { self[MeridianThemeKey.self] = newValue }
    }
}

public extension View {
    /// No network font fetches or fixed pixel typography. Native semantic fonts
    /// retain platform accessibility scaling. Full font mapping is still pending.
    func meridianTheme(_ theme: Meridian_Theme_V1_Theme) -> some View {
        environment(\.meridianTheme, theme)
    }
}

struct MeridianSurface: ViewModifier {
    @Environment(\.meridianTheme) private var theme
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        let palette = Self.palette(theme, dark: scheme == .dark)
        content
            .foregroundStyle(Self.color(palette?.fg) ?? .primary)
            .tint(Self.color(palette?.accent) ?? .accentColor)
            .background(Self.color(palette?.surface) ?? .clear)
    }

    static func palette(_ theme: Meridian_Theme_V1_Theme?, dark: Bool) -> Meridian_Theme_V1_Palette? {
        guard let theme else { return nil }
        if dark && theme.hasDark { return theme.dark }
        return theme.hasLight ? theme.light : nil
    }

    static func rgba(_ text: String?) -> (Double, Double, Double, Double)? {
        guard let text, text.first == "#", text.count == 7 || text.count == 9,
              text.dropFirst().allSatisfy({ $0.isASCII && $0.isHexDigit }),
              let value = UInt32(text.dropFirst(), radix: 16) else { return nil }
        let rgba = text.count == 7 ? (value << 8) | 255 : value
        return (Double((rgba >> 24) & 255) / 255, Double((rgba >> 16) & 255) / 255,
                Double((rgba >> 8) & 255) / 255, Double(rgba & 255) / 255)
    }

    static func color(_ text: String?) -> Color? {
        guard let (r, g, b, a) = rgba(text) else { return nil }
        return Color(.sRGB, red: r, green: g, blue: b, opacity: a)
    }
}
