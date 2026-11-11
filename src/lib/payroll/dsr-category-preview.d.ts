export type DsrCategory = "overtime" | "commission" | "additional" | "bonus" | "other";
export interface DsrCategoryInput {
  amount: number;
  count: number;
}
export interface DsrCategoryParameters {
  denominator?: string | number;
  restUnits?: string | number;
  unit?: "days" | "hours";
}
export interface DsrCategoryPreview {
  status: "invalid_base" | "not_applicable" | "incomplete" | "invalid" | "calculated";
  baseAmount: number;
  count: number;
  message: string;
  parameters?: { denominator: number; restUnits: number; unit: "days" | "hours" };
  result?: { ok: boolean; amount?: number; audit?: { denominator: number; restUnits: number; unit: "days" | "hours" } };
}
export function calculateDsrCategoryPreviews(args?: {
  categories?: Partial<Record<DsrCategory, DsrCategoryInput>>;
  parameters?: Partial<Record<DsrCategory, DsrCategoryParameters>>;
}): Record<DsrCategory, DsrCategoryPreview>;
