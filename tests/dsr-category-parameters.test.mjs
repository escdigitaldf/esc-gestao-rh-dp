import test from "node:test";
import assert from "node:assert/strict";
import { resolveDsrCategoryParameters } from "../src/lib/payroll/dsr-category-parameters.mjs";

const param = (overrides = {}) => ({
  id: "p1", dsr_rule_id: "rule-a", category: "overtime", unit: "days",
  denominator: 30, rest_units: 4, effective_from: "2026-11-01",
  effective_to: "2026-11-30", status: "validated", version: 1, ...overrides,
});

test("resolve parâmetro validado quando uma única regra cobre a competência", () => {
  const result = resolveDsrCategoryParameters({
    schedules: [{ dsr_rule_id: "rule-a" }],
    parameters: [param()],
    competenceStart: "2026-11-01",
    competenceEnd: "2026-11-30",
  });
  assert.equal(result.status, "ready");
  assert.equal(result.byCategory.overtime.id, "p1");
});

test("aceita várias escalas na competência quando todas usam a mesma regra", () => {
  const result = resolveDsrCategoryParameters({
    schedules: [{ dsr_rule_id: "rule-a" }, { dsr_rule_id: "rule-a" }],
    parameters: [param()],
    competenceStart: "2026-11-01",
    competenceEnd: "2026-11-30",
  });
  assert.equal(result.status, "ready");
  assert.equal(result.ruleId, "rule-a");
});

test("bloqueia consolidação oficial quando há regras diferentes na competência", () => {
  const result = resolveDsrCategoryParameters({
    schedules: [{ dsr_rule_id: "rule-a" }, { dsr_rule_id: "rule-b" }],
    parameters: [param(), param({ id: "p2", dsr_rule_id: "rule-b" })],
    competenceStart: "2026-11-01",
    competenceEnd: "2026-11-30",
  });
  assert.equal(result.status, "ambiguous_rules");
  assert.equal(result.byCategory.overtime, null);
});

test("bloqueia escala sem regra normativa vinculada", () => {
  const result = resolveDsrCategoryParameters({
    schedules: [{ dsr_rule_id: "rule-a" }, { dsr_rule_id: null }],
    parameters: [param()],
    competenceStart: "2026-11-01",
    competenceEnd: "2026-11-30",
  });
  assert.equal(result.status, "ambiguous_rules");
});

test("não utiliza parâmetro cuja vigência não cobre toda a competência", () => {
  const result = resolveDsrCategoryParameters({
    schedules: [{ dsr_rule_id: "rule-a" }],
    parameters: [param({ effective_from: "2026-11-10" })],
    competenceStart: "2026-11-01",
    competenceEnd: "2026-11-30",
  });
  assert.equal(result.status, "ready");
  assert.equal(result.byCategory.overtime, null);
});

test("bloqueia múltiplas versões validadas simultâneas da mesma categoria", () => {
  const result = resolveDsrCategoryParameters({
    schedules: [{ dsr_rule_id: "rule-a" }],
    parameters: [param(), param({ id: "p2", version: 2 })],
    competenceStart: "2026-11-01",
    competenceEnd: "2026-11-30",
  });
  assert.equal(result.status, "ambiguous_parameters");
  assert.equal(result.byCategory.overtime, null);
});
