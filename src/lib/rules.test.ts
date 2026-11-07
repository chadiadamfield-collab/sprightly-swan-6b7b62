import { describe, expect, it } from "vitest";
import {
  findConflicts,
  minutesOverdue,
  overlaps,
  shouldBlockBorrower,
  validateReservationWindow,
  withinPickupWindow,
} from "./rules";
import { DEFAULT_SETTINGS, type Reservation, type ReservationItem } from "./types";

const d = (s: string) => new Date(s);
const res = (
  id: string,
  status: Reservation["status"],
  start: string,
  due: string,
): Reservation => ({
  id,
  borrower_id: "u",
  start_at: start,
  due_at: due,
  purpose: "",
  status,
  created_at: start,
});
const item = (
  rid: string,
  eq: string,
  status: ReservationItem["status"] = "pending",
): ReservationItem => ({
  id: rid + eq,
  reservation_id: rid,
  equipment_id: eq,
  status,
});

describe("overlaps", () => {
  it("touching intervals do not overlap", () => {
    expect(
      overlaps(
        d("2026-01-01T10:00Z"),
        d("2026-01-01T12:00Z"),
        d("2026-01-01T12:00Z"),
        d("2026-01-01T14:00Z"),
      ),
    ).toBe(false);
  });
  it("nested intervals overlap", () => {
    expect(
      overlaps(
        d("2026-01-01T10:00Z"),
        d("2026-01-01T18:00Z"),
        d("2026-01-01T12:00Z"),
        d("2026-01-01T13:00Z"),
      ),
    ).toBe(true);
  });
});

describe("findConflicts", () => {
  const reservations = [
    res("r1", "approved", "2026-01-01T10:00Z", "2026-01-02T10:00Z"),
    res("r2", "cancelled", "2026-01-01T10:00Z", "2026-01-02T10:00Z"),
  ];
  const items = [item("r1", "camA"), item("r2", "camB")];
  it("detects overlap on the same physical unit", () => {
    expect(
      findConflicts({
        equipmentIds: ["camA"],
        start: d("2026-01-01T20:00Z"),
        end: d("2026-01-03T10:00Z"),
        reservations,
        items,
      }),
    ).toEqual(["camA"]);
  });
  it("ignores cancelled reservations", () => {
    expect(
      findConflicts({
        equipmentIds: ["camB"],
        start: d("2026-01-01T20:00Z"),
        end: d("2026-01-03T10:00Z"),
        reservations,
        items,
      }),
    ).toEqual([]);
  });
  it("ignores items already returned", () => {
    expect(
      findConflicts({
        equipmentIds: ["camA"],
        start: d("2026-01-01T20:00Z"),
        end: d("2026-01-03T10:00Z"),
        reservations,
        items: [item("r1", "camA", "returned")],
      }),
    ).toEqual([]);
  });
});

describe("overdue", () => {
  it("applies grace minutes", () => {
    expect(minutesOverdue(d("2026-01-01T10:00Z"), d("2026-01-01T10:10Z"), 15)).toBe(0);
    expect(minutesOverdue(d("2026-01-01T10:00Z"), d("2026-01-01T10:45Z"), 15)).toBe(30);
  });
  it("blocks borrower only after configured hours", () => {
    const s = { ...DEFAULT_SETTINGS, overdue_grace_minutes: 0, block_after_overdue_hours: 24 };
    expect(shouldBlockBorrower(d("2026-01-01T10:00Z"), d("2026-01-02T09:00Z"), s)).toBe(false);
    expect(shouldBlockBorrower(d("2026-01-01T10:00Z"), d("2026-01-02T10:00Z"), s)).toBe(true);
  });
});

describe("windows", () => {
  it("rejects loans longer than max hours", () => {
    expect(
      validateReservationWindow(
        d("2030-01-01T10:00Z"),
        d("2030-01-05T10:00Z"),
        DEFAULT_SETTINGS,
        d("2029-12-31T00:00Z"),
      ),
    ).toMatch(/72/);
  });
  it("pickup window opens before start", () => {
    expect(
      withinPickupWindow(
        d("2026-01-01T10:00Z"),
        d("2026-01-02T10:00Z"),
        d("2026-01-01T08:30Z"),
        120,
      ),
    ).toBe(true);
    expect(
      withinPickupWindow(
        d("2026-01-01T10:00Z"),
        d("2026-01-02T10:00Z"),
        d("2026-01-01T07:30Z"),
        120,
      ),
    ).toBe(false);
  });
});
