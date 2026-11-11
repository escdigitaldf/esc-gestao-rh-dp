/**
 * Generic proportional DSR preview.
 *
 * This module deliberately does not infer legal denominators or rest-day counts.
 * The caller must supply values supported by the employee's validated schedule
 * and the applicable collective/legal rule. It never writes to payroll.
 */
export function calculateDsrPreview({
  baseAmount,
  denominator,
  restUnits,
  unit = "days",
  decimalPlaces = 2,
}) {
  const values = { baseAmount, denominator, restUnits, decimalPlaces };
  for (const [name, value] of Object.entries(values)) {
    if (!Number.isFinite(value)) {
      return { ok: false, code: "INVALID_NUMBER", message: `O campo ${name} deve ser numérico e finito.` };
    }
  }
  if (baseAmount < 0) {
    return { ok: false, code: "NEGATIVE_BASE", message: "A base remuneratória não pode ser negativa." };
  }
  if (denominator <= 0) {
    return { ok: false, code: "INVALID_DENOMINATOR", message: "O denominador deve ser maior que zero." };
  }
  if (restUnits < 0) {
    return { ok: false, code: "NEGATIVE_REST_UNITS", message: "A quantidade de repousos não pode ser negativa." };
  }
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 4) {
    return { ok: false, code: "INVALID_PRECISION", message: "A precisão deve ser um número inteiro entre zero e quatro." };
  }
  if (unit !== "days" && unit !== "hours") {
    return { ok: false, code: "INVALID_UNIT", message: "A unidade deve ser days ou hours." };
  }

  const unrounded = (baseAmount / denominator) * restUnits;
  const factor = 10 ** decimalPlaces;
  const amount = Math.round((unrounded + Number.EPSILON) * factor) / factor;

  return {
    ok: true,
    status: "preview_only",
    amount,
    unrounded,
    audit: {
      formula: "baseAmount / denominator * restUnits",
      baseAmount,
      denominator,
      restUnits,
      unit,
      decimalPlaces,
      rounding: "arredondamento comercial ao final da operação",
    },
  };
}
