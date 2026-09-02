import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBuyPlan, type BuyEngineInput } from "./buy-engine.ts";

const GODOWN = "dept-godown";
const OFFICE = "dept-office";
const SUPPLIER_A = "supplier-a";
const RAW_1 = "raw-1";
const RAW_2 = "raw-2";
const FLAVOUR_1 = "flavour-1";

function baseInput(overrides: Partial<BuyEngineInput> = {}): BuyEngineInput {
  return {
    demand: [],
    stockBalances: [],
    openPoLines: [],
    currentRecipeVersions: [],
    defaultSuppliers: [{ rawMaterialId: RAW_1, supplierId: SUPPLIER_A }],
    ...overrides,
  };
}

test("plain raw demand with no stock or open PO buys the full amount", () => {
  const result = computeBuyPlan(
    baseInput({
      demand: [
        { itemType: "raw", itemId: RAW_1, qtyG: 5000, departmentId: GODOWN },
      ],
    }),
  );
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].supplierId, SUPPLIER_A);
  assert.equal(result.groups[0].departmentId, GODOWN);
  assert.deepEqual(result.groups[0].lines, [
    {
      itemType: "raw",
      itemId: RAW_1,
      neededG: 5000,
      haveG: 0,
      onOrderG: 0,
      buyG: 5000,
    },
  ]);
  assert.equal(result.issues.length, 0);
});

test("raw demand nets off existing stock at the same department", () => {
  const result = computeBuyPlan(
    baseInput({
      demand: [
        { itemType: "raw", itemId: RAW_1, qtyG: 5000, departmentId: GODOWN },
      ],
      stockBalances: [
        { departmentId: GODOWN, itemType: "raw", itemId: RAW_1, qtyG: 2000 },
      ],
    }),
  );
  assert.equal(result.groups[0].lines[0].buyG, 3000);
});

test("raw demand nets off both stock and already-open PO quantity", () => {
  const result = computeBuyPlan(
    baseInput({
      demand: [
        { itemType: "raw", itemId: RAW_1, qtyG: 5000, departmentId: GODOWN },
      ],
      stockBalances: [
        { departmentId: GODOWN, itemType: "raw", itemId: RAW_1, qtyG: 2000 },
      ],
      openPoLines: [
        {
          departmentId: GODOWN,
          itemType: "raw",
          itemId: RAW_1,
          qtyG: 1500,
        },
      ],
    }),
  );
  assert.equal(result.groups[0].lines[0].buyG, 1500);
});

test("stock and open PO covering demand fully produces no shortfall line at all", () => {
  const result = computeBuyPlan(
    baseInput({
      demand: [
        { itemType: "raw", itemId: RAW_1, qtyG: 5000, departmentId: GODOWN },
      ],
      stockBalances: [
        { departmentId: GODOWN, itemType: "raw", itemId: RAW_1, qtyG: 3000 },
      ],
      openPoLines: [
        {
          departmentId: GODOWN,
          itemType: "raw",
          itemId: RAW_1,
          qtyG: 2000,
        },
      ],
    }),
  );
  assert.equal(result.groups.length, 0);
  assert.equal(result.issues.length, 0);
});

test("flavour demand nets off mixed flavour stock before exploding into raw material need", () => {
  const result = computeBuyPlan(
    baseInput({
      demand: [
        { itemType: "flavour", itemId: FLAVOUR_1, qtyG: 1000, departmentId: GODOWN },
      ],
      stockBalances: [
        { departmentId: GODOWN, itemType: "flavour", itemId: FLAVOUR_1, qtyG: 1000 },
      ],
      currentRecipeVersions: [
        {
          flavourId: FLAVOUR_1,
          wastagePct: 0,
          lines: [{ rawMaterialId: RAW_1, percentage: 100 }],
        },
      ],
    }),
  );
  // Fully covered by existing flavour stock — nothing should explode.
  assert.equal(result.groups.length, 0);
});

