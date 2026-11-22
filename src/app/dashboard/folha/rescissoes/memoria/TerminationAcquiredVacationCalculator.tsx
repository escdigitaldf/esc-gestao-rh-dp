"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, ShieldAlert, ShieldCheck } from "lucide-react";
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
type VacationPeriod = {
  id: string;
  acquisition_start: string;
  acquisition_end: string;
  concession_start: string;
  concession_end: string;
  entitled_days: number;
  status: string;
  notes: string | null;
};
type VacationSchedule = {
  vacation_period_id: string;
  start_date: string;
  end_date: string;
  days: number;
  sold_days: number;
  status: string;
};
type Absence = {
  absence_type: string;
  start_date: string;
  end_date: string | null;
  status: string;
};

const money = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateBR = (v: string) => new Date(v + "T12:00:00").toLocaleDateString("pt-BR");
const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export default function TerminationAcquiredVacationCalculator({
  organizationId, terminationCaseId, employeeId, terminationDate, userId, existingCodes, onSaved
}: Props) {
  const [periods, setPeriods] = useState<VacationPeriod[]>([]);
  const [schedules, setSchedules] = useState<VacationSchedule[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [base, setBase] = useState("");
  const [baseConfirmed, setBaseConfirmed] = useState(false);
  const [balanceConfirmed, setBalanceConfirmed] = useState(false);
  const [doubleConfirmed, setDoubleConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      const s = createClient();
      const [p, v, a] = await Promise.all([
        s.from("employee_vacation_periods")
          .select("id,acquisition_start,acquisition_end,concession_start,concession_end,entitled_days,status,notes")
          .eq("organization_id", organizationId).eq("employee_id", employeeId)
          .lte("acquisition_end", terminationDate).order("acquisition_start", { ascending: true }),
        s.from("employee_vacation_schedules")
          .select("vacation_period_id,start_date,end_date,days,sold_days,status")
          .eq("organization_id", organizationId).eq("employee_id", employeeId)
          .eq("status", "completed").lte("end_date", terminationDate),
        s.from("employee_absences")
          .select("absence_type,start_date,end_date,status")
          .eq("organization_id", organizationId).eq("employee_id", employeeId)
          .neq("status", "cancelled").lte("start_date", terminationDate)
      ]);
      if (!active) return;
      if (p.error || v.error || a.error) {
        setError(p.error?.message || v.error?.message || a.error?.message || "Não foi possível consultar o histórico de férias.");
      } else {
        const periodRows = (p.data || []) as VacationPeriod[];
        setPeriods(periodRows);
        setSchedules((v.data || []) as VacationSchedule[]);
        setAbsences((a.data || []) as Absence[]);
        setSelectedId(current => current && periodRows.some(x => x.id === current) ? current : periodRows.find(x => x.entitled_days > 0)?.id || "");
      }
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [organizationId, employeeId, terminationDate]);

  const selected = periods.find(x => x.id === selectedId);
  const completedDays = useMemo(() => selected ? schedules
    .filter(x => x.vacation_period_id === selected.id)
    .reduce((sum, x) => sum + Number(x.days || 0) + Number(x.sold_days || 0), 0) : 0, [selected, schedules]);
  const balanceDays = selected ? Math.max(0, Number(selected.entitled_days) - completedDays) : 0;
  const concessionExpired = !!selected && selected.concession_end < terminationDate;
  const hasAbsenceOverlap = !!selected && absences.some(a =>
    a.start_date <= selected.acquisition_end && (!a.end_date || a.end_date >= selected.acquisition_start)
  );
  const baseValue = Number(base);
  const valid = !!selected && balanceDays > 0 && base !== "" && Number.isFinite(baseValue) && baseValue > 0
    && baseConfirmed && balanceConfirmed && (!concessionExpired || doubleConfirmed);
  const multiplier = concessionExpired && doubleConfirmed ? 2 : 1;
  const principal = valid ? round2((baseValue / 30) * balanceDays * multiplier) : null;
  const third = principal === null ? null : round2(principal / 3);

  async function save() {
    setError("");
    setSuccess("");
    if (!selected || principal === null || third === null) {
      setError("Cálculo bloqueado: confirme a remuneração, o saldo de dias e, quando aplicável, a dobra.");
      return;
    }
    const suffix = selected.acquisition_start.replaceAll("-", "");
    const codes = ["FERIAS_ADQUIRIDAS_" + suffix, "TERCO_FERIAS_ADQUIRIDAS_" + suffix];
    const duplicates = codes.filter(x => existingCodes.includes(x));
    if (duplicates.length) {
      setError("Já existem itens para este período (" + duplicates.join(", ") + "). Atualize a memória antes de tentar novamente.");
      return;
    }
    const periodLabel = dateBR(selected.acquisition_start) + " a " + dateBR(selected.acquisition_end);
    const warnings = [
      "Saldo calculado a partir dos períodos cadastrados e programações com status concluído; confirme recibos e pagamentos efetivos.",
      "O sistema não recalcula o direito de dias a partir das faltas do art. 130 da CLT.",
      "A remuneração-base foi informada pelo operador; médias, adicionais e parcelas variáveis não foram apurados automaticamente.",
      "A dobra foi tratada conforme confirmação expressa do operador, não como conclusão jurídica automática."
    ];
    if (hasAbsenceOverlap) warnings.push("Há afastamento registrado que coincide com o período aquisitivo; verificar os efeitos legais e documentos antes da validação.");
    const snapshot = {
      source: "employee_vacation_periods_and_completed_schedules",
      vacation_period_id: selected.id,
      acquisition_start: selected.acquisition_start,
      acquisition_end: selected.acquisition_end,
      concession_start: selected.concession_start,
      concession_end: selected.concession_end,
      termination_date: terminationDate,
      entitled_days: Number(selected.entitled_days),
      completed_vacation_and_sold_days: completedDays,
      remaining_days_confirmed: balanceDays,
      concession_deadline_expired: concessionExpired,
      double_pay_confirmed_by_operator: concessionExpired && doubleConfirmed,
      multiplier,
      remuneration_base_confirmed: baseValue,
      absence_overlap_detected: hasAbsenceOverlap,
      warnings,
      generated_at: new Date().toISOString()
    };
    const common = {
      organization_id: organizationId,
      termination_case_id: terminationCaseId,
      item_type: "earning",
      reference_period: "Aquisitivo " + periodLabel + " · concessivo até " + dateBR(selected.concession_end),
      reference_quantity: balanceDays,
      reference_unit: "dias",
      calculation_base: baseValue,
      calculation_method: "formula_pending",
      calculation_status: "pending_review",
      source_parameter_snapshot: { source: "CLT", articles: ["134", "137", "142", "146"], reference: "https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452compilado.htm" },
      sort_order: 30,
      created_by: userId,
      updated_by: userId
    };
    const rows = [
      {
        ...common,
        item_code: codes[0],
        description: "Férias adquiridas não usufruídas — " + periodLabel,
        rate: multiplier / 30,
        amount: principal,
        calculation_snapshot: { ...snapshot, formula: "remuneracao_base / 30 * dias_residuais * multiplicador", result: principal },
        legal_basis: "CLT, arts. 134, 137, 142 e 146",
        review_notes: "Conferir recibos, gozo efetivo, saldo do período, remuneração e eventual dobra. Atraso no pagamento de férias já gozadas exige análise separada do art. 145 e da jurisprudência."
      },
      {
        ...common,
        item_code: codes[1],
        description: "Terço constitucional sobre férias adquiridas — " + periodLabel,
        rate: 1 / 3,
        amount: third,
        calculation_snapshot: { ...snapshot, formula: "valor_das_ferias_adquiridas / 3", result: third },
        legal_basis: "Constituição Federal, art. 7º, XVII",
        review_notes: "Parcela derivada da verba principal; conferir base, dias, dobra e cabimento."
      }
    ];
    setSaving(true);
    const { error: insertError } = await createClient().from("payroll_termination_calculation_items").insert(rows);
    if (insertError) setError(insertError.message);
    else {
      setSuccess("Férias adquiridas registradas como dois itens preliminares, pendentes de revisão.");
      setBase("");
      setBaseConfirmed(false);
      setBalanceConfirmed(false);
      setDoubleConfirmed(false);
      await onSaved();
    }
    setSaving(false);
  }

  return (
    <section className="payroll-create">
      <div>
        <div className="form-kicker">MOTOR ASSISTIDO · ETAPA 2</div>
        <h2><CalendarClock size={18}/> Férias adquiridas e não usufruídas</h2>
        <p>Consulta períodos aquisitivos, prazo concessivo e programações concluídas até a data do desligamento.</p>
      </div>
      {loading ? <p>Consultando períodos e afastamentos...</p> : error && !periods.length ? <div className="notice error">{error}</div> : <>
        {!periods.length ? <div className="employee-empty">Não há períodos aquisitivos completos cadastrados até a data do desligamento. Confira a admissão e o histórico de férias.</div> : <>
          <label>Período aquisitivo
            <select value={selectedId} onChange={e=>{setSelectedId(e.target.value);setBaseConfirmed(false);setBalanceConfirmed(false);setDoubleConfirmed(false);}}>
              {periods.map(p=><option key={p.id} value={p.id}>{dateBR(p.acquisition_start)} a {dateBR(p.acquisition_end)} · direito cadastrado: {p.entitled_days} dias</option>)}
            </select>
          </label>
          {selected && <div className="employee-stats payroll-stats">
            <div><span>Direito cadastrado</span><b>{selected.entitled_days} dias</b></div>
            <div><span>Férias concluídas/abono</span><b>{completedDays} dias</b></div>
            <div><span>Saldo estimado</span><b>{balanceDays} dias</b></div>
            <div><span>Prazo concessivo</span><b>{concessionExpired?"Encerrado":"Dentro do prazo"}</b></div>
          </div>}
          {selected && <div className="dependent-privacy"><ShieldAlert size={17}/><span>Período concessivo: {dateBR(selected.concession_start)} a {dateBR(selected.concession_end)}. {concessionExpired ? "O prazo terminou antes do desligamento; a dobra foi habilitada apenas para confirmação expressa do DP." : "O prazo não terminou antes do desligamento; a verba é apresentada em valor simples, sujeita à revisão."}</span></div>}
          {selected && hasAbsenceOverlap && <div className="dependent-privacy"><ShieldAlert size={17}/><span>Há afastamento cadastrado que coincide com o período aquisitivo. O sistema não altera automaticamente os dias de direito; verifique o art. 133 da CLT, a natureza/duração do afastamento e os documentos.</span></div>}
          <label>Remuneração-base para férias (R$)
            <input type="number" min="0" step="0.01" value={base} onChange={e=>setBase(e.target.value)} placeholder="Base vigente na rescisão, com médias conferidas"/>
          </label>
          <label className="dependent-privacy"><input type="checkbox" checked={balanceConfirmed} onChange={e=>setBalanceConfirmed(e.target.checked)}/> Confirmo que o saldo de dias foi conferido com recibos, avisos e histórico de gozo/abono.</label>
          <label className="dependent-privacy"><input type="checkbox" checked={baseConfirmed} onChange={e=>setBaseConfirmed(e.target.checked)}/> Confirmo que a remuneração-base considera salário devido na rescisão, adicionais e médias cabíveis.</label>
          {concessionExpired && <label className="dependent-privacy"><input type="checkbox" checked={doubleConfirmed} onChange={e=>setDoubleConfirmed(e.target.checked)}/> Após análise documental/jurídica, confirmo que a remuneração residual deste período deve ser tratada em dobro, conforme art. 137 da CLT.</label>}
          <div className="vacation-estimate">
            <div><span>Férias adquiridas {multiplier===2?"(dobra confirmada)":"(valor simples)"}</span><b>{principal===null?"Bloqueado":money(principal)}</b></div>
            <div><span>Terço constitucional</span><b>{third===null?"—":money(third)}</b></div>
            <small>Estimativa sobre o saldo de dias. Não inclui descontos, médias não informadas, incidências de folha ou ajustes coletivos.</small>
          </div>
          <div className="dependent-privacy"><ShieldCheck size={17}/><span>Faltas e afastamentos não são interpretados automaticamente. O cálculo só é gravado após confirmação do saldo, da remuneração e, quando aplicável, da dobra. Todos os itens permanecem pendentes de revisão.</span></div>
          <button className="employee-primary" onClick={()=>void save()} disabled={saving||!valid}>{saving?"Registrando...":"Gerar férias adquiridas deste período"}</button>
        </>}
      </>}
    </section>
  );
}
