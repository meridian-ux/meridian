const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { fromBinary, toJson } = require("@bufbuild/protobuf");
const { StructSchema } = require("@bufbuild/protobuf/wkt");
const { geometry } = require("./layout.cjs");
const directory = path.resolve("schemas/conformance/layout");
const cases = toJson(StructSchema, fromBinary(StructSchema, fs.readFileSync(path.join(directory, "index.binpb")))).cases;
const bytes = (name, kind) => [...fs.readFileSync(path.join(directory, `${name}.${kind}.binpb`))];

async function main() {
  const clients = new Set(); let turns = 0;
  const bundle = fs.readFileSync(path.resolve(process.argv[3]), "utf8");
  const css = fs.readFileSync(path.resolve(process.argv[4]), "utf8");
  const server = http.createServer((request, response) => {
    if (request.url === "/events") {
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      response.write(": fixture stream\n\n"); clients.add(response);
      response.on("close", () => clients.delete(response));
    } else if (request.url === "/bundle.js") {
      response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(bundle);
    } else if (request.url === "/turn") {
      turns++; response.writeHead(403); response.end();
    } else if (request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Rich conversation conformance</title><style>body{margin:0}' + css + '</style><main id="root" class="meridian-uiview-body" style="margin:16px"></main><script src="/bundle.js"></script></html>');
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const waitClients = async count => {
    const deadline = Date.now() + 5000;
    while (clients.size !== count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(clients.size, count, "conversation must own exactly one current SSE connection");
  };
  try {
    browser = await chromium.launch({ executablePath: path.resolve(process.argv[2]), headless: true,
      args: ["--disable-dev-shm-usage", "--no-sandbox", "--disable-gpu", "--lang=en-US"] });
    const page = await browser.newPage({ reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC" });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(origin); await page.waitForFunction(() => !!window.conversationConformance);
    const emit = async (name, seq, id) => {
      const frame = await page.evaluate(({ view, seq, id }) => window.conversationConformance.frame(view, seq, id), { view: bytes(name, "view"), seq: String(seq), id });
      assert.equal(clients.size, 1);
      for (const client of clients) client.write(`data: ${frame}\n\n`);
    };
    const mount = async (kit, fixture, allowExport = false, holdReads = false) => {
      await page.evaluate(() => window.conversationConformance.dispose()); await waitClients(0);
      await page.evaluate(({ kit, context, responses, allowExport, holdReads }) => window.conversationConformance.mount(kit, context, responses, allowExport, holdReads), {
        kit, context: bytes(fixture.name, "context"), responses: bytes(fixture.name, "responses"), allowExport, holdReads,
      });
      await waitClients(1);
    };
    for (const kit of ["html", "shadcn", "mui-kit"]) {
      for (const fixture of cases) for (const width of [1100, 320]) {
        try {
          await page.setViewportSize({ width, height: 900 });
          await mount(kit, fixture); await emit(fixture.name, 1);
          await page.waitForFunction(content => content.every(text => document.getElementById("root").textContent.includes(text)), fixture.content);
          assert.equal(await page.locator(".view-static").count(), 0, "rich host must win over passive fallback");
          assert.equal(await page.locator(".asst-row").count(), 1);
          await geometry(page, fixture);
          const expected = fixture.name === "repeated" ? ["fixture.Layout.Rows"] : fixture.gateOpen ? ["fixture.Layout.Scoped"] : [];
          assert.deepEqual(await page.evaluate(() => window.conversationConformance.calls()), expected);
          if (fixture.tabs.length) {
            const tabs = page.getByRole("tab"); await tabs.nth(1).focus(); await page.keyboard.press("Enter");
            await page.getByText("Content first", { exact: true }).waitFor();
            await page.setViewportSize({ width: width === 320 ? 1100 : 320, height: 900 });
            assert.equal(await tabs.nth(1).getAttribute("aria-selected"), "true");
            assert.equal(await tabs.nth(1).evaluate(element => element === document.activeElement), true);
            await geometry(page, fixture, false);
          }
          // Same canonical block identity replaces a composed host rather than
          // appending another transcript row or retaining its old actions/tabs.
          await emit("nested", 2);
          await page.getByText("Shared nested root", { exact: true }).waitFor();
          assert.equal(await page.locator(".asst-row").count(), 1);
          assert.equal(await page.getByRole("tab").count(), 0);
          assert.equal(await page.getByRole("button", { name: "Export layout", exact: true }).count(), 0);
          assert.deepEqual(await page.evaluate(() => window.conversationConformance.calls()), expected);
          // Duplicate sequence must not resurrect the replaced view.
          await emit(fixture.name, 2);
          // The next accepted frame is an ordered transport checkpoint: do not
          // infer SSE delivery from a sleep or a couple of animation frames.
          await emit("nested", 3, "checkpoint");
          await page.waitForFunction(() => document.querySelectorAll(".asst-row").length === 2);
          assert.equal(await page.getByText("Shared nested root", { exact: true }).count(), 2);
        } catch (error) { throw new Error(`${kit}/${fixture.name}/${width}: ${error.message}`, { cause: error }); }
      }
      const stacked = cases.find(fixture => fixture.name === "stacked");
      for (const allow of [false, true]) {
        await mount(kit, stacked, allow); await emit("stacked", 1);
        const action = page.getByRole("button", { name: "Export layout", exact: true }); await action.waitFor();
        if (allow) await action.click();
        else {
          assert.equal(await action.getAttribute("aria-disabled"), "true");
          // ARIA denial is intentionally focusable so keyboard users can read
          // its explanation; attempted activation still passes the host gate.
          await action.focus(); await page.keyboard.press("Enter");
        }
        if (allow) await page.waitForFunction(() => window.conversationConformance.calls().length === 1);
        else await page.waitForFunction(() => window.conversationConformance.denials() > 0);
        assert.deepEqual(await page.evaluate(() => window.conversationConformance.calls()), allow ? ["fixture.Layout.Export"] : []);
        if (!allow) assert.match(await page.locator("#root").innerText(), /unavailable|not allowed|denied/i);
      }
      // A response arriving after a same-ID view replacement must not restore
      // an obsolete panel or overwrite the replacement transcript content.
      await mount(kit, cases.find(fixture => fixture.name === "gate-open"), false, true);
      await emit("gate-open", 1);
      await page.waitForFunction(() => window.conversationConformance.calls().length === 1);
      assert.equal(await page.getByText("Fetched scoped", { exact: true }).count(), 0);
      await emit("nested", 2); await page.getByText("Shared nested root", { exact: true }).waitFor();
      await page.evaluate(() => window.conversationConformance.releaseReads());
      await emit("nested", 3, "late-read-checkpoint");
      await page.waitForFunction(() => document.querySelectorAll(".asst-row").length === 2);
      assert.equal(await page.getByText("Fetched scoped", { exact: true }).count(), 0);
      assert.equal(await page.getByText("Shared nested root", { exact: true }).count(), 2);
      assert.deepEqual(await page.evaluate(() => window.conversationConformance.calls()), ["fixture.Layout.Scoped"]);
      console.log(`${kit}: 28 real HTTP/SSE rich-host mounts, upserts/replay, denied/admitted actions, and late-read isolation verified`);
    }
    await page.evaluate(() => window.conversationConformance.dispose()); await waitClients(0);
    assert.equal(turns, 0, "view emission/navigation must never post a conversation turn");
    assert.deepEqual(errors, []);
    console.log("84 rich conversation mounts verified; local fixture SSE only, no live backend.");
  } finally {
    await browser?.close(); for (const client of clients) client.end();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
