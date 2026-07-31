// Real-browser UI test — 0 tolerance for UI mishaps.
//
// Loads the fixture harness bundle into hermetic Chrome for Testing (the @chrome
// binary from rules_chrome, driven by Playwright directly — the same launch path
// as rules_chrome's non-macro smoke) and asserts what actually renders + how it
// behaves: every primitive + layout, plus the interactions jsdom can't prove
// (pagination clicks re-fetch the next page, tabs switch content, forms edit).
//
//   argv[2] = @chrome//:chrome launcher path
//   argv[3] = the harness bundle path

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const chromePath = path.resolve(process.argv[2]);
const bundlePath = path.resolve(process.argv[3]);
const bundle = fs.readFileSync(bundlePath, "utf8");
const html =
  '<!doctype html><html><head><meta charset="utf-8"><title>meridian</title></head>' +
  '<body style="margin:0"><div id="root"></div>' +
  "<script>" +
  bundle +
  "</script></body></html>";

const failures = [];
async function check(name, fn) {
  try {
    await fn();
    console.log("  ✓", name);
  } catch (err) {
    failures.push(name);
    console.error("  ✗", name, "—", err.message);
  }
}

async function main() {
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox", "--disable-gpu"],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.waitForFunction(() => !!window.meridianHarness, null, { timeout: 15000 });

    const render = (name) => page.evaluate((n) => window.meridianHarness.render(n), name);
    const seen = (text) =>
      page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 8000 });
    const absent = async (text) => {
      if ((await page.getByText(text, { exact: false }).count()) > 0) {
        throw new Error(`expected "${text}" to be absent`);
      }
    };

    // ── Table · client pagination ──
    await check("table-client: MUI headers + populated rows", async () => {
      await render("table-client");
      await seen("Name");
      await seen("Status");
      await seen("Widget");
      await seen("Gadget");
    });
    await check("table-client: header actions render (ActionBar)", async () => {
      await seen("Edit");
      await seen("Export YAML");
    });

    // ── Table · OFFSET pagination (re-fetch on next) ──
    await check("table-offset: page 1 then advance to page 2 via the pager", async () => {
      await render("table-offset");
      await seen("Widget");
      await absent("Gizmo");
      await page.getByRole("button", { name: /go to next page/i }).click();
      await seen("Gizmo");
      await seen("Sprocket");
    });

    // ── Table · CURSOR pagination (aion's preferred) ──
    await check("table-cursor: first page then advance via opaque cursor", async () => {
      await render("table-cursor");
      await seen("Widget");
      await absent("Gizmo");
      await page.getByRole("button", { name: /go to next page/i }).click();
      await seen("Gizmo");
      await seen("Sprocket");
    });

    // ── Form · read-only ──
    await check("form-readonly: MUI field labels render", async () => {
      await render("form-readonly");
      await seen("Product Type");
      await seen("Review Status");
      await seen("Attributes");
    });

    // ── Form · editable (inputs enabled + Save) ──
    await check("form-edit: editable inputs + Save button", async () => {
      await render("form-edit");
      await seen("Product Type");
      await seen("Save");
      const input = page.locator("input").first();
      await input.fill("physical");
      if ((await input.inputValue()) !== "physical") throw new Error("input not editable");
    });

    // ── Form · typed fields (the full 0.16 vocabulary) ──
    await check("form-typed-edit: every field kind renders", async () => {
      await render("form-typed-edit");
      await seen("Quantity"); // integer spinner
      await seen("Unit price"); // decimal number
      await seen("Active"); // boolean toggle
      await seen("Tier"); // enum select
      await seen("SKU"); // text
      await seen("Dimensions"); // nested group legend
      await seen("Width (cm)"); // nested child
      await seen("Tags"); // repeated list
      await seen("Save");
    });
    await check("form-typed-edit: boolean is a checked, toggleable switch", async () => {
      const sw = page.getByRole("switch").first();
      if (!(await sw.isChecked())) throw new Error("Active should default checked");
      await sw.click();
      if (await sw.isChecked()) throw new Error("switch did not toggle off");
    });
    await check("form-typed-edit: repeated list adds + removes rows", async () => {
      const removeBtns = page.getByRole("button", { name: /remove item/i });
      const before = await removeBtns.count(); // seeded min_items = 1
      if (before !== 1) throw new Error(`expected 1 seeded tag, got ${before}`);
      await page.getByRole("button", { name: "Add tag" }).click();
      await page.waitForTimeout(50);
      if ((await removeBtns.count()) !== 2) throw new Error("Add tag did not append a row");
      await removeBtns.first().click();
      await page.waitForTimeout(50);
      if ((await removeBtns.count()) !== 1) throw new Error("remove did not drop a row");
    });
    await check("form-typed-edit: decimal input accepts a fractional value", async () => {
      const price = page.getByLabel("Unit price");
      await price.fill("12.5");
      if ((await price.inputValue()) !== "12.5") throw new Error("decimal not editable");
    });

    // ── Form · typed fields, read-only (controls hidden, inputs disabled) ──
    await check("form-typed-readonly: fields render; add/remove hidden", async () => {
      await render("form-typed-readonly");
      await seen("Quantity");
      await seen("Tags");
      await absent("Add tag");
    });
    await check("form-typed-readonly: boolean switch is disabled", async () => {
      const sw = page.getByRole("switch").first();
      if (!(await sw.isDisabled())) throw new Error("read-only switch should be disabled");
    });

    // ── Form · repeated list of sub-forms (recursion: list → nested) ──
    await check("form-repeated-nested: list of sub-forms renders + grows", async () => {
      await render("form-repeated-nested");
      await seen("Variants");
      await seen("Color"); // nested child of a repeated element
      await seen("In stock"); // nested boolean inside a repeated element
      const removeBtns = page.getByRole("button", { name: /remove item/i });
      const before = await removeBtns.count(); // min_items 1 → one variant
      await page.getByRole("button", { name: "Add variant" }).click();
      await page.waitForTimeout(50);
      if ((await removeBtns.count()) !== before + 1) {
        throw new Error("Add variant did not add a sub-form");
      }
    });

    // ── Form · nav.groups (add/remove/reorder sections + kinds) ──
    await check("form-nav-groups: renders add-section and up/down reorder buttons", async () => {
      await render("form-nav-groups");
      await seen("Groups");
      // add first section and wait for the reorder buttons to appear
      await page.getByRole("button", { name: "Add section" }).click();
      await page.getByRole("button", { name: /move item up/i }).first().waitFor({ state: "visible" });
      // add second section and wait for a second move-up button
      await page.getByRole("button", { name: "Add section" }).click();
      await page.waitForFunction(() =>
        document.querySelectorAll('[aria-label="move item up"]').length >= 2,
      );
      const upBtns = page.getByRole("button", { name: /move item up/i });
      const downBtns = page.getByRole("button", { name: /move item down/i });
      if ((await upBtns.count()) < 2) throw new Error("expected ≥2 move-up buttons for 2 sections");
      if ((await downBtns.count()) < 2) throw new Error("expected ≥2 move-down buttons for 2 sections");
    });
    await check("form-nav-groups: first up disabled; last down disabled", async () => {
      // still on form-nav-groups with 2 sections from the previous check
      const upBtns = page.getByRole("button", { name: /move item up/i });
      const downBtns = page.getByRole("button", { name: /move item down/i });
      // Section-level up/down. Valid here only because neither section has any
      // kind rows yet — a nested list contributes identically labelled buttons
      // ahead of its parent's (see the reorder check below).
      const firstUp = upBtns.first();
      const lastDown = downBtns.last();
      if (!(await firstUp.isDisabled())) throw new Error("first section up should be disabled");
      if (!(await lastDown.isDisabled())) throw new Error("last section down should be disabled");
    });
    await check("form-nav-groups: add kind inside a section + reorder sections", async () => {
      await render("form-nav-groups");
      await seen("Groups");
      // add two sections and wait for both reorder buttons
      await page.getByRole("button", { name: "Add section" }).click();
      await page.getByRole("button", { name: /move item up/i }).first().waitFor({ state: "visible" });
      await page.getByRole("button", { name: "Add section" }).click();
      await page.waitForFunction(() =>
        document.querySelectorAll('[aria-label="move item up"]').length >= 2,
      );
      // fill labels
      const labelInputs = page.getByRole("textbox", { name: /label/i });
      await labelInputs.nth(0).fill("Alpha");
      await labelInputs.nth(1).fill("Beta");
      // add a kind to the first section and wait for the kind input
      await page.getByRole("button", { name: "Add kind" }).first().click();
      await page.getByRole("textbox", { name: /kind/i }).first().waitFor({ state: "visible" });
      await page.getByRole("textbox", { name: /kind/i }).first().fill("products");
      // reorder: move the FIRST SECTION down and wait for the input values to swap.
      // Every list draws its row content before that row's controls, so a section's
      // own kind rows — which live inside the section fieldset — contribute
      // identically labelled move buttons EARLIER in the DOM than the section-level
      // pair. Once a kind exists, `.first()` resolves to that kind row's (disabled,
      // single-row) move-down button, not the section's. Scope to the buttons that
      // are outside any fieldset: those are the outer Groups list's.
      // (The harness keys the mount by fixture name, so re-rendering the same
      // fixture keeps the sections added by the checks above — hence ">= 2".)
      const sectionDown = page.locator('button[aria-label="move item down"]:not(fieldset button)');
      if ((await sectionDown.count()) < 2) {
        throw new Error(`expected ≥2 section-level move-down buttons, got ${await sectionDown.count()}`);
      }
      if (await sectionDown.first().isDisabled()) {
        throw new Error("the first section's move-down should be enabled (a kind row's was picked)");
      }
      await sectionDown.first().click();
      await page.waitForFunction(() => {
        // check the first visible label-type textbox has "Beta"
        const labelInputsList = Array.from(document.querySelectorAll("input[type='text']")).filter(
          (el) => el.closest('[class*="MuiFormControl"]')?.querySelector("label")?.textContent?.trim() === "Label",
        );
        return labelInputsList.length >= 2 && (labelInputsList[0] ).value === "Beta";
      });
      const labelsAfter = page.getByRole("textbox", { name: /label/i });
      const firstLabel = await labelsAfter.nth(0).inputValue();
      if (firstLabel !== "Beta") throw new Error(`expected first label to be Beta after reorder, got "${firstLabel}"`);
      if ((await labelsAfter.nth(1).inputValue()) !== "Alpha") {
        throw new Error("expected the moved section (Alpha) to land second");
      }
      // the section's own child rows must travel with it
      const kindAfter = await page.getByRole("textbox", { name: /kind/i }).first().inputValue();
      if (kindAfter !== "products") {
        throw new Error(`expected Alpha's kind to survive the reorder, got "${kindAfter}"`);
      }
    });

    // ── Prompt ──
    await check("prompt: description + field + accept label", async () => {
      await render("prompt");
      await seen("Region");
      await seen("Continue");
    });

    // ── LRO ──
    await check("lro: run button + input", async () => {
      await render("lro");
      await seen("Count");
      await seen("Generate");
    });

    // ── Fallback ──
    await check("fallback: empty panel renders the fallback affordance", async () => {
      await render("fallback");
      await seen("empty panel");
    });

    // ── Layout · stacked (header above configuration) ──
    await check("layout-stacked: adhoc header + form, ordered", async () => {
      await render("layout-stacked");
      await seen("Widget — product");
      await seen("Product Type");
      const headerBox = await page.getByText("Widget — product").first().boundingBox();
      const formBox = await page.getByText("Attributes").first().boundingBox();
      if (!headerBox || !formBox || headerBox.y >= formBox.y) {
        throw new Error("header not above form");
      }
    });

    // ── Layout · tabbed (switch tabs) ──
    await check("layout-tabbed: tabs switch content", async () => {
      await render("layout-tabbed");
      await seen("Overview");
      await seen("Items");
      await seen("Product Type");
      await page.getByRole("tab", { name: "Items" }).click();
      await seen("Widget");
    });

    // ── Layout · two-column (main + sidebar both present) ──
    await check("layout-two-column: main table + sidebar form", async () => {
      await render("layout-two-column");
      await seen("Widget");
      await seen("Product Type");
    });

    // ── States ──
    await check("table-empty: shows the empty placeholder, no rows", async () => {
      await render("table-empty");
      await seen("No products.");
      await absent("Widget");
    });
    await check("table-error: shows an error affordance, not 'no data'", async () => {
      await render("table-error");
      await seen("Failed to load");
      await absent("No products.");
    });

    // ── Theming ──
    await check("dark-table: renders in dark mode (rows present)", async () => {
      await render("dark-table");
      await seen("Widget");
      await seen("Status");
    });
    await check("dark-form-typed: typed form renders in dark mode", async () => {
      await render("dark-form-typed");
      await seen("Quantity");
      await seen("Active");
      await seen("Tags");
    });
    await check("skin-indigo: renders with the 2nd skin", async () => {
      await render("skin-indigo");
      await seen("Widget");
    });

    // ── The app shell ──────────────────────────────────────────────────────
    //
    // Everything below is LAYOUT or INTERACTION, which is the whole reason these live in a
    // browser: `isActive` and the launchpad ranking are pure and already pinned in tests/.
    // What cannot be unit-tested is whether the rail reserves width, whether the dock
    // reflows rather than covers, and whether ⌘K is actually bound.

    await check("shell-full: brand, rail, scope and content all render", async () => {
      await render("shell-full");
      await seen("savvi Studio");
      await seen("Dashboard");
      await seen("Plan years");
      await seen("Organization");
      await seen("A frame with everything.");
    });

    await check("shell-full: an unresolvable leaf is inert, not a dead link", async () => {
      // ⛔ A `panelId` leaf the host cannot resolve must not become <a href="#">.
      await seen("Unresolvable panel");
      const anchors = await page.locator('a:has-text("Unresolvable panel")').count();
      if (anchors > 0) throw new Error("an unresolvable leaf rendered as a link");
    });

    await check("shell-full: the active route is marked, and only it", async () => {
      // usePathname() is "/sponsors" in the fixture.
      const current = await page.locator('[aria-current="page"]').allTextContents();
      if (current.length !== 1) throw new Error(`expected 1 aria-current, got ${current.length}`);
      if (!current[0].includes("Sponsors")) throw new Error(`marked "${current[0]}", not Sponsors`);
    });

    await check("shell-full: ⌘K opens the launchpad and ranks across groups", async () => {
      await page.keyboard.press("Control+k");
      // ⛔ getByPlaceholder, NOT getByText: a placeholder is an ATTRIBUTE, and asserting it
      // as text passes vacuously for as long as the dialog is missing.
      await page.getByPlaceholder("Search or jump to").waitFor({ state: "visible", timeout: 8000 });
      await page.keyboard.type("team");
      await page.waitForTimeout(300);
      // The regression the unit test found, re-checked where it would actually bite: row one
      // must be "Teams", not "Create team" — otherwise ↵ creates instead of navigating.
      const rows = await page.locator('[role="dialog"] .MuiListItemButton-root').allTextContents();
      const first = (rows.find((r) => r.trim().length > 0) || "").trim();
      if (!first.includes("Teams") || first.includes("Create")) {
        throw new Error(`launchpad row one was "${first}", expected Teams`);
      }
      await page.keyboard.press("Escape");
    });

    // ⛔ LAST among the shell-full checks, and deliberately so. The harness keys its mount by
    // fixture NAME, so re-rendering the same fixture RECONCILES rather than remounts — this
    // collapse would otherwise persist into every check after it, and two of them failed
    // exactly that way before being reordered.
    await check("shell-full: a group collapses and hides its children", async () => {
      await seen("Teams");
      await page.getByText("Administration", { exact: false }).first().click();
      await page.waitForTimeout(400);
      await absent("Platforms");
    });

    await check("shell-restricted: NO rail, and no width reserved for one", async () => {
      await render("shell-restricted");
      await seen("savvi Studio");
      await absent("Dashboard");
      // ⛔ The point of the fixture. If the shell merely HID the drawer while still
      // reserving its width, every unit test would pass and the page would have a 280px
      // hole. So assert the content actually starts near the left edge.
      const box = await page.locator("main").boundingBox();
      if (!box) throw new Error("no main element");
      if (box.x > 40) throw new Error(`content starts at x=${box.x}; a hidden rail is still reserving space`);
    });

    await check("shell-chat: the dock reserves width and does not cover the content", async () => {
      await render("shell-chat");
      await seen("The host's conversation renders here.");
      const main = await page.locator("main").boundingBox();
      const viewport = page.viewportSize();
      if (!main || !viewport) throw new Error("no geometry");
      // ⛔ A persistent drawer takes width from the flex row. If the dock were `temporary`
      // it would overlay, `main` would still span the full width, and the conversation would
      // sit on top of the content — which is exactly what aion gets today by mounting the
      // dock outside the shell.
      if (main.x + main.width > viewport.width - 200) {
        throw new Error(`main runs to ${main.x + main.width} of ${viewport.width}; the dock is overlaying, not reflowing`);
      }
    });

    await check("shell-dark: the frame renders in dark mode", async () => {
      await render("shell-dark");
      await seen("The same frame, dark.");
      await seen("Dashboard");
    });
  } finally {
    await browser.close();
  }

  console.log("");
  if (failures.length) {
    console.error(`${failures.length} UI failure(s): ${failures.join("; ")}`);
    process.exit(1);
  }
  console.log("All browser UI checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
