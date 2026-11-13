/**
 * Classificação conservadora de eventos para a memória de DSR.
 * Não decide enquadramento jurídico: respeita o snapshot da rubrica,
 * a incidência cadastrada e o status operacional do evento.
 */
const CATEGORIES = ["overtime", "commission", "additional", "bonus", "other"];

export function summarizeDsrRemuneration(events = []) {
  const approved = events.filter((event) =>
    event.status === "approved" || event.status === "processed"
  );
  const pending = events.filter((event) => event.status === "pending");
  const valueOf = (event) => Number(event.amount ?? (Number(event.quantity ?? 0) * Number(event.unit_value ?? 0)));
  const earnings = approved.filter((event) =>
    event.item_type === "earning" &&
    event.affects_dsr === true &&
    CATEGORIES.includes(event.dsr_category)
  );
  const deductions = approved.filter((event) => event.item_type === "deduction");
  const employerCharges = approved.filter((event) => event.item_type === "employer_charge");
  const categories = Object.fromEntries(CATEGORIES.map((category) => {
    const rows = earnings.filter((event) => event.dsr_category === category);
    return [category, { count: rows.length, amount: rows.reduce((sum, event) => sum + valueOf(event), 0) }];
  }));
  return {
    earnings,
    deductions,
    employerCharges,
    pending,
    categories,
    earningsTotal: earnings.reduce((sum, event) => sum + valueOf(event), 0),
    deductionsTotal: deductions.reduce((sum, event) => sum + valueOf(event), 0),
    employerChargesTotal: employerCharges.reduce((sum, event) => sum + valueOf(event), 0),
  };
}
