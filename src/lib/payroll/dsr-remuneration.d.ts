export type DsrRemunerationCategory = "overtime" | "commission" | "additional" | "bonus" | "other";
export interface DsrRemunerationEvent {
  status: string;
  item_type: "earning" | "deduction" | "employer_charge";
  dsr_category: string;
  affects_dsr: boolean;
  amount: number | null;
  quantity: number;
  unit_value: number;
}
export interface DsrRemunerationSummary {
  earnings: DsrRemunerationEvent[];
  deductions: DsrRemunerationEvent[];
  employerCharges: DsrRemunerationEvent[];
  pending: DsrRemunerationEvent[];
  categories: Record<DsrRemunerationCategory, { count: number; amount: number }>;
  earningsTotal: number;
  deductionsTotal: number;
  employerChargesTotal: number;
}
export function summarizeDsrRemuneration(events?: DsrRemunerationEvent[]): DsrRemunerationSummary;
