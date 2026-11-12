const CATEGORIES = ["overtime", "commission", "additional", "bonus", "other"];

/**
 * Resolve only one unambiguous normative rule for the entire competence.
 * Multiple schedule rows may share the same rule; different rules block the
 * official preview because monthly remuneration has not been apportioned
 * between the rule periods.
 */
export function resolveDsrCategoryParameters({
  schedules = [],
  parameters = [],
  competenceStart,
  competenceEnd,
} = {}) {
  const byCategory = Object.fromEntries(CATEGORIES.map((category) => [category, null]));
  if (!Array.isArray(schedules) || schedules.length === 0) {
    return { status: "no_schedule", ruleId: null, byCategory, issues: ["Nenhuma escala cobre a competência."] };
  }

  const ruleIds = schedules.map((schedule) => schedule?.dsr_rule_id);
  if (ruleIds.some((id) => typeof id !== "string" || !id.trim())) {
    return { status: "ambiguous_rules", ruleId: null, byCategory, issues: ["Existe escala sem vínculo a uma regra normativa."] };
  }

  const uniqueRuleIds = [...new Set(ruleIds)];
  if (uniqueRuleIds.length !== 1) {
    return { status: "ambiguous_rules", ruleId: null, byCategory, issues: ["Há mais de uma regra normativa na competência; separe a base por período antes de consolidar o DSR."] };
  }

  if (typeof competenceStart !== "string" || typeof competenceEnd !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(competenceStart) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(competenceEnd) ||
      competenceEnd < competenceStart) {
    return { status: "invalid_competence", ruleId: uniqueRuleIds[0], byCategory, issues: ["Competência inválida."] };
  }

  const candidates = parameters.filter((parameter) =>
    parameter?.status === "validated" &&
    parameter.dsr_rule_id === uniqueRuleIds[0] &&
    parameter.effective_from <= competenceStart &&
    (!parameter.effective_to || parameter.effective_to >= competenceEnd) &&
    CATEGORIES.includes(parameter.category)
  );

  const issues = [];
  for (const category of CATEGORIES) {
    const matches = candidates.filter((parameter) => parameter.category === category);
    if (matches.length === 1) byCategory[category] = matches[0];
    else if (matches.length > 1) issues.push("Mais de um parâmetro validado para " + category + ".");
  }

  return {
    status: issues.length ? "ambiguous_parameters" : "ready",
    ruleId: uniqueRuleIds[0],
    byCategory,
    issues,
  };
}
