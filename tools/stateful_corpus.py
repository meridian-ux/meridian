#!/usr/bin/env python3
"""Author stateful ViewDescriptor fixtures and protobuf Struct response twins.

Uses the committed canonical descriptor set, not a second Python schema. Run
with --write to deliberately update artifacts; default mode rejects any drift.
"""
import argparse
import copy
import json
import re
from pathlib import Path

from google.protobuf import descriptor_pb2, descriptor_pool, json_format, message_factory, text_format

ROOT = Path(__file__).resolve().parents[1]
STATES = ("empty", "typical", "overflow")
INPUT_ARMS = ("form", "prompt", "lro", "llm_prompt")


def classes():
    descriptors = descriptor_pb2.FileDescriptorSet.FromString(
        (ROOT / "crates/core/rust/uiview/proto/gen/meridian_ui_v1.binpb").read_bytes())
    pool = descriptor_pool.DescriptorPool()
    for file in descriptors.file:
        pool.Add(file)
    return {name: message_factory.GetMessageClass(pool.FindMessageTypeByName(name)) for name in (
        "meridian.ui.v1.PanelDescriptor", "meridian.ui.v1.ViewDescriptor",
        "meridian.ui.v1.FormField", "google.protobuf.Struct")}


def input_cases():
    """In-memory authoring only; persisted index and fixtures are protobufs.

    Input kinds keep their actual scalar/collection types. ValueDisplay changes
    read-only presentation, never submitted data or an LLM slot's stored value.
    """
    text = lambda value: {"text": {"defaultValue": value}}
    number = lambda value: {"number": {"defaultValue": value, "min": -100, "max": 100}}
    cases = [
        ("unspecified", 0, text("literal"), "literal", "literal"),
        ("text", 1, text("plain text"), "plain text", "plain text"),
        ("multiline", 2, text("first\nsecond"), "first\nsecond", "first\nsecond"),
        ("integer", 3, {"integer": {"defaultValue": -42, "min": -100, "max": 100}}, -42, "-42"),
        ("decimal", 4, number(12.5), 12.5, "12.50"),
        ("boolean", 5, {"boolean": {"defaultValue": False}}, False, "No"),
        ("enum", 6, {"enumSelection": {"allowedValues": ["READY", "DONE"], "defaultValue": "READY"}}, "READY", "READY"),
        ("list", 7, {"repeated": {"minItems": 2, "maxItems": 4, "scalar": {
            "label": "Item", "text": {"defaultValue": "one"}}}}, ["one", "one"], "one, one"),
        ("date", 8, text("2026-03-29"), "2026-03-29", "Mar 29, 2026"),
        ("date-time", 9, text("2026-03-29T13:45:00Z"), "2026-03-29T13:45:00Z", "Mar 29, 2026, 1:45 PM UTC"),
        ("time", 10, text("13:45:00"), "13:45:00", "1:45 PM UTC"),
        ("duration", 11, text("4 min 12 s"), "4 min 12 s", "4 min 12 s"),
        ("principal", 12, text("Ada <ada@example.com>"), "Ada <ada@example.com>", "Ada"),
        ("email", 13, text("Ada <ada@example.com>"), "Ada <ada@example.com>", "ada@example.com"),
        ("url", 14, text("https://example.com/a?b=1"), "https://example.com/a?b=1", "https://example.com/a?b=1"),
        ("identifier", 15, text("000123"), "000123", "000123"),
        ("money", 16, number(12.5), 12.5, "12.50"),
        ("percent", 17, number(.125), .125, "0.125"),
        ("json", 18, {"nested": {"fields": [{"fieldId": "ready", "label": "Ready",
            "boolean": {"defaultValue": True}}]}}, {"ready": True}, '{"ready":true}'),
        ("map", 18, {"keyValueMap": {}}, {}, "{}"),
        ("empty-list", 7, {"repeated": {"scalar": {"label": "Item", "text": {}}}}, [], "—"),
        ("empty", 1, text(""), "", "—"),
        ("zero", 3, {"integer": {"min": -100, "max": 100}}, 0, "0"),
        ("numeric-string", 4, text("0012.50"), "0012.50", "0012.50"),
        ("unknown", 999, text("literal"), "literal", "literal"),
        ("invalid-date", 8, text("not-a-date"), "not-a-date", "not-a-date"),
        ("masked", 1, {"masked": {"defaultValue": "fixture-secret"}}, "fixture-secret", ""),
    ]
    result = []
    Field = classes()["meridian.ui.v1.FormField"]
    for name, value_type, kind, raw, expected in cases:
        display = {"type": value_type}
        if name in ("decimal", "money", "numeric-string"):
            display["number"] = {"fractionDigits": 2}
        if name == "percent":
            display["number"] = {"fractionDigits": 3}
        field = {"fieldId": "value", "requestField": "value", "label": "Declared input", "display": display, **kind}
        # Validate authoring against the actual canonical FormField descriptor.
        json_format.ParseDict(field, Field())
        result.append({"name": name, "field": field, "raw": raw, "expectedRead": expected, "masked": name == "masked"})
    return result