test("flavour demand explodes the remainder through the current recipe version with wastage", () => {
  const result = computeBuyPlan(
    baseInput({
      demand: [
        { itemType: "flavour", itemId: FLAVOUR_1, qtyG: 1000, departmentId: GODOWN },
      ],
      stockBalances: [
        { departmentId: GODOWN, itemType: "flavour", itemId: FLAVOUR_1, qtyG: 200 },
      ],
      currentRecipeVersions: [
        {
          flavourId: FLAVOUR_1,
          wastagePct: 10,
          lines: [
            { rawMaterialId: RAW_1, percentage: 60 },
            { rawMaterialId: RAW_2, percentage: 40 },
          ],
        },
      ],
      defaultSuppliers: [
        { rawMaterialId: RAW_1, supplierId: SUPPLIER_A },
        { rawMaterialId: RAW_2, supplierId: SUPPLIER_A },
      ],
    }),
  );
  // remaining flavour need = 1000 - 200 = 800
  // RAW_1: round(800 * 0.60 * 1.10) = round(528) = 528
  // RAW_2: round(800 * 0.40 * 1.10) = round(352) = 352
  assert.equal(result.groups.length, 1);
  const lines = result.groups[0].lines.sort((a, b) =>
    a.itemId.localeCompare(b.itemId),
  );
  assert.deepEqual(
    lines.map((l) => [l.itemId, l.buyG]),
    [
      [RAW_1, 528],
      [RAW_2, 352],
    ],
  );
});

test("a flavour with no current recipe version is reported as an issue, not a crash", () => {
  const result = computeBuyPlan(
    baseInput({
      demand: [
        { itemType: "flavour", itemId: FLAVOUR_1, qtyG: 1000, departmentId: GODOWN },
      ],
    }),
  );
  assert.equal(result.groups.length, 0);
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0], /no current recipe version/);
});

test("a raw material with no default supplier groups under a null supplier and is flagged", () => {
  const result = computeBuyPlan(
    baseInput({
      demand: [
        { itemType: "raw", itemId: RAW_2, qtyG: 1000, departmentId: GODOWN },
      ],
      defaultSuppliers: [],
    }),
  );
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].supplierId, null);
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0], /no default supplier/);
});

test("the same raw material demanded by two departments never nets against the wrong department's stock", () => {
  const result = computeBuyPlan(
    baseInput({
      demand: [
        { itemType: "raw", itemId: RAW_1, qtyG: 5000, departmentId: GODOWN },
        { itemType: "raw", itemId: RAW_1, qtyG: 3000, departmentId: OFFICE },
      ],
      // Only the godown has stock — the office has none of its own.
      stockBalances: [
        { departmentId: GODOWN, itemType: "raw", itemId: RAW_1, qtyG: 4000 },
      ],
    }),
  );
  const godownGroup = result.groups.find((g) => g.departmentId === GODOWN);
  const officeGroup = result.groups.find((g) => g.departmentId === OFFICE);
  // Godown's own 4000g stock nets its own 5000g need down to 1000g.
  assert.equal(godownGroup?.lines[0].buyG, 1000);
  // Office has no stock of its own — its full 3000g need buys in full,
  // never reduced by the godown's stock.
  assert.equal(officeGroup?.lines[0].buyG, 3000);
});

test("multiple flavours sharing a raw material combine their exploded need within one department", () => {
  const FLAVOUR_2 = "flavour-2";
  const result = computeBuyPlan(
    baseInput({
      demand: [
        { itemType: "flavour", itemId: FLAVOUR_1, qtyG: 1000, departmentId: GODOWN },
        { itemType: "flavour", itemId: FLAVOUR_2, qtyG: 500, departmentId: GODOWN },
      ],
      currentRecipeVersions: [
        {
          flavourId: FLAVOUR_1,
          wastagePct: 0,
          lines: [{ rawMaterialId: RAW_1, percentage: 100 }],
        },
        {
          flavourId: FLAVOUR_2,
          wastagePct: 0,
          lines: [{ rawMaterialId: RAW_1, percentage: 100 }],
        },
      ],
    }),
  );
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].lines[0].buyG, 1500);
});

test("direct raw demand and raw demand exploded from a flavour combine for the same material", () => {
  const result = computeBuyPlan(
    baseInput({
      demand: [
        { itemType: "raw", itemId: RAW_1, qtyG: 1000, departmentId: GODOWN },
        { itemType: "flavour", itemId: FLAVOUR_1, qtyG: 1000, departmentId: GODOWN },
      ],
      currentRecipeVersions: [
        {
          flavourId: FLAVOUR_1,
          wastagePct: 0,
          lines: [{ rawMaterialId: RAW_1, percentage: 100 }],
        },
      ],
    }),
  );
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].lines[0].buyG, 2000);
});

