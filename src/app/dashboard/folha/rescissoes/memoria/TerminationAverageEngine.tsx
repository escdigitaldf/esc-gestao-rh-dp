"use client";

import { useEffect, useMemo, useState } from "react";
import { Calculator, ShieldAlert, History } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  organizationId: string;
  terminationCaseId: string;
  employeeId: string;
  terminationDate: string;
  userId: string;
  existingCodes: string[];
  onSaved: () => Promise<void> | void;
};
type EventRow = {
  variable_event_id: string; competence_month: string; code: string;
  description: string; event_amount: number; event_status: string;
  reconciliation_status: string; rubric_id: string | null;
};
type RubricRow = {
  id: string; code: string; description: string; item_type: string;
  affects_13th: boolean; affects_vacation: boolean;
};
type Evidence = { month: string; amount: number; count: number };
type AverageKind = "thirteenth" | "vacation" | "notice" | "commission" | "overtime" | "additional" | "dsr";
const kinds: { value: AverageKind; label: string; code: string; incidence: "13th" | "vacation" | "any"; description: string }[] = [
  { value: "thirteenth", label: "Média para 13º salário", code: "MEDIA_13_SALARIO", incidence: "13th", description: "Parcelas variáveis que integram a remuneração do 13º, conforme sua natureza e regra aplicável." },
  { value: "vacation", label: "Média para férias + 1/3", code: "MEDIA_FERIAS", incidence: "vacation", description: "Parcelas variáveis que integram a remuneração de férias, observados período e critério legal/coletivo." },
  { value: "notice", label: "Média para aviso-prévio", code: "MEDIA_AVISO_PREVIO", incidence: "any", description: "Selecione apenas parcelas que compõem a remuneração do aviso, após validar a regra aplicável." },
  { value: "commission", label: "Comissões", code: "MEDIA_COMISSOES", incidence: "any", description: "A regra de apuração pode exigir período e atualização específicos; confirme a norma vigente." },
  { value: "overtime", label: "Horas extras", code: "MEDIA_HORAS_EXTRAS", incidence: "any", description: "A integração depende da habitualidade, natureza, período e critério legal/coletivo." },
  { value: "additional", label: "Adicionais", code: "MEDIA_ADICIONAIS", incidence: "any", description: "Avalie separadamente cada adicional e sua base de integração." },
  { value: "dsr", label: "DSR sobre parcelas variáveis", code: "MEDIA_DSR_VARIAVEIS", incidence: "any", description: "Não some DSR novamente se ele já estiver incorporado aos valores conciliados." }
];

