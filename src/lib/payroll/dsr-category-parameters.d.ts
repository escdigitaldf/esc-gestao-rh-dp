export type DsrCategoryKey = "overtime" | "commission" | "additional" | "bonus" | "other";
export type DsrCategoryParameterRecord = {
  id: string;
  dsr_rule_id: string;
  category: DsrCategoryKey;
  unit: "days" | "hours";
  denominator: number;
  rest_units: number;
  effective_from: string;
  effective_to: string | null;
  status: string;
  version: number;
};
export function resolveDsrCategoryParameters(args?: {
  schedules?: Array<{ dsr_rule_id: string | null }>;
  parameters?: DsrCategoryParameterRecord[];
  competenceStart?: string;
  competenceEnd?: string;
}): {
  status: "no_schedule" | "ambiguous_rules" | "invalid_competence" | "ambiguous_parameters" | "ready";
  ruleId: string | null;
  byCategory: Record<DsrCategoryKey, DsrCategoryParameterRecord | null>;
  issues: string[];
};
