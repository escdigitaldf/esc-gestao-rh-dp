import test from "node:test";
import assert from "node:assert/strict";
import { calculateDsrCategoryPreviews } from "../src/lib/payroll/dsr-category-preview.mjs";

const categories = {
  overtime: { amount: 300, count: 2 },
  commission: { amount: 150, count: 1 },
  additional: { amount: 0, count: 0 },
  bonus: { amount: 75, count: 1 },
  other: { amount: 0, count: 0 },
};

test("calculates each populated category with its own explicit parameters", () => {
  const result = calculateDsrCategoryPreviews({
    categories,
    parameters: {
      overtime: { denominator: "200", restUnits: "24", unit: "hours" },
      commission: { denominator: "25", restUnits: "5", unit: "days" },
      bonus: { denominator: "25", restUnits: "5", unit: "days" },
    },
  });
  assert.equal(result.overtime.status, "calculated");
  assert.equal(result.overtime.result.amount, 36);
  assert.equal(result.commission.result.amount, 30);
  assert.equal(result.bonus.result.amount, 15);
});

test("does not infer parameters for a populated category", () => {
  const result = calculateDsrCategoryPreviews({ categories });
  assert.equal(result.overtime.status, "incomplete");
  assert.match(result.overtime.message, /Informe denominador/);
});

test("marks empty categories as not applicable without requiring inputs", () => {
  const result = calculateDsrCategoryPreviews({ categories });
  assert.equal(result.additional.status, "not_applicable");
  assert.equal(result.other.status, "not_applicable");
});

test("invalid denominator or unit blocks only its own category preview", () => {
  const result = calculateDsrCategoryPreviews({
    categories,
    parameters: {
      overtime: { denominator: "0", restUnits: "4", unit: "days" },
      commission: { denominator: "20", restUnits: "4", unit: "weeks" },
      bonus: { denominator: "25", restUnits: "5", unit: "days" },
    },
  });
  assert.equal(result.overtime.status, "invalid");
  assert.equal(result.commission.status, "invalid");
  assert.equal(result.bonus.status, "calculated");
});

test("does not produce a payroll entry or mutate the source categories", () => {
  const original = structuredClone(categories);
  const result = calculateDsrCategoryPreviews({
    categories,
    parameters: { overtime: { denominator: "200", restUnits: "24", unit: "hours" } },
  });
  assert.deepEqual(categories, original);
  assert.equal(Object.hasOwn(result.overtime, "payrollEntry"), false);
});