const FLAVOUR_2 = "flavour-2";
const SUPPLIER_B = "supplier-b";

test("a flavour flagged directPurchase is bought whole, never exploded", () => {
  const result = computeBuyPlan(
    baseInput({
      demand: [
        {
          itemType: "flavour",
          itemId: FLAVOUR_1,
          qtyG: 4000,
          departmentId: GODOWN,
          directPurchase: true,
        },
      ],
      // A recipe exists, but a direct purchase must ignore it entirely.
      currentRecipeVersions: [
        {
          flavourId: FLAVOUR_1,
          wastagePct: 2,
          lines: [{ rawMaterialId: RAW_1, percentage: 100 }],
        },
      ],
      flavourSuppliers: [{ flavourId: FLAVOUR_1, supplierId: SUPPLIER_B }],
    }),
  );

  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].supplierId, SUPPLIER_B);
  assert.deepEqual(result.groups[0].lines, [
    {
      itemType: "flavour",
      itemId: FLAVOUR_1,
      neededG: 4000,
      haveG: 0,
      onOrderG: 0,
      buyG: 4000,
    },
  ]);
  assert.equal(result.issues.length, 0);
});

test("a direct flavour purchase nets off flavour stock and open flavour POs", () => {
  const result = computeBuyPlan(
    baseInput({
      demand: [
        {
          itemType: "flavour",
          itemId: FLAVOUR_1,
          qtyG: 10000,
          departmentId: GODOWN,
          directPurchase: true,
        },
      ],
      stockBalances: [
        {
          departmentId: GODOWN,
          itemType: "flavour",
          itemId: FLAVOUR_1,
          qtyG: 3000,
        },
      ],
      openPoLines: [
        {
          departmentId: GODOWN,
          itemType: "flavour",
          itemId: FLAVOUR_1,
          qtyG: 2000,
        },
      ],
      flavourSuppliers: [{ flavourId: FLAVOUR_1, supplierId: SUPPLIER_B }],
    }),
  );

  assert.deepEqual(result.groups[0].lines, [
    {
      itemType: "flavour",
      itemId: FLAVOUR_1,
      neededG: 10000,
      haveG: 3000,
      onOrderG: 2000,
      buyG: 5000,
    },
  ]);
});

test("a directly-purchased flavour with no supplier is flagged, not silently grouped", () => {
  const result = computeBuyPlan(
    baseInput({
      demand: [
        {
          itemType: "flavour",
          itemId: FLAVOUR_2,
          qtyG: 1000,
          departmentId: GODOWN,
          directPurchase: true,
        },
      ],
    }),
  );

  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].supplierId, null);
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0], /no default supplier/);
});

test("direct flavour purchase and exploded flavour demand coexist in one department", () => {
  const result = computeBuyPlan(
    baseInput({
      demand: [
        // Mixed in-house: explodes to RAW_1.
        {
          itemType: "flavour",
          itemId: FLAVOUR_1,
          qtyG: 1000,
          departmentId: GODOWN,
        },
        // Bought ready-made: stays a flavour line.
        {
          itemType: "flavour",
          itemId: FLAVOUR_2,
          qtyG: 2000,
          departmentId: GODOWN,
          directPurchase: true,
        },
      ],
      currentRecipeVersions: [
        {
          flavourId: FLAVOUR_1,
          wastagePct: 0,
          lines: [{ rawMaterialId: RAW_1, percentage: 100 }],
        },
      ],
      flavourSuppliers: [{ flavourId: FLAVOUR_2, supplierId: SUPPLIER_B }],
    }),
  );

  const rawGroup = result.groups.find((g) => g.supplierId === SUPPLIER_A);
  const flavourGroup = result.groups.find((g) => g.supplierId === SUPPLIER_B);

  assert.deepEqual(
    rawGroup?.lines.map((l) => [l.itemType, l.itemId, l.buyG]),
    [["raw", RAW_1, 1000]],
  );
  assert.deepEqual(
    flavourGroup?.lines.map((l) => [l.itemType, l.itemId, l.buyG]),
    [["flavour", FLAVOUR_2, 2000]],
  );
});
