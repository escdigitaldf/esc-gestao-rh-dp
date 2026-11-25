"use client";

import { useMemo, useState } from "react";
import { Calculator, ShieldAlert, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  organizationId: string;
  terminationCaseId: string;
  userId: string;
  reason: string;
  existingCodes: string[];
  onSaved: () => Promise<void> | void;
};

const brl = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export default function TerminationPreliminaryCalculator({
  organizationId, terminationCaseId, userId, reason, existingCodes, onSaved
}: Props) {
  const [salaryBase, setSalaryBase] = useState("");
  const [salaryDays, setSalaryDays] = useState("");
  const [salaryDivisor, setSalaryDivisor] = useState("30");
  const [vacationBase, setVacationBase] = useState("");
  const [vacationAvos, setVacationAvos] = useState("");
  const [salaryConfirmed, setSalaryConfirmed] = useState(false);
  const [vacationConfirmed, setVacationConfirmed] = useState(false);
  const [vacationEligible, setVacationEligible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const salary = Number(salaryBase);
  const days = Number(salaryDays);
  const divisor = Number(salaryDivisor);
  const vacBase = Number(vacationBase);
  const avos = Number(vacationAvos);

  const salaryValid = salaryBase !== "" && Number.isFinite(salary) && salary > 0
    && salaryDays !== "" && Number.isInteger(days) && days >= 1 && days <= 30
    && Number.isFinite(divisor) && divisor > 0 && salaryConfirmed;
  const vacationValid = vacationBase !== "" && Number.isFinite(vacBase) && vacBase > 0
    && vacationAvos !== "" && Number.isInteger(avos) && avos >= 1 && avos <= 11
    && vacationConfirmed && vacationEligible && reason !== "employer_with_cause";

  const salaryAmount = useMemo(
    () => salaryValid ? round2((salary / divisor) * days) : null,
    [salaryValid, salary, divisor, days]
  );
  const vacationAmount = useMemo(
    () => vacationValid ? round2((vacBase * avos) / 12) : null,
    [vacationValid, vacBase, avos]
  );
  const vacationThird = vacationAmount === null ? null : round2(vacationAmount / 3);

  async function savePreliminaryItems() {
    setError("");
    setSuccess("");
    const rows: Record<string, unknown>[] = [];

    if (salaryValid && salaryAmount !== null) {
      if (existingCodes.includes("SALDO_SALARIO")) {
        setError("Já existe um item SALDO_SALARIO neste processo. Revise o item existente antes de gerar outro.");
        return;
      }
      rows.push({
        organization_id: organizationId,
        termination_case_id: terminationCaseId,
        item_code: "SALDO_SALARIO",
        description: "Saldo de salário — pré-cálculo assistido",
        item_type: "earning",
        reference_period: "Mês do desligamento",
        reference_quantity: days,
        reference_unit: "dias",
        calculation_base: salary,
        rate: 1 / divisor,
        amount: salaryAmount,
        calculation_method: "formula_pending",
        calculation_status: "pending_review",
        source_parameter_snapshot: { source: "user_confirmed_inputs", legal_reference: "CLT, art. 64 — validar enquadramento e divisor aplicável" },
        calculation_snapshot: {
          formula: "remuneracao_mensal_confirmada / divisor_informado * dias_devidos_informados",
          inputs: { remuneration_base: salary, divisor, payable_days: days },
          result: salaryAmount,
          warnings: ["Base e dias informados pelo operador; não houve integração automática de faltas, afastamentos, férias ou médias."],
          generated_at: new Date().toISOString()
        },
        legal_basis: "CLT, art. 64 (validar aplicabilidade ao tipo salarial e jornada)",
        review_notes: "Pré-cálculo assistido. Conferir remuneração histórica, médias, dias efetivamente devidos, faltas, afastamentos e adiantamentos.",
        sort_order: 10,
        created_by: userId,
        updated_by: userId
      });
    }

    if (vacationValid && vacationAmount !== null && vacationThird !== null) {
      const duplicates = ["FERIAS_PROP", "TERCO_FERIAS_PROP"].filter(code => existingCodes.includes(code));
      if (duplicates.length) {
        setError(`Já existe(m) item(ns) ${duplicates.join(", ")} neste processo. Revise antes de gerar novamente.`);
        return;
      }
      const common = {
        organization_id: organizationId,
        termination_case_id: terminationCaseId,
        item_type: "earning",
        reference_period: "Período aquisitivo proporcional — avos confirmados pelo operador",
        reference_quantity: avos,
        reference_unit: "avos",
        calculation_base: vacBase,
        calculation_method: "formula_pending",
        calculation_status: "pending_review",
        source_parameter_snapshot: { source: "user_confirmed_inputs", legal_reference: "CLT, arts. 146 e 147; CF, art. 7º, XVII; eSocial, tabela de rubricas" },
        sort_order: 20,
        created_by: userId,
        updated_by: userId
      };
      rows.push({
        ...common,
        item_code: "FERIAS_PROP",
        description: "Férias proporcionais — pré-cálculo assistido",
        rate: avos / 12,
        amount: vacationAmount,
        calculation_snapshot: {
          formula: "remuneracao_base_confirmada * avos_confirmados / 12",
          inputs: { remuneration_base: vacBase, avos },
          result: vacationAmount,
          warnings: ["Avos e base informados pelo operador; o sistema não apurou período aquisitivo, faltas, afastamentos, projeção de aviso ou norma coletiva."],
          generated_at: new Date().toISOString()
        },
        legal_basis: "CLT, arts. 146 e 147; validar modalidade e hipóteses de exclusão",
        review_notes: "Conferir período aquisitivo, avos, remuneração na rescisão, projeção do aviso, faltas/afastamentos e modalidade contratual."
      });
      rows.push({
        ...common,
        item_code: "TERCO_FERIAS_PROP",
        description: "Terço constitucional sobre férias proporcionais",
        rate: 1 / 3,
        amount: vacationThird,
        calculation_snapshot: {
          formula: "valor_das_ferias_proporcionais / 3",
          inputs: { proportional_vacation_amount: vacationAmount },
          result: vacationThird,
          warnings: ["Parcela derivada do pré-cálculo de férias proporcionais; revisar conjuntamente com a verba principal."],
          generated_at: new Date().toISOString()
        },
        legal_basis: "Constituição Federal, art. 7º, XVII",
        review_notes: "Conferir a verba principal e o cabimento do adicional constitucional."
      });
    }

    if (!rows.length) {
      setError("Preencha e confirme pelo menos um bloco de cálculo. Dados incompletos ou não confirmados permanecem bloqueados.");
      return;
    }

    setSaving(true);
    const { error: insertError } = await createClient()
      .from("payroll_termination_calculation_items")
      .insert(rows);
    if (insertError) {
      setError(insertError.message);
    } else {
      setSuccess(`${rows.length} item(ns) preliminar(es) registrado(s), todos pendentes de revisão.`);
      await onSaved();
    }
    setSaving(false);
  }

  return (
    <section className="payroll-create">
      <div>
        <div className="form-kicker">MOTOR ASSISTIDO · ETAPA 1</div>
        <h2><Calculator size={18}/> Pré-cálculo de saldo de salário e férias</h2>
        <p>O sistema aplica somente as operações aritméticas sobre bases e quantidades confirmadas pelo operador. Não apura automaticamente direitos, períodos, médias ou incidências.</p>
      </div>
      <div className="dependent-privacy"><ShieldAlert size={17}/><span>Não utilize o salário atual do cadastro como base sem confirmar a faixa salarial vigente na data da rescisão. A base deve considerar parcelas salariais e médias cabíveis, conforme o caso.</span></div>
      <div className="form-two">
        <div>
          <h3>Saldo de salário</h3>
          <label>Remuneração mensal considerada (R$)<input type="number" min="0" step="0.01" value={salaryBase} onChange={e=>setSalaryBase(e.target.value)} placeholder="Valor histórico confirmado"/></label>
          <div className="form-two">
            <label>Dias devidos no mês<input type="number" min="1" max="30" step="1" value={salaryDays} onChange={e=>setSalaryDays(e.target.value)} placeholder="1 a 30"/></label>
            <label>Divisor<input type="number" min="1" step="0.01" value={salaryDivisor} onChange={e=>setSalaryDivisor(e.target.value)}/></label>
          </div>
          <label className="dependent-privacy"><input type="checkbox" checked={salaryConfirmed} onChange={e=>setSalaryConfirmed(e.target.checked)}/> Confirmo que remuneração, divisor e dias devidos foram conferidos em documentos e regras aplicáveis.</label>
          <p><b>Resultado preliminar:</b> {salaryAmount===null?"Bloqueado até completar e confirmar os dados":brl(salaryAmount)}</p>
        </div>
        <div>
          <h3>Férias proporcionais + 1/3</h3>
          {reason === "employer_with_cause" ? (
            <div className="dependent-privacy"><ShieldAlert size={17}/><span>Pré-cálculo bloqueado para justa causa. Exige enquadramento jurídico específico antes de qualquer lançamento automático.</span></div>
          ) : <>
            <label>Remuneração-base das férias (R$)<input type="number" min="0" step="0.01" value={vacationBase} onChange={e=>setVacationBase(e.target.value)} placeholder="Base histórica confirmada"/></label>
            <label>Avos proporcionais confirmados (1 a 11)<input type="number" min="1" max="11" step="1" value={vacationAvos} onChange={e=>setVacationAvos(e.target.value)} placeholder="Informar após conferência"/></label>
            <label className="dependent-privacy"><input type="checkbox" checked={vacationEligible} onChange={e=>setVacationEligible(e.target.checked)}/> Confirmo que a modalidade e a situação jurídica admitem férias proporcionais neste processo.</label>
            <label className="dependent-privacy"><input type="checkbox" checked={vacationConfirmed} onChange={e=>setVacationConfirmed(e.target.checked)}/> Confirmo que remuneração-base e avos foram apurados e conferidos.</label>
            <p><b>Férias:</b> {vacationAmount===null?"Bloqueado até completar e confirmar os dados":brl(vacationAmount)}</p>
            <p><b>Terço constitucional:</b> {vacationThird===null?"—":brl(vacationThird)}</p>
          </>}
        </div>
      </div>
      <div className="dependent-privacy"><ShieldCheck size={17}/><span>Os itens gerados recebem método “fórmula pendente”, status “pendente de revisão”, fórmula, entradas, resultado e alertas no snapshot de auditoria. A geração não valida o processo nem substitui a conferência do DP.</span></div>
      {error&&<div className="notice error">{error}</div>}
      {success&&<div className="notice success">{success}</div>}
      <button className="employee-primary" onClick={()=>void savePreliminaryItems()} disabled={saving || (!salaryValid && !vacationValid)}>
        {saving?"Registrando...":"Gerar itens preliminares selecionados"}
      </button>
    </section>
  );
}