def input_index():
    message = json_format.ParseDict({"arms": list(INPUT_ARMS), "cases": input_cases()}, classes()["google.protobuf.Struct"]())
    return {"input_values.binpb": message.SerializeToString(deterministic=True),
            "input_values.txtpb": text_format.MessageToString(message, as_utf8=True).encode()}


def check_input_index(write=False):
    for name, content in input_index().items():
        path = ROOT / "schemas/conformance" / name
        if write:
            path.write_bytes(content)
        elif not path.is_file() or path.read_bytes() != content:
            raise ValueError(f"Missing/stale {name}; run tools/stateful_corpus.py --write and review")


def response_rows(state):
    if state == "empty":
        return []
    count = 2 if state == "typical" else 40
    return [{"member": f"Member {i:02}", "name": f"Resource {i:02}", "amount": i + .25,
             "enabled": i % 2 == 0, "website": "https://example.test/resource",
             "description": "A shared response" + (" with overflowing content" * 12 if state == "overflow" else ""),
             "status": "Connected", "href": "https://example.test/resource", "action": "Manage"}
            for i in range(count)]


def scenario(panel_json, arm, state):
    panel = copy.deepcopy(panel_json)
    body_key = next(key for key in panel if key not in ("panelId", "title"))
    body = panel[body_key]
    panel["panelId"] = f"{arm}-{state}"
    panel["title"] = f"{arm} · {state}"
    responses = {}
    if arm in ("detail_header", "record_card"):
        body["populate"] = {"service": "fixture.Records", "method": "Get"}
        if arm == "detail_header":
            body["titleSourcePath"] = "name"
            body.pop("title", None)
        responses["fixture.Records.Get"] = {} if state == "empty" else {
            "name": "Fixture record" + (" with a long title" * 20 if state == "overflow" else ""),
            "data": {"type": "Service", "owner": "Ada"}}
    # Shared transport state, actually consumed by every browser kit's invoker.
    data_body = body
    if arm == "chart":
        data_body = body["chart"]
        data_body["populate"] = {"service": "fixture.Charts", "method": "List"}
        data_body["rowsField"] = "rows"
    if "populate" in data_body:
        call = data_body["populate"]
        rows_key = data_body.get("rowsField", "rows")
        if arm not in ("detail_header", "record_card"):
            responses[f"{call['service']}.{call['method']}"] = {rows_key: response_rows(state)}
        if arm == "chart":
            responses["fixture.Charts.List"] = {"rows": [
                {"day": f"2026-10-{i + 1:02}", "requests": i + 1} for i in range(
                    0 if state == "empty" else 3 if state == "typical" else 28)]}
    # Static content states retain the arm and identity, not an unset oneof.
    for key in ("options", "items", "targets", "steps", "chapters", "series"):
        if key in body and isinstance(body[key], list):
            if state == "empty":
                body[key] = []
            elif state == "overflow":
                body[key] = [copy.deepcopy(item) for _ in range(12) for item in body[key]]
                for index, item in enumerate(body[key]):
                    if isinstance(item, dict) and "id" in item:
                        item["id"] += f"-{index}"
                if key == "options" and "defaultOptionId" in body:
                    body["defaultOptionId"] = body[key][0]["id"]
    for collection, default in (("targets", "defaultTargetId"), ("options", "defaultOptionId")):
        if default in body and state in ("empty", "overflow"):
            body[default] = body[collection][0]["id"] if body[collection] else ""
    for key in ("source", "description", "intro", "outro"):
        if isinstance(body.get(key), str):
            if state == "empty":
                body[key] = ""
            elif state == "overflow":
                body[key] *= 20
    if arm == "snippet":
        body["snippet"]["content"] = "" if state == "empty" else body["snippet"]["content"] * (20 if state == "overflow" else 1)
    if arm == "copy_value":
        body["value"]["value"] = "" if state == "empty" else body["value"]["value"] * (4 if state == "overflow" else 1)
    if arm == "terminal":
        if state == "empty":
            body.update(url="", tool="", cols=0, rows=0)
        elif state == "overflow":
            body.update(url="wss://example.test/" + "long-path/" * 30, tool="Long terminal title " * 15, cols=240, rows=80)
    if arm == "stat" and state == "empty":
        body.update(value=0, previous=0)
    if arm == "lro":
        body["start"] = {"service": "fixture.Jobs", "method": "Start"}
        body["inputs"] = [{"fieldId": f"input-{i}", "label": f"Job input {i}",
                           "text": {"defaultValue": "Fixture job input"}}
                          for i in range(0 if state == "empty" else 2 if state == "typical" else 30)]
    if arm == "llm_prompt":
        body["userTemplate"] = "" if state == "empty" else "Summarize {{text}}" * (20 if state == "overflow" else 1)
        body["slots"] = [] if state == "empty" else [{"name": "text", "field": {
            "fieldId": "text", "label": "Source text", "text": {"defaultValue": "A fixture document."}}, "multiLine": True}]
    if arm == "prompt":
        for field in body.get("fields", []):
            if "text" in field:
                field["text"]["defaultValue"] = "" if state == "empty" else field["text"].get("defaultValue", "") * (20 if state == "overflow" else 1)
    if arm == "form":
        body["prefill"] = {"service": "fixture.Forms", "method": "Get"}
        responses["fixture.Forms.Get"] = {"groups": [] if state == "empty" else [
            {"label": f"Section {i}", "kinds": ["service", "environment"]}
            for i in range(2 if state == "typical" else 30)]}
    if arm == "stream":
        responses["__streamFrames"] = [{"message": f"Stream line {i:03}"} for i in range(
            0 if state == "empty" else 3 if state == "typical" else 140)]
        body["maxLines"] = 20
    view = {"id": f"{arm}-{state}", "title": f"Conformance: {arm} · {state}",
            "layout": {"stacked": {}}, "slots": [{"id": "content", "panel": panel}]}
    return view, responses


