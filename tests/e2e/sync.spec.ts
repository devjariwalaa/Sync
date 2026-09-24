import { test, expect, type Page } from "@playwright/test";
const name = () => `test-${crypto.randomUUID()}`;
const content = (p: Page) =>
  p.getByRole("textbox", { name: "Document content" });
const live = (p: Page) =>
  expect(p.locator("#connection")).toHaveText("Live sync");
const synced = (p: Page) =>
  expect(p.locator("#saved")).toHaveText("All changes synced");
async function open(p: Page, doc: string) {
  await p.goto(`/?doc=${doc}`);
  await expect(content(p)).toBeEnabled();
  await live(p);
}
async function append(p: Page, text: string) {
  await content(p).focus();
  await content(p).press("ControlOrMeta+End");
  await content(p).press("End");
  await content(p).pressSequentially(text);
}
async function same(a: Page, b: Page) {
  await expect
    .poll(
      async () =>
        (await content(a).inputValue()) === (await content(b).inputValue()),
    )
    .toBe(true);
}
test("acceptance: two tabs, offline/concurrent edits, reconnect, no lost edits", async ({
  context,
  page,
}) => {
  const doc = name(),
    b = await context.newPage();
  await open(page, doc);
  await open(b, doc);
  await content(page).fill("Shared start.");
  await expect(content(b)).toHaveValue("Shared start.");
  await synced(page);
  await b.getByRole("button", { name: "Go offline" }).click();
  await expect(b.locator("#connection")).toHaveText("Offline");
  await Promise.all([append(page, " ONLINE"), append(b, " OFFLINE")]);
  await expect(b.locator("#saved")).toContainText("pending");
  await synced(page);
  await b.getByRole("button", { name: "Reconnect" }).click();
  await live(b);
  await synced(b);
  await expect
    .poll(async () => await content(page).inputValue())
    .toContain("OFFLINE");
  await expect
    .poll(async () => await content(b).inputValue())
    .toContain("ONLINE");
  await same(page, b);
  const final = await content(page).inputValue();
  expect(final).toContain("Shared start.");
  expect(final.match(/ONLINE/g)).toHaveLength(1);
  expect(final.match(/OFFLINE/g)).toHaveLength(1);
  await page.reload();
  await live(page);
  await expect(content(page)).toHaveValue(final);
  await page.screenshot({
    path: "test-results/acceptance-desktop.png",
    fullPage: true,
  });
});
test("actual network loss + offline reload preserves IndexedDB outbox and catches up", async ({
  browser,
}) => {
  const ca = await browser.newContext(),
    cb = await browser.newContext();
  const a = await ca.newPage(),
    b = await cb.newPage();
  try {
    const doc = name();
    await open(a, doc);
    await open(b, doc);
    await content(a).fill("Base");
    await expect(content(b)).toHaveValue("Base");
    await b.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller)
        await new Promise<void>((resolve) =>
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            () => resolve(),
            { once: true },
          ),
        );
    });
    await cb.setOffline(true);
    await expect(b.locator("#connection")).toHaveText("Offline");
    await append(b, " durable😀");
    await expect(b.locator("#saved")).toContainText("pending");
    // Wait for the real IndexedDB transaction, not just optimistic editor rendering.
    await expect
      .poll(() =>
        b.evaluate(
          () =>
            new Promise<number>((resolve, reject) => {
              const r = indexedDB.open("syncforge-v1");
              r.onsuccess = () => {
                const db = r.result;
                const q = db
                  .transaction("outbox")
                  .objectStore("outbox")
                  .count();
                q.onsuccess = () => {
                  resolve(q.result);
                  db.close();
                };
              };
              r.onerror = () => reject(r.error);
            }),
        ),
      )
      .toBeGreaterThan(0);
    await b.reload();
    await expect(content(b)).toBeEnabled();
    await expect(content(b)).toHaveValue("Base durable😀");
    await append(a, " remote");
    await synced(a);
    await cb.setOffline(false);
    await live(b);
    await synced(b);
    await expect.poll(() => content(a).inputValue()).toContain("durable😀");
    await expect.poll(() => content(b).inputValue()).toContain("remote");
    await same(a, b);
  } finally {
    await ca.close();
    await cb.close();
  }
});
test("concurrent deletion keeps unseen insertion and repeated reconnects are idempotent", async ({
  context,
  page,
}) => {
  const b = await context.newPage(),
    doc = name();
  await open(page, doc);
  await open(b, doc);
  await content(page).fill("abc");
  await expect(content(b)).toHaveValue("abc");
  await b.getByRole("button", { name: "Go offline" }).click();
  await content(b).fill("ac");
  await content(page).fill("abXc");
  await synced(page);
  await b.getByRole("button", { name: "Reconnect" }).click();
  await expect(content(page)).toHaveValue("aXc");
  await expect(content(b)).toHaveValue("aXc");
  for (let i = 0; i < 3; i++) {
    await b.getByRole("button", { name: "Go offline" }).click();
    await b.getByRole("button", { name: "Reconnect" }).click();
    await live(b);
  }
  await expect(content(b)).toHaveValue("aXc");
  await synced(b);
});
test("document isolation, Unicode replacement, mobile layout", async ({
  context,
  page,
}) => {
  const b = await context.newPage();
  await open(page, name());
  await open(b, name());
  await content(page).fill("Hi 😀 café");
  await synced(page);
  await expect(content(b)).toHaveValue("");
  await content(page).fill("Hi 🦊 café");
  await synced(page);
  await page.reload();
  await expect(content(page)).toHaveValue("Hi 🦊 café");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.screenshot({
    path: "test-results/acceptance-mobile.png",
    fullPage: true,
  });
});
test("IME composition concurrent with remote insertion preserves both edits", async ({
  context,
  page,
}) => {
  const doc = name(),
    b = await context.newPage();
  await open(page, doc);
  await open(b, doc);
  await content(page).fill("base");
  await expect(content(b)).toHaveValue("base");
  await content(b).dispatchEvent("compositionstart");
  await content(b).fill("base漢");
  await append(page, " remote");
  await synced(page);
  await content(b).dispatchEvent("compositionend");
  await synced(b);
  await expect.poll(() => content(page).inputValue()).toContain("漢");
  await expect.poll(() => content(b).inputValue()).toContain("remote");
  await same(page, b);
});
