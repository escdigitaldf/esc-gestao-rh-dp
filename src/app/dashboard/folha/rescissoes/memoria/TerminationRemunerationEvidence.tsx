"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarRange, History, ShieldAlert, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Props = { organizationId: string; employeeId: string; terminationDate: string };
type SalaryRow = {
  id: string; salary_amount: number; salary_type: string;
  effective_from: string; effective_to: string | null; change_reason: string | null;
};
type EventRow = {
  variable_event_id: string; competence_month: string; event_date: string | null;
  code: string; description: string; event_amount: number; event_status: string;
  reconciliation_status: string; rubric_id: string | null;
};
type RubricRow = {
  id: string; code: string; description: string; item_type: string;
  affects_13th: boolean; affects_vacation: boolean;
};
type MonthlyTotal = { month: string; amount: number };

const money = (n: number) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateBR = (v: string) => new Date(v + "T12:00:00").toLocaleDateString("pt-BR");
const monthKey = (v: string) => v.slice(0, 7);
const monthLabel = (v: string) => {
  const [year, month] = v.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
};

export default function TerminationRemunerationEvidence({ organizationId, employeeId, terminationDate }: Props) {
  const [salaryRows, setSalaryRows] = useState<SalaryRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [rubrics, setRubrics] = useState<Record<string, RubricRow>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const windowStart = useMemo(() => {
    const d = new Date(terminationDate + "T00:00:00Z");
    d.setUTCMonth(d.getUTCMonth() - 11, 1);
    return d.toISOString().slice(0, 7) + "-01";
  }, [terminationDate]);
  const windowEnd = terminationDate.slice(0, 7) + "-01";
  const windowMonths = useMemo(() => {
    const start = new Date(windowStart + "T00:00:00Z");
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
      return d.toISOString().slice(0, 10);
    });
  }, [windowStart]);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true); setError("");
      const s = createClient();
      const [salary, eventResult] = await Promise.all([
        s.from("employee_salary_history")
          .select("id,salary_amount,salary_type,effective_from,effective_to,change_reason")
          .eq("organization_id", organizationId).eq("employee_id", employeeId)
          .lte("effective_from", terminationDate)
          .or("effective_to.is.null,effective_to.gte." + windowStart)
          .order("effective_from", { ascending: false }),
        s.from("payroll_variable_event_reconciliation")
          .select("variable_event_id,competence_month,event_date,code,description,event_amount,event_status,reconciliation_status,rubric_id")
          .eq("organization_id", organizationId).eq("employee_id", employeeId)
          .eq("event_status", "processed").eq("reconciliation_status", "reconciled")
          .gte("competence_month", windowStart).lte("competence_month", windowEnd)
          .order("competence_month", { ascending: true })
      ]);
      if (!active) return;
      if (salary.error || eventResult.error) {
        setError(salary.error?.message || eventResult.error?.message || "Não foi possível consultar o histórico remuneratório.");
        setLoading(false); return;
      }
      const eventRows = (eventResult.data || []) as EventRow[];
      const rubricIds = [...new Set(eventRows.map(x => x.rubric_id).filter((x): x is string => !!x))];
      let rubricMap: Record<string, RubricRow> = {};
      if (rubricIds.length) {
        const { data, error: rubricError } = await s.from("payroll_rubrics")
          .select("id,code,description,item_type,affects_13th,affects_vacation")
          .eq("organization_id", organizationId).in("id", rubricIds);
        if (rubricError) { setError(rubricError.message); setLoading(false); return; }
        rubricMap = Object.fromEntries(((data || []) as RubricRow[]).map(x => [x.id, x]));
      }
      setSalaryRows((salary.data || []) as SalaryRow[]);
      setEvents(eventRows);
      setRubrics(rubricMap);
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [organizationId, employeeId, terminationDate, windowStart, windowEnd]);

  const eligible = useMemo(() => events.filter(event => {
    const rubric = event.rubric_id ? rubrics[event.rubric_id] : undefined;
    return rubric && rubric.item_type === "earning" && (rubric.affects_13th || rubric.affects_vacation);
  }), [events, rubrics]);

  const groups = useMemo(() => {
    const map = new Map<string, { rubric: RubricRow; total: number; months: Map<string, number>; count: number }>();
    for (const event of eligible) {
      const rubric = rubrics[event.rubric_id as string];
      const key = rubric.id;
      const current = map.get(key) || { rubric, total: 0, months: new Map<string, number>(), count: 0 };
      const amount = Number(event.event_amount || 0);
      const month = monthKey(event.competence_month);
      current.total += amount;
      current.months.set(month, (current.months.get(month) || 0) + amount);
      current.count += 1;
      map.set(key, current);
    }
    return [...map.values()].sort((a, b) => a.rubric.code.localeCompare(b.rubric.code));
  }, [eligible, rubrics]);

  const monthlyTotals = useMemo<MonthlyTotal[]>(() => windowMonths.map(month => ({
    month: monthKey(month),
    amount: eligible.filter(x => monthKey(x.competence_month) === monthKey(month))
      .reduce((sum, x) => sum + Number(x.event_amount || 0), 0)
  })), [windowMonths, eligible]);

  return (
    <section className="payroll-create">
      <div>
        <div className="form-kicker">MOTOR ASSISTIDO · ETAPA 4</div>
        <h2><TrendingUp size={18}/> Histórico e médias remuneratórias</h2>
        <p>Consulta alterações salariais e eventos variáveis efetivamente integrados e conciliados na folha, nos 12 meses de referência até o desligamento.</p>
      </div>
      <div className="dependent-privacy"><CalendarRange size={16}/><span>Janela consultada: {dateBR(windowStart)} a {dateBR(terminationDate)}. Eventos pendentes, aprovados mas não processados, rejeitados ou sem conciliação não entram nesta prévia.</span></div>
      {loading ? <div className="employee-empty">Consultando histórico salarial e eventos conciliados...</div> : <>
        {error && <div className="notice error">{error}</div>}
        <div className="employee-stats payroll-stats">
          <div><span>Alterações salariais encontradas</span><b>{salaryRows.length}</b></div>
          <div><span>Eventos conciliados</span><b>{eligible.length}</b></div>
          <div><span>Rubricas variáveis elegíveis</span><b>{groups.length}</b></div>
          <div><span>Total variável no período</span><b>{money(eligible.reduce((sum, x) => sum + Number(x.event_amount || 0), 0))}</b></div>
        </div>
        <div className="employee-list-card payroll-list">
          <div className="employee-list-head"><h3><History size={16}/> Histórico salarial</h3></div>
          {!salaryRows.length ? <div className="employee-empty">Não há histórico salarial cadastrado para o período. O salário atual do cadastro não será usado como substituto histórico.</div> :
            <div className="table-scroll"><table className="employee-table"><thead><tr><th>Vigência inicial</th><th>Vigência final</th><th>Salário</th><th>Tipo</th><th>Motivo</th></tr></thead><tbody>
              {salaryRows.map(row => <tr key={row.id}><td>{dateBR(row.effective_from)}</td><td>{row.effective_to ? dateBR(row.effective_to) : "Em aberto"}</td><td><b>{money(Number(row.salary_amount))}</b></td><td>{row.salary_type}</td><td>{row.change_reason || "—"}</td></tr>)}
            </tbody></table></div>}
        </div>
        <div className="employee-list-card payroll-list">
          <div className="employee-list-head"><h3>Eventos variáveis por rubrica</h3></div>
          {!groups.length ? <div className="employee-empty">Nenhum evento processado e conciliado com incidência em 13º ou férias foi encontrado no período.</div> :
            <div className="table-scroll"><table className="employee-table"><thead><tr><th>Rubrica</th><th>Incidência</th><th>Ocorrências</th><th>Competências com evento</th><th>Total</th><th>Média em 12 meses*</th></tr></thead><tbody>
              {groups.map(group => <tr key={group.rubric.id}><td><b>{group.rubric.code}</b><br/>{group.rubric.description}</td><td>{[group.rubric.affects_13th && "13º", group.rubric.affects_vacation && "Férias"].filter(Boolean).join(" · ")}</td><td>{group.count}</td><td>{group.months.size}</td><td>{money(group.total)}</td><td><b>{money(group.total / 12)}</b></td></tr>)}
            </tbody></table></div>}
          <p className="dependent-privacy">* Indicador aritmético (total ÷ 12), não valor definitivo de média. A regra de período, divisor, atualização monetária, sazonalidade e tratamento de cada parcela depende da legislação aplicável, instrumento coletivo e natureza da rubrica.</p>
        </div>
        <div className="employee-list-card payroll-list">
          <div className="employee-list-head"><h3>Movimentação mensal conciliada</h3></div>
          <div className="table-scroll"><table className="employee-table"><thead><tr><th>Competência</th><th>Eventos elegíveis</th><th>Total no mês</th></tr></thead><tbody>
            {monthlyTotals.map(row => <tr key={row.month}><td>{monthLabel(row.month)}</td><td>{eligible.filter(x => monthKey(x.competence_month) === row.month).length}</td><td>{money(row.amount)}</td></tr>)}
          </tbody></table></div>
        </div>
        <div className="dependent-privacy"><ShieldAlert size={17}/><span>Esta tela é uma fonte de conferência, não altera a memória rescisória nem grava médias automaticamente. Não substitui a análise de comissões, horas extras, adicionais, DSR, afastamentos, faltas, períodos incompletos, CCT/ACT ou regras específicas. O DP deve validar o divisor e o critério de cada rubrica antes de transportar qualquer valor para o cálculo.</span></div>
      </>}
    </section>
  );
}
