import { expect, test } from "@playwright/test";
import { configured, makeDisplay, rest, signIn } from "./helpers";

test.skip(!configured, "Set E2E_SUPABASE_URL, E2E_SERVICE_ROLE_KEY and E2E_OWNER_EMAIL to run end-to-end tests.");

test("a change on the task queue shows up on the department display", async ({ page, browser }) => {
  // Setup: Nino in Paint & Finish with two queued tasks, and a Paint display.
  const [paint] = await rest("departments?key=eq.paint&select=id");
  const [nino] = await rest("people?name=eq.Nino&select=id");
  await rest(`people?id=eq.${nino.id}`, { method: "PATCH", body: JSON.stringify({ department_id: paint.id }) });
  await rest(`queue_tasks?person_id=eq.${nino.id}`, { method: "DELETE" });
  const stamp = Date.now();
  await rest("queue_tasks", { method: "POST", body: JSON.stringify([
    // Short tasks, so both land in the same week whatever day the test runs.
    { person_id: nino.id, title: `Paint rear bumper ${stamp}`, dur_value: 1, dur_unit: "hours", position: "a0" },
    { person_id: nino.id, title: `Sand bonnet ${stamp}`, dur_value: 0.5, dur_unit: "hours", position: "a1" },
  ]) });
  const token = await makeDisplay(paint.id);

  const tv = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await tv.goto(`/display/${token}`);
  const firstBar = () => tv.locator("main section").getByText(new RegExp(`(Paint rear bumper|Sand bonnet) ${stamp}`)).first();
  await expect(firstBar()).toContainText(`Paint rear bumper ${stamp}`);
  await expect(tv.getByText("Ahmad")).toHaveCount(0); // another department never shows

  // Admin: on the task queue, drag the short task to the start of Nino's week so it goes first.
  await signIn(page, undefined, "/plan");
  await page.goto("/plan?dept=paint");
  // Drag only once the planner is interactive: a cold first load paints before its handlers attach.
  await page.waitForLoadState("networkidle");
  const block = page.locator(`[aria-label^="Sand bonnet ${stamp}"]`).first();
  // Late on the last working day of the week (or on the rest day) the queue starts next week.
  if (!(await block.isVisible())) {
    await page.getByRole("link", { name: "Next →" }).click();
    await block.waitFor();
    await page.waitForLoadState("networkidle");
  }
  const lane = page.locator(`[data-lane="${nino.id}"]`);
  const b = (await block.boundingBox())!, l = (await lane.boundingBox())!;
  // Grab the middle of the block: its edges are the start and length handles.
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(l.x + 2 + b.width / 2, l.y + l.height / 2, { steps: 12 });
  await page.mouse.up();

  // Display: the 3h bar now comes first (realtime ping, or the 10 s polling fallback).
  await expect(firstBar()).toContainText(`Sand bonnet ${stamp}`, { timeout: 20_000 });
});
