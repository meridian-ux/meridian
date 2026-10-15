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


def classes():
    descriptors = descriptor_pb2.FileDescriptorSet.FromString(
        (ROOT / "crates/core/rust/uiview/proto/gen/meridian_ui_v1.binpb").read_bytes())
    pool = descriptor_pool.DescriptorPool()
    for file in descriptors.file:
        pool.Add(file)
    return {name: message_factory.GetMessageClass(pool.FindMessageTypeByName(name)) for name in (
        "meridian.ui.v1.PanelDescriptor", "meridian.ui.v1.ViewDescriptor", "google.protobuf.Struct")}


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
    # All formatter cases, including invalid/unknown declarations and nulls,
    # through a real fetched TablePanel inside a ViewDescriptor.
    for case in json.loads((ROOT / "schemas/conformance/value_types.json").read_text())["cases"]:
        if not re.fullmatch(r"[a-z][a-z0-9-]*", case["name"]):
            raise ValueError(f"Invalid value case filename: {case['name']}")
        display = {"type": case["type"]}
        if "digits" in case:
            display["number"] = {"fractionDigits": case["digits"]}
        name = f"value-{case['name']}"
        panel = {"panelId": name, "title": case["name"], "table": {
            "populate": {"service": "fixture.Values", "method": "List"}, "rowsField": "rows",
            "columns": [{"header": "Declared value", "fieldPath": "value", "valueDisplay": display}]}}
        view = {"id": name, "title": name, "layout": {"stacked": {}},
                "slots": [{"id": "content", "panel": panel}]}
        add("table", name, view, {"fixture.Values.List": {"rows": [{"value": case["raw"]}]}})
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
    count = check(ROOT / "schemas/conformance/fixtures", artifacts(), args.write)
    print(f"Stateful corpus OK: {count} ViewDescriptor/response cases, binary/text twins")


if __name__ == "__main__":
    main()
