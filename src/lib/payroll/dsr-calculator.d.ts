export type DsrPreviewUnit = "days" | "hours";

export interface DsrPreviewInput {
  baseAmount: number;
  denominator: number;
  restUnits: number;
  unit?: DsrPreviewUnit;
  decimalPlaces?: number;
}

export type DsrPreviewResult =
  | {
      ok: true;
      status: "preview_only";
      amount: number;
      unrounded: number;
      audit: {
        formula: "baseAmount / denominator * restUnits";
        baseAmount: number;
        denominator: number;
        restUnits: number;
        unit: DsrPreviewUnit;
        decimalPlaces: number;
        rounding: string;
      };
    }
  | { ok: false; code: string; message: string };

export function calculateDsrPreview(input: DsrPreviewInput): DsrPreviewResult;
