//! Pure invocation predicates, never policy or a host capability.
use crate::{proto::RowFilter, ProtoPaths};
use serde_json::Value;

// Existing browser RowFilter String(value) semantics, not localized display.
// Callers must check the shared value size/depth budget first.
fn append_fragment(text: &str, output: &mut String) -> Result<(), crate::RenderLimitExceeded> {
    if output.len().saturating_add(text.len()) > 4 * 1024 * 1024 {
        return Err(crate::RenderLimitExceeded);
    }
    output.push_str(text);
    Ok(())
}

fn append_text(value: &Value, output: &mut String) -> Result<(), crate::RenderLimitExceeded> {
    match value {
        Value::Null => Ok(()),
        Value::String(value) => append_fragment(value, output),
        Value::Bool(value) => append_fragment(if *value { "true" } else { "false" }, output),
        Value::Number(value) => {
            let number = value.as_f64().unwrap_or(f64::NAN);
            let text = if number == 0.0 {
                "0".into()
            } else if number.abs() >= 1e21 || number.abs() < 1e-6 {
                let formatted = format!("{number:e}");
                let (digits, exponent) = formatted.split_once('e').unwrap();
                let exponent: i32 = exponent.parse().unwrap();
                format!(
                    "{digits}e{}{exponent}",
                    if exponent >= 0 { "+" } else { "" }
                )
            } else {
                number.to_string()
            };
            append_fragment(&text, output)
        }
        Value::Array(values) => {
            for (index, value) in values.iter().enumerate() {
                if index != 0 {
                    append_fragment(",", output)?;
                }
                append_text(value, output)?;
            }
            Ok(())
        }
        // JSON data cannot install a callable toString/valueOf. An own
        // noncallable toString shadows the inherited function and JS String()
        // throws; treating it as an ordinary object would enable a denied row.
        Value::Object(values) if values.contains_key("toString") => Err(crate::RenderLimitExceeded),
        Value::Object(_) => append_fragment("[object Object]", output),
    }
}

fn scalar_text(value: &Value) -> Result<String, crate::RenderLimitExceeded> {
    let mut output = String::new();
    append_text(value, &mut output)?;
    Ok(output)
}

