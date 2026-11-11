import test from "node:test";
import assert from "node:assert/strict";
import { summarizeDsrRemuneration } from "../src/lib/payroll/dsr-remuneration.mjs";

const event = (overrides = {}) => ({
  id: "e1", item_type: "earning", dsr_category: "overtime",
  affects_dsr: true, amount: 100, quantity: 0, unit_value: 0,
  status: "approved", ...overrides,
});

test("separates approved earnings into all configured DSR categories", () => {
  const rows = [
    event({ id: "1", dsr_category: "overtime", amount: 120 }),
    event({ id: "2", dsr_category: "commission", amount: 80 }),
    event({ id: "3", dsr_category: "additional", amount: 50 }),
    event({ id: "4", dsr_category: "bonus", amount: 30 }),
    event({ id: "5", dsr_category: "other", amount: 20 }),
  ];
  const result = summarizeDsrRemuneration(rows);
  assert.equal(result.earningsTotal, 300);
  assert.deepEqual(Object.keys(result.categories), ["overtime", "commission", "additional", "bonus", "other"]);
  assert.equal(result.categories.overtime.amount, 120);
  assert.equal(result.categories.commission.amount, 80);
  assert.equal(result.categories.additional.amount, 50);
  assert.equal(result.categories.bonus.amount, 30);
  assert.equal(result.categories.other.amount, 20);
});

test("excludes deductions, employer charges, pending, rejected and non-DSR events from earnings", () => {
  const result = summarizeDsrRemuneration([
    event({ id: "earning", amount: 100 }),
    event({ id: "deduction", item_type: "deduction", amount: 25 }),
    event({ id: "charge", item_type: "employer_charge", amount: 40 }),
    event({ id: "pending", status: "pending", amount: 60 }),
    event({ id: "rejected", status: "rejected", amount: 70 }),
    event({ id: "no-incidence", affects_dsr: false, amount: 80 }),
    event({ id: "bad-category", dsr_category: "not_applicable", amount: 90 }),
  ]);
  assert.equal(result.earningsTotal, 100);
  assert.equal(result.deductionsTotal, 25);
  assert.equal(result.employerChargesTotal, 40);
  assert.equal(result.pending.length, 1);
  assert.equal(result.earnings.length, 1);
});

test("uses quantity multiplied by unit value when amount is null", () => {
  const result = summarizeDsrRemuneration([
    event({ amount: null, quantity: 2.5, unit_value: 40 }),
  ]);
  assert.equal(result.earningsTotal, 100);
});

test("includes processed events and preserves category totals", () => {
  const result = summarizeDsrRemuneration([
    event({ status: "processed", dsr_category: "commission", amount: 175 }),
  ]);
  assert.equal(result.earningsTotal, 175);
  assert.equal(result.categories.commission.count, 1);
});
