import { calculateDsrPreview } from "./dsr-calculator.mjs";

const CATEGORIES = ["overtime", "commission", "additional", "bonus", "other"];

/**
 * Produces independent, explicitly parameterized DSR previews per remuneration
 * category. No denominator, rest-day count, or unit is inferred.
 */
export function calculateDsrCategoryPreviews({ categories = {}, parameters = {} } = {}) {
  return Object.fromEntries(CATEGORIES.map((category) => {
    const source = categories[category] || { amount: 0, count: 0 };
    const baseAmount = Number(source.amount ?? 0);
    const count = Number(source.count ?? 0);
    if (!Number.isFinite(baseAmount) || baseAmount < 0) {
      return [category, { status: "invalid_base", baseAmount, count, message: "Base da categoria inválida." }];
    }
    if (baseAmount === 0) {
      return [category, { status: "not_applicable", baseAmount, count, message: "Sem base nesta categoria." }];
    }
    const input = parameters[category] || {};
    if (input.denominator === undefined || String(input.denominator).trim() === "" ||
        input.restUnits === undefined || String(input.restUnits).trim() === "" ||
        (input.unit !== "days" && input.unit !== "hours")) {
      return [category, { status: "incomplete", baseAmount, count, message: "Informe denominador, repousos/unidades e unidade para esta categoria." }];
    }
    const result = calculateDsrPreview({
      baseAmount,
      denominator: Number(input.denominator),
      restUnits: Number(input.restUnits),
      unit: input.unit,
      decimalPlaces: 2,
    });
    return [category, {
      status: result.ok ? "calculated" : "invalid",
      baseAmount,
      count,
      parameters: { denominator: Number(input.denominator), restUnits: Number(input.restUnits), unit: input.unit },
      result,
      message: result.ok ? "Prévia matemática disponível." : result.message,
    }];
  }));
}