/// Missing/null fields never match; Unicode comparison does not normalize IDs.
pub fn row_filter_matches(
    filter: &RowFilter,
    row: &Value,
) -> Result<bool, crate::RenderLimitExceeded> {
    crate::admit_formatted_value(row)?;
    if filter.field_path.is_empty()
        || filter.field_path.len() > 64 * 1024
        || filter.equals.len() > 64 * 1024
        || filter.field_path.split('.').count() > 64
    {
        return Ok(false);
    }
    let value = ProtoPaths::get(row, &filter.field_path);
    Ok(!value.is_null() && scalar_text(value)? == filter.equals)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn scalar_and_compound_values_keep_browser_string_semantics() {
        for (value, expected) in [
            (json!(""), ""),
            (json!(false), "false"),
            (json!(1.0), "1"),
            (json!(-0.0), "0"),
            (json!(0.000001), "0.000001"),
            (json!(0.0000001), "1e-7"),
            (json!(1e21), "1e+21"),
            (json!([1, null, [false, "raw"]]), "1,,false,raw"),
            (json!({"value": "not exposed"}), "[object Object]"),
        ] {
            let filter = RowFilter {
                field_path: "nested.value".into(),
                equals: expected.into(),
            };
            assert!(row_filter_matches(&filter, &json!({"nested": {"value": value}})).unwrap());
        }
    }

    #[test]
    fn missing_null_and_unicode_normalization_cannot_enable_an_action() {
        let mut filter = RowFilter {
            field_path: "value".into(),
            equals: "".into(),
        };
        assert!(!row_filter_matches(&filter, &json!({})).unwrap());
        assert!(!row_filter_matches(&filter, &json!({"value": null})).unwrap());
        filter.equals = "é".into();
        assert!(!row_filter_matches(&filter, &json!({"value": "e\u{301}"})).unwrap());
        assert!(row_filter_matches(&filter, &json!({"value": "é"})).unwrap());
    }

    #[test]
    fn excessive_work_and_invalid_paths_fail_closed() {
        let filter = RowFilter {
            field_path: "value".into(),
            equals: "".into(),
        };
        assert!(
            row_filter_matches(&filter, &json!({"value": "x".repeat(8 * 1024 * 1024)})).is_err()
        );
        assert!(!row_filter_matches(&RowFilter::default(), &json!({})).unwrap());
    }

    // Frozen expected strings produced by the JavaScript Number/String runtime
    // from deterministic IEEE-754 bit patterns; no locale or clock is involved.
    #[test]
    fn numeric_predicates_match_independent_javascript_number_strings() {
        for (bits, expected) in [
            (0xdc1b77ae0bf34dad, "-4.9911105725155504e+135"),
            (0x64f0eeb9026e6076, "1.715373926431966e+178"),
            (0x7b07ce91e5906136, "4.4251604027143375e+284"),
            (0x305f050c368dcc74, "1.0715660391465826e-75"),
            (0x2ceb16e0a1c54aec, "2.5973481493288907e-92"),
            (0x97101dce4e7bfb79, "-1.3475090132806154e-197"),
            (0x9ad2e144d6e8f2cf, "-1.81996730402717e-179"),
            (0xd9aa792e1af470ea, "-8.750186241947517e+123"),
            (0xddaa4e85b0d6e28b, "-1.603964615428183e+143"),
            (0x8f8ea9d349428d8e, "-9.643915712060552e-234"),
            (0x08f474ffb8e8ab15, "1.5860846119992697e-265"),
            (0x2ead854756d71f03, "7.597954524892738e-84"),
            (0x55bc79f8ada711fd, "1.0204796945730538e+105"),
            (0x0e1fc49bd63b809e, "1.1910593176322935e-240"),
            (0xb92199e83f5a101f, "-1.694933913128696e-33"),
            (0xc5765079fc5d43ff, "-4.3162252145519944e+26"),
            (0x353cfc387dfae6b8, "3.0261999441573203e-52"),
            (0xa32edabf5585bd75, "-3.238696681491661e-139"),
            (0xfc5639b16b714b4f, "-8.663725837306241e+290"),
            (0x92fb2dcfc8ae9a19, "-3.0797526843217145e-217"),
            (0x544b0ec76d00616d, "1.15589923121874e+98"),
            (0xbcbb9b7e9a319aef, "-3.831296467316889e-16"),
            (0x0f1a50d59c0aa21a, "6.466053826432699e-236"),
            (0x80ae2120826571de, "-2.1452846540129615e-305"),
            (0x0e1ecd02ed7c0cbd, "1.1547975125429853e-240"),
            (0x0d0981e8c1fa7be4, "7.296267179458751e-246"),
            (0xdc86b3d3cdbdf613, "-5.2803264785067434e+137"),
            (0x6d0844c269e7693f, "1.6732138965686944e+217"),
            (0x3681da7f6993082d, "3.909076791246025e-46"),
            (0x5b928e2c987d857d, "1.3170664051174186e+133"),
            (0x6c716e1e6ced8137, "2.347135155778617e+214"),
            (0xccb870213498f7f5, "-3.92703626520675e+61"),
            (0x9f07b27a78869b5a, "-3.3710794864173703e-159"),
            (0xb0ba91e47f6200ec, "-5.874229071700385e-74"),
            (0xc72b4c36d0db7fed, "-7.086891063466728e+34"),
            (0x35f305b0c0fc9252, "8.134710481112139e-49"),
            (0x7ac78fb373ffbff6, "2.7371952383912e+283"),
            (0x8e39b81de71b7d09, "-3.857101171397437e-240"),
            (0x59a69ba126cd29b3, "7.472552783215012e+123"),
            (0xbfcbffff0cbcbf20, "-0.21874988672197393"),
            (0x2d1ce28856d20e5e, "2.215603731797175e-91"),
            (0x572a15ed48b3fdc2, "7.841697833625344e+111"),
            (0x32b911499417aab9, "2.3803041954013153e-64"),
            (0x17a8ec88e0da0bac, "1.0669643833474769e-194"),
            (0x0cc88eab2f9ad4bb, "4.3902997915267284e-247"),
            (0xbc3a5b419a43afd2, "-1.4287870889761718e-18"),
            (0x6f0f3414c47c9c0d, "9.239942182940311e+226"),
            (0xe71a7567edb8c675, "-4.6049449625872434e+188"),
            (0x63674cf841ee8ab9, "7.034866163903114e+170"),
            (0xe375837da840d9ec, "-1.2990664698521692e+171"),
            (0x578eb22e1ea5a35f, "5.905686629582816e+113"),
            (0x4efa582ee029dfd9, "2.9091650704676072e+72"),
            (0xf3b363e938295a26, "-2.1692042628035588e+249"),
            (0x2e3a4ef3496f4112, "5.2900001119406624e-86"),
            (0xb809d78e2a2f9b10, "-9.49285634690637e-39"),
            (0x46217f104eb30026, "6.93101536724741e+29"),
            (0x8947b5fefda6afa6, "-5.882775229507853e-264"),
            (0x4a3ae29b2af0cb79, "3.9292734840969675e+49"),
            (0xbfd0273b10a6d4af, "-0.2523944532980051"),
            (0xed0a00eb302b52c6, "-1.7928344098460697e+217"),
            (0x3c0a45ad6d0175e3, "1.7802719962921167e-19"),
            (0x5bec25a986aa6fc8, "6.393254796400403e+134"),
            (0x904bc2dda0ebc917, "-3.576279648101772e-230"),
            (0x459ae6d82ef0bb45, "2.0814210227308495e+27"),
            (0xd8f30b16630d2b73, "-3.0734116139155754e+120"),
            (0x7110b72632258de5, "4.251812196359382e+236"),
            (0x543b14bc79e21fbe, "5.7844666878803994e+97"),
            (0xb3afb674d263f401, "-9.867437071726851e-60"),
            (0x992a5514fae813a9, "-1.891221305366931e-187"),
            (0x65950d0578f009ce, "2.18377227571136e+181"),
            (0x5703572bfb805a5d, "1.4535047277321816e+111"),
            (0xf58b6a5f9c786da9, "-1.6465799069278203e+258"),
            (0xa837793e9e8ad732, "-5.957466131998648e-115"),
            (0x50eabc7287dc4e1c, "6.340262899598194e+81"),
            (0x4dca1d57ff03f180, "5.500381791581099e+66"),
            (0x4899ff11c2f79663, "5.661506902655086e+41"),
            (0x16166c76ad45818f, "2.860815981281152e-202"),
            (0xcb74ca30b3d6894c, "-3.186028444038842e+55"),
            (0x217355871886f75e, "1.5120492207884386e-147"),
            (0x28a1e2393381ed30, "5.809632407259761e-113"),
            (0x074c31b6d9efa2ea, "1.6286721492574822e-273"),
            (0xbec4688d35b7872f, "-0.0000024328714240831068"),
            (0xf8fd0016351ac3e1, "-6.275367084072634e+274"),
            (0x2a3e36405bf02e26, "3.29321318659287e-105"),
            (0x4fa794552d7c87fa, "5.332638378877033e+75"),
            (0x6b65fa68c812c075, "2.2579710060776677e+209"),
            (0xb0d838d4f45658b5, "-2.1420571626728534e-73"),
            (0xf088256e71b67944, "-1.1995980149915995e+234"),
            (0xb4d1bf49868fc4b6, "-2.89514964136048e-54"),
            (0x7f30634d239b36bf, "4.495301479005006e+304"),
            (0x9adf073ca7e24f12, "-2.9910257010919965e-179"),
            (0xbf023d5f71c40f0c, "-0.00003478953860461099"),
            (0xf8daff4ab7e1c412, "-1.4604790788453035e+274"),
            (0x3bb60a1f6449431a, "4.667054448216033e-21"),
            (0xe1b6cc3fce8a571c, "-5.128277780879042e+162"),
            (0x974be547500504b2, "-1.865902080785903e-196"),
            (0x788637bdbb04623b, "3.756003170106989e+272"),
            (0x78b479878553843f, "2.769071305261943e+273"),
            (0xf614dc4037d1ccf7, "-6.414723702314457e+260"),
            (0xab5917a81f0fb2ae, "-7.17007679825171e-100"),
            (0x107db970f61ec64b, "3.063346448760151e-229"),
            (0xa7e591e85a840907, "-1.7107275877582857e-116"),
            (0x42e87faaebb9a0d5, "215492859907334.66"),
            (0x7cb7d0a0e9b446d4, "5.941355978696207e+292"),
            (0x93b411557b1e1b59, "-9.314100426966256e-214"),
            (0x17282941775bd12f, "4.040271440024106e-197"),
            (0x1d6eb56cc3fecd4d, "6.5095912305809035e-167"),
            (0x9cc6d38ebb4dc397, "-4.725304702312625e-170"),
            (0x93e7f09c76995dd0, "-8.889046505961924e-213"),
            (0x40481181f54f1b6b, "48.13677851069118"),
            (0xfc10536a39343f9d, "-3.977510832916913e+289"),
            (0x2b59a11006fe10a2, "7.323449055534529e-100"),
            (0xb25de04b53658403, "-4.43267188156626e-66"),
            (0x482f7b77f3b42fcb, "5.3564356221290984e+39"),
            (0xaa19ef48de09d554, "-7.067451838786451e-106"),
            (0xbc1efbb4d09613fe, "-4.199010356643058e-19"),
            (0x01640cfd5e7e0059, "5.847695999398785e-302"),
            (0x2103a6ef6f7bca19, "1.2007177480205567e-149"),
            (0xba59dbbf218e9bcd, "-1.3055148249443392e-27"),
            (0x47cfbdd44466d5ba, "8.43834345315447e+37"),
            (0x0f7180ea42ce3691, "2.752517763735277e-234"),
            (0x1d57d70abe6c2ebc, "2.526788028536205e-167"),
            (0x3df4865f060ed9e1, "2.9867642218664106e-10"),
            (0x9cc2d942d8ac9c12, "-3.9018746502228826e-170"),
            (0x68c29c22e6ec81aa, "4.347217825559248e+196"),
            (0xa1cd5d166c667229, "-7.348551753937433e-146"),
            (0x950c6175be7d148d, "-2.762460922630013e-207"),
            (0x3f3e42bdb31d6de4, "0.0004617417463259317"),
        ] {
            assert_eq!(
                scalar_text(&serde_json::json!(f64::from_bits(bits))).unwrap(),
                expected,
                "{bits:x}"
            );
        }
    }
}
