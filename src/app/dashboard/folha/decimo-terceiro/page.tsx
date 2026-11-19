"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, CheckCircle2, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Employee = {
  id: string;
  employee_code: string;
  full_name: string;
  admission_date: string | null;
  termination_date: string | null;
  employment_status: string;
};
type Advance = {
  id: string;
  employee_id: string;
  tax_year: number;
  amount: number;
  payment_date: string;
  status: "planned" | "paid" | "reversed";
  notes: string | null;
};
type Preview = {
  employee: Employee;
  salary: number | null;
  eligibleMonths: number;
  gross: number;
  firstInstallment: number;
  issue: string | null;
};
const brl = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const yearNow = new Date().getFullYear();

export default function ThirteenthPayrollPage() {
  const router = useRouter();
  const [org, setOrg] = useState("");
  const [year, setYear] = useState(yearNow);
  const [paymentDate, setPaymentDate] = useState(`${yearNow}-11-30`);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [reverseReason, setReverseReason] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) { router.replace("/"); return; }
    const { data: membership, error: membershipError } = await supabase
      .from("organization_memberships")
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (membershipError || !membership) {
      setError(membershipError?.message || "Organização ativa não encontrada.");
      setLoading(false);
      return;
    }
    setOrg(membership.organization_id);

    const { data: employees, error: employeeError } = await supabase
      .from("employees")
      .select("id,employee_code,full_name,admission_date,termination_date,employment_status")
      .eq("organization_id", membership.organization_id)
      .eq("employment_status", "active")
      .in("employment_type", ["CLT", "Aprendiz"])
      .order("full_name");
    if (employeeError) {
      setError(employeeError.message);
      setLoading(false);
      return;
    }

    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const employeeIds = (employees || []).map((employee) => employee.id);
    const { data: history, error: historyError } = employeeIds.length
      ? await supabase.from("employee_salary_history")
          .select("employee_id,salary_amount,salary_type,effective_from,effective_to")
          .eq("organization_id", membership.organization_id)
          .in("employee_id", employeeIds)
          .lte("effective_from", yearEnd)
          .or(`effective_to.is.null,effective_to.gte.${yearStart}`)
          .order("effective_from", { ascending: false })
      : { data: [], error: null };
    if (historyError) {
      setError("Não foi possível consultar o histórico salarial: " + historyError.message);
      setLoading(false);
      return;
    }

    const computed = await Promise.all((employees || []).map(async (employee): Promise<Preview> => {
      const salaryAtDate = (date: string) => (history || []).filter((row: any) =>
        row.employee_id === employee.id &&
        row.effective_from <= date &&
        (!row.effective_to || row.effective_to >= date)
      );
      const decemberSalaryRows = salaryAtDate(yearEnd);
      const paymentSalaryRows = salaryAtDate(paymentDate);
      if (!employee.admission_date) {
        return { employee, salary: null, eligibleMonths: 0, gross: 0, firstInstallment: 0, issue: "Data de admissão não cadastrada." };
      }
      if (decemberSalaryRows.length !== 1 || paymentSalaryRows.length !== 1) {
        return { employee, salary: null, eligibleMonths: 0, gross: 0, firstInstallment: 0,
          issue: "Histórico salarial sem cobertura única na data do pagamento ou em 31/12." };
      }
      if (![decemberSalaryRows[0], paymentSalaryRows[0]].every((row: any) => ["monthly", "mensal"].includes(String(row.salary_type || "").toLowerCase()))) {
        return { employee, salary: null, eligibleMonths: 0, gross: 0, firstInstallment: 0, issue: "Remuneração não mensal: cálculo manual necessário." };
      }
      const salary = Number(decemberSalaryRows[0].salary_amount);
      const paymentSalary = Number(paymentSalaryRows[0].salary_amount);
      if (!Number.isFinite(salary) || salary <= 0 || !Number.isFinite(paymentSalary) || paymentSalary <= 0) {
        return { employee, salary: null, eligibleMonths: 0, gross: 0, firstInstallment: 0, issue: "Salário inválido." };
      }
      if (salary !== paymentSalary) {
        return { employee, salary, eligibleMonths: 0, gross: 0, firstInstallment: 0, issue: "Houve alteração salarial entre o pagamento e 31/12; revise manualmente o adiantamento." };
      }
      const { data: calculation, error: calculationError } = await supabase.rpc("calculate_fixed_monthly_thirteenth", {
        p_monthly_salary: salary,
        p_admission_date: employee.admission_date,
        p_termination_date: employee.termination_date,
        p_year: year,
      });
      if (calculationError) {
        return { employee, salary, eligibleMonths: 0, gross: 0, firstInstallment: 0, issue: calculationError.message };
      }
      const result = Array.isArray(calculation) ? calculation[0] : calculation;
      const months = Number(result?.eligible_months || 0);
      const gross = Number(result?.thirteenth_amount || 0);
      return { employee, salary, eligibleMonths: months, gross, firstInstallment: Math.round((salary * months / 12 * 0.5 + Number.EPSILON) * 100) / 100, issue: null };
    }));
    setPreviews(computed);

    const { data: advanceRows, error: advanceError } = await supabase
      .from("payroll_thirteenth_advances")
      .select("id,employee_id,tax_year,amount,payment_date,status,notes")
      .eq("organization_id", membership.organization_id)
      .eq("tax_year", year)
      .order("payment_date");
    if (advanceError) setError("Prévia carregada, mas não foi possível consultar adiantamentos: " + advanceError.message);
    setAdvances((advanceRows || []) as Advance[]);
    setLoading(false);
  }, [router, year, paymentDate]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPaymentDate(`${year}-11-30`); }, [year]);

  const advanceByEmployee = useMemo(() => new Map(advances.map((advance) => [advance.employee_id, advance])), [advances]);
  const totalGross = previews.reduce((sum, row) => sum + row.gross, 0);
  const totalAdvance = previews.reduce((sum, row) => sum + row.firstInstallment, 0);
  const pendingCount = previews.filter((row) => row.issue).length;

  async function registerAdvance(row: Preview) {
    if (!org || row.issue || row.firstInstallment <= 0) return;
    if (!paymentDate || !paymentDate.startsWith(String(year)) || paymentDate > `${year}-11-30`) {
      setError("A data da 1ª parcela deve estar no ano de referência e até 30/11.");
      return;
    }
    setSavingId(row.employee.id);
    setError("");
    setSuccess("");
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("register_payroll_thirteenth_advance", {
      p_organization_id: org,
      p_employee_id: row.employee.id,
      p_tax_year: year,
      p_amount: row.firstInstallment,
      p_payment_date: paymentDate,
      p_payroll_run_id: null,
      p_notes: "Adiantamento de 50% do 13º salário — cálculo de remuneração fixa mensal.",
    });
    if (rpcError) setError(rpcError.message);
    else {
      setSuccess(`Adiantamento planejado para ${row.employee.full_name}. Confirme a baixa somente após o pagamento.`);
      await load();
    }
    setSavingId("");
  }

  async function markPaid(advance: Advance) {
    setSavingId(advance.id);
    setError("");
    const { error: rpcError } = await createClient().rpc("mark_payroll_thirteenth_advance_paid", { p_advance_id: advance.id });
    if (rpcError) setError(rpcError.message);
    else { setSuccess("Adiantamento marcado como pago."); await load(); }
    setSavingId("");
  }

  async function reverseAdvance(advance: Advance) {
    const reason = reverseReason[advance.id] || "";
    if (!reason.trim()) { setError("Informe a justificativa do estorno."); return; }
    setSavingId(advance.id);
    setError("");
    const { error: rpcError } = await createClient().rpc("reverse_payroll_thirteenth_advance", {
      p_advance_id: advance.id, p_reason: reason,
    });
    if (rpcError) setError(rpcError.message);
    else { setSuccess("Adiantamento estornado com justificativa registrada."); await load(); }
    setSavingId("");
  }

  return <main className="module-shell">
    <header className="module-top">
      <a href="/dashboard/folha"><ArrowLeft size={16}/> Folha de pagamento</a>
      <b><span className="brand-mark">ESC</span> Gestão de RH e DP</b>
      <span>13º salário</span>
    </header>
    <section className="module-content payroll-content">
      <div className="module-heading">
        <div><div className="form-kicker">DEPARTAMENTO PESSOAL · 13º SALÁRIO</div>
          <h1>Adiantamento da 1ª parcela</h1>
          <p>Prévia de remuneração fixa, controle individual de adiantamentos e baixa auditável.</p>
        </div>
        <a className="employee-secondary" href="/dashboard/folha"><ArrowLeft size={15}/> Voltar à folha</a>
      </div>

      {error && <div className="notice error">{error}</div>}
      {success && <div className="notice success">{success}</div>}

      <div className="employee-list-card payroll-list">
        <div className="employee-list-head"><h2>Parâmetros da apuração</h2><button className="employee-secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={14}/> Atualizar</button></div>
        <div className="payroll-create">
          <label>Ano de referência<input type="number" min="2000" max="9999" value={year} onChange={(event) => setYear(Number(event.target.value))}/></label>
          <label>Data prevista da 1ª parcela<input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)}/><small>O pagamento regular da primeira parcela deve ocorrer até 30 de novembro.</small></label>
        </div>
      </div>

      <div className="employee-stats payroll-stats">
        <div><span>13º bruto estimado</span><b>{brl(totalGross)}</b></div>
        <div><span>Adiantamento estimado (50%)</span><b>{brl(totalAdvance)}</b></div>
        <div><span>Colaboradores</span><b>{previews.length}</b></div>
        <div><span>Pendências de base</span><b>{pendingCount}</b></div>
      </div>

      <div className="employee-list-card payroll-list">
        <div className="employee-list-head"><h2>Prévia por colaborador</h2><span>{previews.length} vínculo(s)</span></div>
        {loading ? <div className="employee-empty">Carregando prévia do 13º...</div> : !previews.length ?
          <div className="employee-empty"><Wallet size={24}/><b>Nenhum colaborador CLT/Aprendiz ativo encontrado.</b></div> :
          <div className="table-scroll"><table className="employee-table">
            <thead><tr><th>Matrícula</th><th>Colaborador</th><th>Salário em 31/12</th><th>Avos</th><th>13º bruto</th><th>1ª parcela (50%)</th><th>Adiantamento</th><th>Ação</th></tr></thead>
            <tbody>{previews.map((row) => {
              const advance = advanceByEmployee.get(row.employee.id);
              return <tr key={row.employee.id}>
                <td>{row.employee.employee_code}</td><td><b>{row.employee.full_name}</b>{row.issue && <small className="field-error">{row.issue}</small>}</td>
                <td>{row.salary === null ? "—" : brl(row.salary)}</td><td>{row.eligibleMonths}/12</td><td>{brl(row.gross)}</td><td>{brl(row.firstInstallment)}</td>
                <td>{advance ? <span className={advance.status === "paid" ? "dependent-active" : "dependent-inactive"}>{advance.status === "paid" ? "Pago" : advance.status === "reversed" ? "Estornado" : "Planejado"} · {brl(advance.amount)}</span> : "Não registrado"}</td>
                <td>{advance ? <div className="table-actions">
                  {advance.status === "planned" && <button className="employee-secondary" disabled={savingId === advance.id} onClick={() => void markPaid(advance)}><CheckCircle2 size={14}/> Baixar pagamento</button>}
                  {advance.status !== "reversed" && <><input aria-label="Motivo do estorno" placeholder="Motivo do estorno" value={reverseReason[advance.id] || ""} onChange={(event) => setReverseReason((old) => ({...old,[advance.id]:event.target.value}))}/><button className="employee-secondary" disabled={savingId === advance.id} onClick={() => void reverseAdvance(advance)}>Estornar</button></>}
                </div> : <button className="employee-primary" disabled={!!row.issue || row.firstInstallment <= 0 || savingId === row.employee.id} onClick={() => void registerAdvance(row)}>{savingId === row.employee.id ? "Registrando..." : "Registrar 1ª parcela"}</button>}</td>
              </tr>;
            })}</tbody>
          </table></div>}
        <div className="dependent-privacy"><ShieldCheck size={15}/> O registro inicial fica como planejado. Use “Baixar pagamento” somente após confirmar que o valor foi efetivamente pago. Estornos exigem justificativa e não apagam o histórico.</div>
      </div>
      <div className="dependent-privacy"><CalendarDays size={15}/> Escopo desta tela: remuneração fixa mensal e vínculos CLT/Aprendiz ativos. Médias variáveis, afastamentos especiais, remuneração não mensal, rescisões e cálculo da 2ª parcela ainda não estão habilitados. Não use esta prévia como folha definitiva.</div>
    </section>
  </main>;
}