const money = (n: number) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const monthLabel = (value: string) => {
  const [year, month] = value.slice(0, 7).split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export default function TerminationAverageEngine({ organizationId, terminationCaseId, employeeId, terminationDate, userId, existingCodes, onSaved }: Props) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [rubrics, setRubrics] = useState<Record<string, RubricRow>>({});
  const [kind, setKind] = useState<AverageKind>("thirteenth");
  const [windowMonths, setWindowMonths] = useState("12");
  const [divisorMode, setDivisorMode] = useState<"calendar" | "occurrence" | "manual">("calendar");
  const [manualDivisor, setManualDivisor] = useState("12");
  const [selectedRubrics, setSelectedRubrics] = useState<string[]>([]);
  const [ruleReference, setRuleReference] = useState("");
  const [ruleNotes, setRuleNotes] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const periodStart = useMemo(() => {
    const end = new Date(terminationDate + "T00:00:00Z");
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - Number(windowMonths) + 1, 1));
    return start.toISOString().slice(0, 10);
  }, [terminationDate, windowMonths]);
  const periodEnd = terminationDate.slice(0, 7) + "-01";
  const months = useMemo(() => {
    const start = new Date(periodStart + "T00:00:00Z");
    return Array.from({ length: Number(windowMonths) }, (_, i) => {
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
      return d.toISOString().slice(0, 10);
    });
  }, [periodStart, windowMonths]);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true); setError("");
      const s = createClient();
      const { data, error: queryError } = await s.from("payroll_variable_event_reconciliation")
        .select("variable_event_id,competence_month,code,description,event_amount,event_status,reconciliation_status,rubric_id")
        .eq("organization_id", organizationId).eq("employee_id", employeeId)
        .eq("event_status", "processed").eq("reconciliation_status", "reconciled")
        .gte("competence_month", periodStart).lte("competence_month", periodEnd)
        .order("competence_month", { ascending: true });
      if (!active) return;
      if (queryError) { setError(queryError.message); setLoading(false); return; }
      const rows = (data || []) as EventRow[];
      const ids = [...new Set(rows.map(x => x.rubric_id).filter((x): x is string => !!x))];
      let map: Record<string, RubricRow> = {};
      if (ids.length) {
        const { data: rubricData, error: rubricError } = await s.from("payroll_rubrics")
          .select("id,code,description,item_type,affects_13th,affects_vacation")
          .eq("organization_id", organizationId).in("id", ids);
        if (rubricError) { setError(rubricError.message); setLoading(false); return; }
        map = Object.fromEntries(((rubricData || []) as RubricRow[]).map(x => [x.id, x]));
      }
      setEvents(rows);
      setRubrics(map);
      setSelectedRubrics(previous => previous.filter(id => ids.includes(id)));
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [organizationId, employeeId, periodStart, periodEnd]);

  const selectedKind = kinds.find(x => x.value === kind)!;
  const candidates = useMemo(() => {
    return Object.values(rubrics).filter(r => r.item_type === "earning" &&
      (selectedKind.incidence === "13th" ? r.affects_13th :
       selectedKind.incidence === "vacation" ? r.affects_vacation : true))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [rubrics, selectedKind]);
  const evidence = useMemo<Evidence[]>(() => months.map(month => {
    const matching = events.filter(e => e.competence_month.slice(0, 7) === month.slice(0, 7)
      && !!e.rubric_id && selectedRubrics.includes(e.rubric_id));
    return { month, amount: matching.reduce((sum, e) => sum + Number(e.event_amount || 0), 0), count: matching.length };
  }), [months, events, selectedRubrics]);
  const total = round2(evidence.reduce((sum, row) => sum + row.amount, 0));
  const occurrenceMonths = evidence.filter(x => x.count > 0).length;
  const divisor = divisorMode === "calendar" ? Number(windowMonths) :
    divisorMode === "occurrence" ? occurrenceMonths : Number(manualDivisor);
  const average = divisor > 0 ? round2(total / divisor) : 0;
  const code = selectedKind.code + "_" + terminationDate.replaceAll("-", "");
  const canSave = selectedRubrics.length > 0 && total > 0 && divisor > 0 && confirmed && ruleReference.trim().length > 0;

  function toggleRubric(id: string) {
    setSelectedRubrics(old => old.includes(id) ? old.filter(x => x !== id) : [...old, id]);
    setConfirmed(false);
  }

  async function save() {
    setError(""); setSuccess("");
    if (!canSave) { setError("Selecione rubricas, informe o fundamento legal/coletivo e confirme o período, divisor e composição da média."); return; }
    if (existingCodes.includes(code)) { setError("Já existe uma média desta natureza e data neste processo. Atualize a memória antes de continuar."); return; }
    setSaving(true);
    const snapshot = {
      engine_version: 1,
      average_kind: kind,
      average_label: selectedKind.label,
      employee_id: employeeId,
      termination_date: terminationDate,
      reference_period_start: periodStart,
      reference_period_end: periodEnd,
      window_months: Number(windowMonths),
      divisor_mode: divisorMode,
      divisor,
      total_variable_amount: total,
      average_amount: average,
      selected_rubrics: candidates.filter(r => selectedRubrics.includes(r.id)).map(r => ({ id: r.id, code: r.code, description: r.description })),
      monthly_evidence: evidence.map(x => ({ competence: x.month, event_count: x.count, amount: round2(x.amount) })),
      source_filter: { event_status: "processed", reconciliation_status: "reconciled", rubric_item_type: "earning" },
      operator_rule_reference: ruleReference.trim(),
      operator_notes: ruleNotes.trim() || null,
      operator_confirmed: true,
      generated_at: new Date().toISOString(),
      warnings: [
        "Resultado é média preliminar e não define automaticamente a remuneração rescisória.",
        "O período, divisor, atualização, habitualidade, DSR e integração dependem da natureza da parcela, legislação vigente e CCT/ACT aplicável.",
        "Eventos pendentes, não processados, rejeitados ou não conciliados foram excluídos.",
        "Para DSR, confirme que o valor não esteja já incorporado à parcela selecionada."
      ]
    };
    const { error: insertError } = await createClient().from("payroll_termination_calculation_items").insert({
      organization_id: organizationId,
      termination_case_id: terminationCaseId,
      item_code: code,
      description: selectedKind.label + " — média preliminar",
      item_type: "information",
      reference_period: periodStart.slice(0, 7) + " a " + periodEnd.slice(0, 7),
      reference_quantity: divisor,
      reference_unit: "meses/divisor",
      calculation_base: total,
      rate: divisor,
      amount: average,
      calculation_method: "formula_pending",
      calculation_status: "pending_review",
      source_parameter_snapshot: { rule_reference: ruleReference.trim(), rule_notes: ruleNotes.trim() || null },
      calculation_snapshot: snapshot,
      legal_basis: ruleReference.trim(),
      review_notes: "Conferir critério legal/coletivo, período, divisor, rubricas selecionadas e eventual DSR antes de utilizar como base de outra verba.",
      sort_order: 70,
      created_by: userId,
      updated_by: userId
    });
    if (insertError) setError(insertError.message);
    else { setSuccess("Média preliminar registrada na memória como informativo, pendente de revisão."); await onSaved(); }
    setSaving(false);
  }

  return <section className="payroll-create">
    <div><div className="form-kicker">MOTOR ASSISTIDO · ETAPA 5</div><h2><Calculator size={18}/> Motor de médias remuneratórias</h2>
      <p>Apura indicadores preliminares por natureza da verba, com seleção explícita de rubricas, janela e divisor. Nenhuma média é tratada como definitiva.</p></div>
    <div className="form-two">
      <label>Natureza da média<select value={kind} onChange={e => { setKind(e.target.value as AverageKind); setSelectedRubrics([]); setConfirmed(false); }}>
        {kinds.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
      </select></label>
      <label>Janela de referência<select value={windowMonths} onChange={e => { setWindowMonths(e.target.value); setConfirmed(false); }}>
        <option value="3">Últimos 3 meses</option><option value="6">Últimos 6 meses</option><option value="12">Últimos 12 meses</option>
      </select></label>
    </div>
    <div className="dependent-privacy"><History size={16}/><span>{selectedKind.description} Período consultado: {monthLabel(periodStart)} a {monthLabel(periodEnd)}. A janela é uma opção de análise, não uma afirmação de que esse seja o período legal aplicável.</span></div>
    <div className="form-two">
      <label>Divisor da média<select value={divisorMode} onChange={e => { setDivisorMode(e.target.value as typeof divisorMode); setConfirmed(false); }}>
        <option value="calendar">Meses-calendário da janela</option><option value="occurrence">Meses com ocorrência</option><option value="manual">Divisor informado pelo DP</option>
      </select></label>
      {divisorMode === "manual" ? <label>Divisor confirmado<input type="number" min="0.01" step="0.01" value={manualDivisor} onChange={e => { setManualDivisor(e.target.value); setConfirmed(false); }}/></label> :
        <label>Divisor calculado<input readOnly value={divisor.toLocaleString("pt-BR") + (divisorMode === "occurrence" ? " mês(es) com ocorrência" : " mês(es)-calendário")}/></label>}
    </div>
    <div className="employee-list-card payroll-list">
      <div className="employee-list-head"><h3>Rubricas conciliadas para seleção</h3><span>{candidates.length} disponível(is)</span></div>
      {loading ? <div className="employee-empty">Consultando eventos processados e conciliados...</div> : error && !candidates.length ? <div className="notice error">{error}</div> :
        !candidates.length ? <div className="employee-empty">Não há rubricas elegíveis com eventos processados e conciliados nesta janela.</div> :
        <div className="form-stack">{candidates.map(r => <label key={r.id} className="dependent-privacy" style={{ alignItems: "center" }}>
          <input type="checkbox" checked={selectedRubrics.includes(r.id)} onChange={() => toggleRubric(r.id)}/>
          <span><b>{r.code}</b> — {r.description}{r.affects_13th ? " · Incide em 13º" : ""}{r.affects_vacation ? " · Incide em férias" : ""}</span>
        </label>)}</div>}
    </div>
    <div className="employee-list-card payroll-list">
      <div className="employee-list-head"><h3>Composição mensal selecionada</h3><span>Total: <b>{money(total)}</b></span></div>
      <div className="table-scroll"><table className="employee-table"><thead><tr><th>Competência</th><th>Ocorrências</th><th>Total conciliado</th></tr></thead><tbody>
        {evidence.map(row => <tr key={row.month}><td>{monthLabel(row.month)}</td><td>{row.count}</td><td>{money(row.amount)}</td></tr>)}
      </tbody></table></div>
      <div className="employee-stats payroll-stats"><div><span>Total selecionado</span><b>{money(total)}</b></div><div><span>Divisor aplicado</span><b>{divisor || "—"}</b></div><div><span>Média preliminar</span><b>{money(average)}</b></div><div><span>Meses com ocorrência</span><b>{occurrenceMonths}</b></div></div>
    </div>
    <label>Fundamento legal ou coletivo validado pelo DP<input value={ruleReference} onChange={e => { setRuleReference(e.target.value); setConfirmed(false); }} placeholder="Ex.: CLT, art. 142, § 3º; CCT/ACT, cláusula e vigência"/></label>
    <label>Observações da regra e conferência<textarea rows={2} value={ruleNotes} onChange={e => { setRuleNotes(e.target.value); setConfirmed(false); }} placeholder="Critério da média, atualização, habitualidade, exclusões, DSR e documentos consultados"/></label>
    <label className="dependent-privacy" style={{ alignItems: "center" }}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/><span>Confirmo que revisei a seleção de rubricas, o período, o divisor e o fundamento legal/coletivo antes de registrar esta média preliminar.</span></label>
    {error && <div className="notice error">{error}</div>}{success && <div className="notice success">{success}</div>}
    <div className="dependent-privacy"><ShieldAlert size={17}/><span>O motor não infere a natureza de comissões, horas extras, adicionais ou DSR pelo texto da rubrica. Para essas categorias, a seleção é manual e exige fundamento específico. O divisor “meses com ocorrência” pode distorcer a média quando a norma determina divisor por meses-calendário ou período integral.</span></div>
    <button className="employee-primary" type="button" disabled={saving || loading || !canSave} onClick={() => void save()}>{saving ? "Registrando..." : "Registrar média preliminar na memória"}</button>
  </section>;
}
