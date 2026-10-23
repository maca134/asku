import { afterAll, expect, test } from "bun:test";
import { withOffset } from "../ui/form/date";

const zone = process.env.TZ;
afterAll(() => {
  delete process.env.TZ;
  if (zone) process.env.TZ = zone;
});

test("a picked time gets the phone's UTC offset on that day", () => {
  process.env.TZ = "America/New_York";
  expect(withOffset("2026-07-01T09:30")).toBe("2026-07-01T09:30-04:00");
  expect(withOffset("2026-01-15T09:30")).toBe("2026-01-15T09:30-05:00");
  process.env.TZ = "Asia/Kolkata";
  expect(withOffset("2026-10-24T23:59")).toBe("2026-10-24T23:59+05:30");
  process.env.TZ = "UTC";
  expect(withOffset("2026-10-24T00:00")).toBe("2026-10-24T00:00+00:00");
});
