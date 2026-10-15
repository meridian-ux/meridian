import { toJson } from "@bufbuild/protobuf";
import { StructSchema } from "@bufbuild/protobuf/wkt";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PanelRenderer } from "@savvifi/meridian-web-react";
import type { PromptResponseHandler } from "@savvifi/meridian-schemas/uiview";
import { promptFixture, expectedPromptValues } from "../../../schemas/conformance/prompt.js";
import { MeridianMuiProvider } from "../src/provider.js";

afterEach(cleanup);
const view = (onPromptResponse?: PromptResponseHandler, descriptor = promptFixture(), invoke = vi.fn()) =>
  <MeridianMuiProvider invoker={{ invoke }} onPromptResponse={onPromptResponse}><PanelRenderer descriptor={descriptor} /></MeridianMuiProvider>;
const submit = (container: HTMLElement) => fireEvent.submit(container.querySelector("form")!);

describe("MUI prompt responses", () => {
  it("returns canonical typed defaults through the public provider without RPC or descriptor mutation", async () => {
    const descriptor = promptFixture(), invoke = vi.fn(), onPromptResponse = vi.fn();
    const { container } = render(view(onPromptResponse, descriptor, invoke)); submit(container);
    await waitFor(() => expect(screen.getByText("Submitted.")).toBeTruthy());
    expect(onPromptResponse).toHaveBeenCalledTimes(1); expect(onPromptResponse.mock.calls[0][0]).toBe("collect");
    expect(toJson(StructSchema, onPromptResponse.mock.calls[0][1])).toEqual(toJson(StructSchema, expectedPromptValues));
    expect(invoke).not.toHaveBeenCalled(); expect(container.querySelector("script")).toBeNull();
    expect((descriptor.body.case === "prompt" && descriptor.body.value.fields[0].requestField)).toBe("rpc_only");
    submit(container); expect(onPromptResponse).toHaveBeenCalledTimes(1);
  });
  it.each([true, false, null])("distinguishes confirmation/cancellation %s under StrictMode", async value => {
    const onPromptResponse = vi.fn(); const { container } = render(<StrictMode>{view(onPromptResponse, promptFixture(true))}</StrictMode>);
    expect(container.querySelector("input")).toBeNull();
    if (value === null) fireEvent.keyDown(screen.getByText("Parameters stay local"), { key: "Escape" });
    else fireEvent.click(screen.getByRole("button", { name: value ? "Yes" : "No" }));
    await waitFor(() => expect(onPromptResponse).toHaveBeenCalledTimes(1));
    if (value === null) expect(onPromptResponse.mock.calls[0][1]).toBeNull();
    else expect(toJson(StructSchema, onPromptResponse.mock.calls[0][1])).toEqual({ collect: value });
  });
  it("makes missing handlers explicit and preserves edited values for callback retry", async () => {
    const onPromptResponse = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
    const { container, rerender } = render(view()); expect(screen.getByText(/No prompt handler/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(view(onPromptResponse)); fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Keep edits" } });
    submit(container); await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("offline"));
    expect((screen.getByLabelText("Text") as HTMLInputElement).value).toBe("Keep edits");
    submit(container); await waitFor(() => expect(screen.getByText("Submitted.")).toBeTruthy()); expect(onPromptResponse).toHaveBeenCalledTimes(2);
  });
  it.each(["", "1.5", "3"])("does not invent/truncate integer edit %j before validation", async value => {
    const onPromptResponse = vi.fn(), { container } = render(view(onPromptResponse));
    fireEvent.change(screen.getByLabelText("Integer"), { target: { value } });
    expect((screen.getByLabelText("Integer") as HTMLInputElement).value).toBe(value);
    submit(container); expect(onPromptResponse).not.toHaveBeenCalled(); expect(screen.getByRole("alert").textContent).toContain("invalid number");
  });
  it("checks masked constraints rather than passing invalid secrets to the host", () => {
    const onPromptResponse = vi.fn(), { container } = render(view(onPromptResponse));
    fireEvent.change(screen.getByLabelText("Secret"), { target: { value: "123" } }); submit(container);
    expect(onPromptResponse).not.toHaveBeenCalled(); expect(screen.getByRole("alert").textContent).toContain("invalid value");
  });
  it("deduplicates pending callbacks and ignores late failures after descriptor replacement", async () => {
    let reject!: (reason: Error) => void; const onPromptResponse = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
    const { container, rerender } = render(view(onPromptResponse)); const oldForm = container.querySelector("form")!;
    submit(container); submit(container); expect(onPromptResponse).toHaveBeenCalledTimes(1); expect(screen.getByText("Submitting…")).toBeTruthy();
    const next = promptFixture(); next.panelId = "next"; rerender(view(onPromptResponse, next));
    reject(new Error("late")); await waitFor(() => expect(screen.queryByText("Submitting…")).toBeNull());
    expect(screen.queryByText("late")).toBeNull(); fireEvent.submit(oldForm); expect(onPromptResponse).toHaveBeenCalledTimes(1);
  });
});
