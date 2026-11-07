import { describe, expect, it } from "vitest";
import { emptyDB, type DB } from "./demo-store";
import { DEFAULT_SETTINGS } from "./types";
import { boardOf, findCheckoutItemIn, findReturnItemIn, historyIn } from "./lookup";

const h = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

function base(): DB {
  const d = emptyDB();
  d.settings = { ...DEFAULT_SETTINGS };
  // emptyDB() pre-fills board/busy (server data); these tests exercise the demo derivation path.
  delete d.board;
  delete d.busy;
  d.profiles = [
    {
      id: "s1",
      full_name: "Yasmine",
      email: "y@x",
      promo: "",
      role: "student",
      is_blocked: false,
      created_at: h(-100),
    },
    {
      id: "s2",
      full_name: "Omar",
      email: "o@x",
      promo: "",
      role: "student",
      is_blocked: false,
      created_at: h(-100),
    },
    {
      id: "t1",
      full_name: "Karim",
      email: "k@x",
      promo: "",
      role: "technician",
      is_blocked: false,
      created_at: h(-100),
    },
  ];
  d.equipment = [
    {
      id: "e1",
      asset_code: "CAM-001",
      qr_token: "tok",
      name: "Cam",
      category: "c",
      brand: "",
      model: "",
      location_id: "l",
      status: "available",
    },
  ];
  d.reservations = [
    {
      id: "r1",
      borrower_id: "s1",
      start_at: h(1),
      due_at: h(10),
      purpose: "Test",
      status: "approved",
      created_at: h(-1),
    },
  ];
  d.items = [{ id: "i1", reservation_id: "r1", equipment_id: "e1", status: "pending" }];
  return d;
}

describe("findCheckoutItemIn", () => {
  it("accepte l'emprunteur dans la fenêtre de retrait", () => {
    const d = base();
    d.sessionUserId = "s1";
    expect("item" in findCheckoutItemIn(d, "e1")).toBe(true);
  });
  it("refuse un autre étudiant", () => {
    const d = base();
    d.sessionUserId = "s2";
    expect("error" in findCheckoutItemIn(d, "e1")).toBe(true);
  });
  it("refuse hors fenêtre de retrait", () => {
    const d = base();
    d.sessionUserId = "s1";
    d.reservations[0]!.start_at = h(48);
    d.reservations[0]!.due_at = h(60);
    expect("error" in findCheckoutItemIn(d, "e1")).toBe(true);
  });
  it("refuse un objet en maintenance", () => {
    const d = base();
    d.sessionUserId = "s1";
    d.equipment[0]!.status = "maintenance";
    expect("error" in findCheckoutItemIn(d, "e1")).toBe(true);
  });
  it("autorise le technicien", () => {
    const d = base();
    d.sessionUserId = "t1";
    expect("item" in findCheckoutItemIn(d, "e1")).toBe(true);
  });
});

describe("findReturnItemIn", () => {
  it("retrouve l'item sorti de l'emprunteur seulement", () => {
    const d = base();
    d.items[0]!.status = "checked_out";
    d.equipment[0]!.status = "checked_out";
    d.sessionUserId = "s1";
    expect("item" in findReturnItemIn(d, "e1")).toBe(true);
    d.sessionUserId = "s2";
    expect("error" in findReturnItemIn(d, "e1")).toBe(true);
  });
});

describe("boardOf / historyIn (confidentialité)", () => {
  function out(): DB {
    const d = base();
    d.items[0]!.status = "checked_out";
    d.items[0]!.checked_out_at = h(-1);
    d.reservations[0]!.status = "active";
    return d;
  }
  it("masque le détenteur à un autre étudiant par défaut mais montre l'échéance", () => {
    const d = out();
    d.sessionUserId = "s2";
    const b = boardOf(d, "e1", false);
    expect(b.due_at).toBeTruthy();
    expect(b.holder).toBeNull();
    expect(historyIn(d, "e1")[0]?.holder_name).toBeNull();
  });
  it("montre le détenteur au technicien et à l'emprunteur", () => {
    const d = out();
    d.sessionUserId = "t1";
    expect(boardOf(d, "e1", true).holder).toBe("Yasmine");
    d.sessionUserId = "s1";
    expect(historyIn(d, "e1")[0]?.holder_name).toBe("Yasmine");
  });
  it("respecte la politique show_holder_to_students", () => {
    const d = out();
    d.sessionUserId = "s2";
    d.settings.show_holder_to_students = true;
    expect(boardOf(d, "e1", false).holder).toBe("Yasmine");
  });
  it("cache la description des incidents aux étudiants", () => {
    const d = out();
    d.sessionUserId = "s2";
    d.incidents = [
      {
        id: "n1",
        equipment_id: "e1",
        reported_by: "s1",
        description: "Écran fissuré",
        status: "open",
        created_at: h(-1),
      },
    ];
    expect(historyIn(d, "e1").find((x) => x.kind === "incident_open")?.detail).toBeNull();
    d.sessionUserId = "t1";
    expect(historyIn(d, "e1").find((x) => x.kind === "incident_open")?.detail).toContain("fissuré");
  });
});

import { busySlots } from "./lookup";
describe("busySlots", () => {
  it("ignore les objets rendus ou annulés, garde en attente et sortis", () => {
    const d = base();
    d.items.push(
      { id: "i2", reservation_id: "r1", equipment_id: "e1", status: "returned" },
      { id: "i3", reservation_id: "r1", equipment_id: "e1", status: "cancelled" },
      { id: "i4", reservation_id: "r1", equipment_id: "e1", status: "checked_out" },
    );
    expect(busySlots(d)).toHaveLength(2);
  });
});
