#!/usr/bin/env python3
"""Canonical composed-view wire fixtures; default verifies, --write generates."""
import argparse
import copy

from google.protobuf import json_format, text_format

if __package__:
    from .stateful_corpus import ROOT, check as check_files, classes
else:
    from stateful_corpus import ROOT, check as check_files, classes


def check(directory, expected, write=False):
    try:
        return check_files(directory, expected, write)
    except ValueError as error:
        raise ValueError(str(error).replace("tools/stateful_corpus.py", "tools/layout_corpus.py")) from error


def cases():
    def slot(name, position=0):
        return {"id": name, "title": f"Section {name}", "position": position,
                "panel": {"panelId": name, "title": f"Panel {name}",
                          "detailHeader": {"title": f"Content {name}"}}}

    result = []
    for mode in ("list", "stacked", "tabbed", "twoColumn", "unset", "unknown"):
        slots = [slot("last", 20), slot("first", -1), slot("tie-a", 5), slot("tie-b", 5), slot("header", 99)]
        slots[-1]["placement"] = {"headerRow": True, "tabLabel": "Not a body tab"}
        slots[1]["role"] = "header"  # Advisory: only placement moves a header.
        order = ["header", "first", "tie-a", "tie-b", "last"]
        tabs = []
        if mode == "twoColumn":
            slots[1]["placement"] = {"column": 2}
            slots[2]["placement"] = {"column": 999}
            order = ["header", "tie-a", "tie-b", "last", "first"]
        if mode == "tabbed":
            slots[0]["placement"] = {"tabLabel": "Later position, first tab — " + "long-label" * 12, "tabPosition": 0}
            slots[1]["placement"] = {"tabLabel": "Earlier position, second tab — " + "long-label" * 12, "tabPosition": 1}
            order = ["header", "tie-a", "tie-b", "last"]
            tabs = [slots[0]["placement"]["tabLabel"], slots[1]["placement"]["tabLabel"]]
        view = {"id": mode, "title": f"Shared layout {mode}", "slots": slots}
        view["actions"] = [{"id": "export", "label": "Export layout", "call": {"service": "fixture.Layout", "method": "Export"}}]
        slots[2]["actions"] = [{"id": "inspect", "label": "Inspect section", "call": {"service": "fixture.Layout", "method": "Inspect"}}]
        if mode not in ("unset", "unknown"):
            view["layout"] = {mode: {}}
        result.append({"name": mode, "view": view, "context": {}, "responses": {}, "order": order, "tabs": tabs,
                       "content": [f"Content {name}" for name in order] + ["Export layout", "Inspect section"]})

    for name, value in [("missing", None), ("null", None), ("empty", ""), ("false", False), ("zero", 0), ("open", "scope-A")]:
        gated = slot("gated")
        gated.update(dependsOnSelectionKey="scope", dependsOnPlaceholder="Choose a scope first")
        gated["panel"]["detailHeader"] = {"titleSourcePath": "title", "populate": {"service": "fixture.Layout", "method": "Scoped"}}
        result.append({"name": f"gate-{name}", "view": {"id": f"gate-{name}", "title": f"Shared gate {name}", "slots": [gated]},
                       "context": {"selections": {} if name == "missing" else {"scope": value}},
                       "responses": {"fixture.Layout.Scoped": {"title": "Fetched scoped"}},
                       "order": ["gated"], "tabs": [], "gateOpen": name == "open", "content": ["Fetched scoped" if name == "open" else "Choose a scope first"]})

    nested = slot("nested")
    nested["subView"] = {"id": "child", "title": "Shared nested child", "slots": [slot("inner")]}
    result.append({"name": "nested", "view": {"id": "nested", "title": "Shared nested root", "slots": [nested]},
                   "context": {}, "responses": {}, "order": ["nested", "inner"], "tabs": [], "content": ["Shared nested child", "Content inner"]})
    repeated = copy.deepcopy(nested)
    repeated["subViewPopulate"] = {"service": "fixture.Layout", "method": "Rows"}
    repeated["subViewRowsField"] = "rows"
    repeated["subView"]["slots"][0]["panel"]["detailHeader"] = {"titleSourcePath": "name"}
    result.append({"name": "repeated", "view": {"id": "repeated", "title": "Shared repeated root", "slots": [repeated]},
                   "context": {}, "responses": {"fixture.Layout.Rows": {"rows": [{"name": "001.20", "enabled": False, "count": 0}, {"name": "Second row"}]}},
                   "order": ["nested", "inner", "inner"], "tabs": [], "content": ["001.20", "Second row"]})
    for case in result:
        name = case["name"]
        case["staticOrder"] = case["order"] + (["first"] if name == "tabbed" else [])
        case["staticContent"] = case["content"] + (["Content first"] if name == "tabbed" else [])
        if name.startswith("gate-"):
            case["staticContent"] = ["Choose a scope first", "host context unavailable"]
        elif name == "repeated":
            case["staticOrder"] = ["nested", "inner"]
            case["staticContent"] = ["Repeated template only", "fixture.Layout/Rows", "Shared nested child", "Panel inner"]
    return result


def artifacts():
    types = classes()
    View, Struct = types["meridian.ui.v1.ViewDescriptor"], types["google.protobuf.Struct"]
    files, index = {}, []
    for case in cases():
        view = json_format.ParseDict(case["view"], View())
        if case["name"] == "unknown":
            view.layout.ParseFromString(b"\x2a\x00")  # Future Layout arm5, empty message.
        messages = {"view": view, "context": json_format.ParseDict(case["context"], Struct()),
                    "responses": json_format.ParseDict(case["responses"], Struct())}
        for kind, message in messages.items():
            files[f"{case['name']}.{kind}.binpb"] = message.SerializeToString(deterministic=True)
            files[f"{case['name']}.{kind}.txtpb"] = text_format.MessageToString(message, as_utf8=True, print_unknown_fields=True).encode()
        index.append({key: value for key, value in case.items() if key not in ("view", "context", "responses")})
    message = json_format.ParseDict({"cases": index}, Struct())
    files["index.binpb"] = message.SerializeToString(deterministic=True)
    files["index.txtpb"] = text_format.MessageToString(message, as_utf8=True).encode()
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    check(ROOT / "schemas/conformance/layout", artifacts(), args.write)
    print(f"Layout corpus OK: {len(cases())} canonical composed-view cases")


if __name__ == "__main__":
    main()
