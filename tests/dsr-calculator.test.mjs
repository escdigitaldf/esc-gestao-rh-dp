import test from "node:test";
import assert from "node:assert/strict";
import { calculateDsrPreview } from "../src/lib/payroll/dsr-calculator.mjs";

test("calculates proportional preview using explicit day inputs", () => {
  const result = calculateDsrPreview({
    baseAmount: 1200,
    denominator: 24,
    restUnits: 4,
    unit: "days",
  });
  assert.equal(result.ok, true);
  assert.equal(result.amount, 200);
  assert.equal(result.status, "preview_only");
  assert.equal(result.audit.formula, "baseAmount / denominator * restUnits");
});

test("calculates proportional preview using explicit hour inputs", () => {
  const result = calculateDsrPreview({
    baseAmount: 875,
    denominator: 140,
    restUnits: 16,
    unit: "hours",
  });
  assert.equal(result.ok, true);
  assert.equal(result.amount, 100);
  assert.equal(result.audit.unit, "hours");
});

test("rounds only the final result to cents", () => {
  const result = calculateDsrPreview({
    baseAmount: 100,
    denominator: 6,
    restUnits: 1,
  });
  assert.equal(result.ok, true);
  assert.equal(result.amount, 16.67);
  assert.ok(result.unrounded > 16.66 && result.unrounded < 16.67);
});

test("rejects zero or negative denominators", () => {
  for (const denominator of [0, -1]) {
    const result = calculateDsrPreview({ baseAmount: 100, denominator, restUnits: 2 });
    assert.equal(result.ok, false);
    assert.equal(result.code, "INVALID_DENOMINATOR");
  }
});

test("rejects negative remuneration base and rest units", () => {
  assert.equal(
    calculateDsrPreview({ baseAmount: -1, denominator: 20, restUnits: 2 }).code,
    "NEGATIVE_BASE",
  );
  assert.equal(
    calculateDsrPreview({ baseAmount: 100, denominator: 20, restUnits: -1 }).code,
    "NEGATIVE_REST_UNITS",
  );
});

test("rejects non-finite inputs, invalid units and invalid precision", () => {
  assert.equal(
    calculateDsrPreview({ baseAmount: Number.NaN, denominator: 20, restUnits: 2 }).code,
    "INVALID_NUMBER",
  );
  assert.equal(
    calculateDsrPreview({ baseAmount: 100, denominator: 20, restUnits: 2, unit: "weeks" }).code,
    "INVALID_UNIT",
  );
  assert.equal(
    calculateDsrPreview({ baseAmount: 100, denominator: 20, restUnits: 2, decimalPlaces: 5 }).code,
    "INVALID_PRECISION",
  );
});