def artifacts():
    types = classes()
    coverage = json.loads((ROOT / "schemas/conformance/coverage.json").read_text())
    files = {}
    def add(arm, state, view, responses):
        for suffix, name, data in (("view", "meridian.ui.v1.ViewDescriptor", view),
                                   ("responses", "google.protobuf.Struct", responses)):
            message = json_format.ParseDict(data, types[name]())
            stem = f"{arm}/{state}.{suffix}"
            files[f"{stem}.binpb"] = message.SerializeToString(deterministic=True)
            files[f"{stem}.txtpb"] = text_format.MessageToString(message, as_utf8=True).encode()
    for arm in coverage["arms"]:
        if not re.fullmatch(r"[a-z][a-z0-9_]*", arm):
            raise ValueError(f"Invalid arm filename: {arm}")
        panel = types["meridian.ui.v1.PanelDescriptor"].FromString(
            (ROOT / f"schemas/conformance/binpb/{arm}.binpb").read_bytes())
        panel_json = json_format.MessageToDict(panel)
        for state in STATES:
            view, responses = scenario(panel_json, arm, state)
            add(arm, state, view, responses)
    # Typed response values pass unchanged through every unrestricted read arm.
    value_corpus = json.loads((ROOT / "schemas/conformance/value_types.json").read_text())
    for case in value_corpus["cases"]:
        if not re.fullmatch(r"[a-z][a-z0-9-]*", case["name"]):
            raise ValueError(f"Invalid value case filename: {case['name']}")
        display = {"type": case["type"]}
        if "digits" in case:
            display["number"] = {"fractionDigits": case["digits"]}
        name = f"value-{case['name']}"
        panel = {"panelId": name, "title": case["name"], "table": {
            "populate": {"service": "fixture.Values", "method": "List"}, "rowsField": "rows",
            "columns": [{"header": "Declared value", "fieldPath": "value", "valueDisplay": display}]}}
        call = {"service": "fixture.Values", "method": "List"}
        field = {"fieldId": "value", "label": "Declared value", "display": display, "text": {}}
        bodies = {
            "table": panel["table"],
            "record_card": {"populate": call, "fields": [field]},
            "detail_header": {"populate": call, "title": "Fixture record", "descriptorRows": [
                {"label": "Declared value", "sourcePath": "value", "display": display}]},
            "gallery": {"populate": call, "rowsField": "rows", "card": {
                "titleField": "value", "titleDisplay": display,
                "subtitleField": "value", "subtitleDisplay": display,
                "statusField": "value", "statusDisplay": display}},
            "resource_cards": {"populate": call, "rowsField": "rows", "template": {
                "titleField": "value", "titleDisplay": display,
                "subtitleField": "value", "subtitleDisplay": display,
                "statusField": "value", "statusDisplay": display,
                "meta": [{"label": "Declared value", "fieldPath": "value", "display": display}]}},
        }
        for arm in value_corpus["panelArms"]:
            body_key = {"record_card": "recordCard", "detail_header": "detailHeader",
                        "resource_cards": "resourceCards"}.get(arm, arm)
            identity = name if arm == "table" else f"{arm}-{name}"
            panel = {"panelId": identity, "title": case["name"], body_key: bodies[arm]}
            view = {"id": identity, "title": name, "layout": {"stacked": {}},
                    "slots": [{"id": "content", "panel": panel}]}
            raw = {"value": case["raw"]}
            response = raw if arm in ("record_card", "detail_header") else {"rows": [raw]}
            add(arm, name, view, {"fixture.Values.List": response})
    constrained = json.loads((ROOT / "schemas/conformance/constrained_value_types.json").read_text())
    for arms, cases in ((constrained["stringArms"], constrained["strings"]),
                        (constrained["numberArms"], constrained["numbers"])):
        for arm in arms:
            for case in cases:
                if not re.fullmatch(r"[a-z][a-z0-9-]*", case["name"]):
                    raise ValueError(f"Invalid constrained value filename: {case['name']}")
                name = f"typed-{case['name']}"
                display = {"type": case["type"]}
                if "digits" in case:
                    display["number"] = {"fractionDigits": case["digits"]}
                responses = {}
                if arm == "stat":
                    body = {"label": "Typed metric", "value": case["raw"], "format": case.get("format", 5), "valueDisplay": display}
                    if "serverDisplay" in case:
                        body.update({"populate": {"service": "fixture.Metrics", "method": "Get"}, "displayField": "shown"})
                        responses["fixture.Metrics.Get"] = {"value": case["raw"], "shown": case["serverDisplay"]}
                    key = "stat"
                else:
                    value = {"value": case["raw"], "label": "Typed value", "display": display}
                    if arm == "copy_value":
                        key, body = "copyValue", {"value": value}
                    else:
                        key, body = "connectFlow", {"endpoint": value, "targets": [{"id": "fixture", "label": "Fixture target"}], "defaultTargetId": "fixture"}
                identity = f"{arm}-{name}"
                view = {"id": identity, "title": name, "layout": {"stacked": {}}, "slots": [{"id": "content", "panel": {"panelId": identity, "title": case["name"], key: body}}]}
                add(arm, name, view, responses)
    for case in input_cases():
        field = case["field"]
        for arm in (*INPUT_ARMS, "readonly-form"):
            readonly = arm == "readonly-form"
            arm = "form" if readonly else arm
            state = ("read-" if readonly else "input-") + case["name"]
            key = {"llm_prompt": "llmPrompt"}.get(arm, arm)
            if arm == "form":
                body = {"fields": [field], "mode": 1 if readonly else 2,
                        "submit": {"service": "fixture.Inputs", "method": "Submit"}}
            elif arm == "prompt":
                body = {"fields": [field], "acceptLabel": "Submit"}
            elif arm == "lro":
                body = {"inputs": [field], "start": {"service": "fixture.Inputs", "method": "Start"},
                        "metadataType": "fixture.Metadata", "responseType": "fixture.Response"}
            else:
                body = {"userTemplate": "Value={{value}}", "slots": [{"name": "value", "field": field,
                        "multiLine": case["name"] == "multiline"}]}
            identity = f"{arm}-{state}"
            view = {"id": identity, "title": identity, "layout": {"stacked": {}},
                    "slots": [{"id": "content", "panel": {"panelId": identity, "title": case["name"], key: body}}]}
            add(arm, state, view, {})
    return files


def check(directory, expected, write=False):
    actual = {str(path.relative_to(directory)) for path in directory.rglob("*") if path.is_file()}
    extras = actual - expected.keys()
    if extras:
        raise ValueError(f"Unexpected fixture files (not deleted automatically): {sorted(extras)}")
    for name, content in expected.items():
        path = directory / name
        if write:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        elif not path.is_file() or path.read_bytes() != content:
            raise ValueError(f"Missing/stale {name}; run tools/stateful_corpus.py --write and review")
    return len(expected) // 4


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    check_input_index(args.write)
    count = check(ROOT / "schemas/conformance/fixtures", artifacts(), args.write)
    print(f"Stateful corpus OK: {count} ViewDescriptor/response cases, binary/text twins")


if __name__ == "__main__":
    main()
