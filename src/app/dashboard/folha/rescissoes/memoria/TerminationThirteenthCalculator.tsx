"use client";

import { useMemo, useState } from "react";
import { Calculator, ShieldAlert, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  organizationId: string;
  terminationCaseId: string;
  employeeId: string;
  admissionDate: string | null;
  terminationDate: string;
  projectedNoticeEndDate: string | null;
  reason: string;
  noticeType: string;
  userId: string;
  existingCodes: string[];
  onSaved: () => Promise<void> | void;
};

const money = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const isoDate = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
const dateBR = (value: string) => new Date(value + "T12:00:00").toLocaleDateString("pt-BR");

function countThirteenthAvos(admission: string | null, cutoff: string): { avos: number; months: Array<{ month: number; days: number; included: boolean }> } {
  const end = new Date(cutoff + "T00:00:00Z");
  const year = end.getUTCFullYear();
  const start = admission && admission > isoDate(year, 0, 1) ? admission : isoDate(year, 0, 1);
  const months = Array.from({ length: 12 }, (_, index) => {
    const monthStart = isoDate(year, index, 1);
    const nextMonth = index === 11 ? isoDate(year + 1, 0, 1) : isoDate(year, index + 1, 1);
    const monthEnd = isoDate(year, index + 1, 0);
    const segmentStart = start > monthStart ? start : monthStart;
    const segmentEnd = cutoff < monthEnd ? cutoff : monthEnd;
    const days = segmentEnd < segmentStart ? 0 :
      Math.floor((new Date(segmentEnd + "T00:00:00Z").getTime() - new Date(segmentStart + "T00:00:00Z").getTime()) / 86400000) + 1;
    return { month: index + 1, days, included: days >= 15 };
  });
  return { avos: months.filter(x => x.included).length, months };
}

export default function TerminationThirteenthCalculator({
  organizationId, terminationCaseId, employeeId, admissionDate, terminationDate,
  projectedNoticeEndDate, reason, noticeType, userId, existingCodes, onSaved
}: Props) {
  const [fixedBase, setFixedBase] = useState("");
  const [variableAverage, setVariableAverage] = useState("0");
  const [baseConfirmed, setBaseConfirmed] = useState(false);
  const [projectionConfirmed, setProjectionConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const base = Number(fixedBase) + Number(variableAverage || 0);
  const termination = useMemo(() => countThirteenthAvos(admissionDate, terminationDate), [admissionDate, terminationDate]);
  const projectionEligible = reason === "employer_without_cause" && noticeType === "indemnified"
    && !!projectedNoticeEndDate && projectedNoticeEndDate > terminationDate;
  const projected = useMemo(
    () => projectedNoticeEndDate && projectedNoticeEndDate > terminationDate
      ? countThirteenthAvos(admissionDate, projectedNoticeEndDate)
      : null,
    [admissionDate, projectedNoticeEndDate, terminationDate]
  );
  const projectedAvos = projectionEligible && projectionConfirmed && projected
    ? Math.max(0, projected.avos - termination.avos) : 0;
  const validBase = fixedBase !== "" && Number.isFinite(Number(fixedBase)) && Number(fixedBase) > 0
    && variableAverage !== "" && Number.isFinite(Number(variableAverage)) && Number(variableAverage) >= 0
    && base > 0 && baseConfirmed;
  const proportionalAmount = validBase && reason !== "employer_with_cause" && termination.avos > 0
    ? round2(base * termination.avos / 12) : null;
  const projectedAmount = validBase && projectedAvos > 0 ? round2(base * projectedAvos / 12) : null;
  const blockedByCause = reason === "employer_with_cause";
  const duplicateCodes = [
    ...(termination.avos > 0 ? ["DECIMO_TERCEIRO_PROPORCIONAL"] : []),
    ...(projectedAvos > 0 ? ["DECIMO_TERCEIRO_AVISO_INDENIZADO"] : [])
  ].filter(code => existingCodes.includes(code));

  async function save() {
    setError("");
    setSuccess("");
    if (blockedByCause) {
      setError("O 13º proporcional está bloqueado para dispensa por justa causa. Qualquer situação excepcional exige análise jurídica específica.");
      return;
    }
    if (!validBase || (projectionEligible && projectedAvos > 0 && !projectionConfirmed)) {
      setError("Confirme a remuneração-base e, quando aplicável, a projeção do aviso-prévio.");
      return;
    }
    if (duplicateCodes.length) {
      setError("Já existe(m) rubrica(s) " + duplicateCodes.join(", ") + " neste processo. Atualize a memória e revise os itens existentes.");
      return;
    }
    const year = new Date(terminationDate + "T00:00:00Z").getUTCFullYear();
    const monthDetails = termination.months.map(x => ({
      month: x.month, calendar_days_counted: x.days, included_as_avo: x.included
    }));
    const common = {
      organization_id: organizationId,
      termination_case_id: terminationCaseId,
      item_type: "earning",
      reference_period: "Ano-calendário " + year,
      reference_unit: "avos",
      calculation_base: base,
      calculation_method: "formula_pending",
      calculation_status: "pending_review",
      source_parameter_snapshot: {
        legal_references: [
          "Lei 4.090/1962, art. 1º, §§ 1º e 2º, e art. 3º",
          "Decreto 57.155/1965",
          "CLT, art. 487, § 1º, quando houver projeção legal do aviso"
        ],
        official_references: [
          "https://www.planalto.gov.br/ccivil_03/leis/l4090.htm",
          "https://www.planalto.gov.br/ccivil_03/decreto/1950-1969/d57155.htm",
          "https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452compilado.htm"
        ],
        eSocial_rubric_reference: "6002 / 6001"
      },
      sort_order: 40,
      created_by: userId,
      updated_by: userId
    };
    const warnings = [
      "Remuneração fixa e média variável foram informadas e confirmadas pelo operador; o sistema não apura automaticamente comissões, horas extras, adicionais ou histórico salarial.",
      "Conferir afastamentos, faltas que afetem o avo, adiantamentos de 13º, pagamentos anteriores e regras coletivas antes da validação.",
      "O cálculo é preliminar, não calcula descontos previdenciários/tributários e não gera evento S-2299."
    ];
    const rows: Record<string, unknown>[] = [];
    if (termination.avos > 0) {
      const amount = proportionalAmount as number;
      rows.push({
        ...common,
        item_code: "DECIMO_TERCEIRO_PROPORCIONAL",
        description: "13º salário proporcional na rescisão",
        reference_quantity: termination.avos,
        rate: termination.avos / 12,
        amount,
        calculation_snapshot: {
          component: "13th_salary_proportional_until_termination",
          admission_date: admissionDate,
          termination_date: terminationDate,
          calculation_cutoff: terminationDate,
          year,
          monthly_avo_rule: "15 dias ou mais no mês-calendário",
          month_details: monthDetails,
          avos: termination.avos,
          fixed_remuneration_confirmed: Number(fixedBase),
          variable_average_confirmed: Number(variableAverage || 0),
          remuneration_base: base,
          formula: "remuneracao_base * avos / 12",
          result: amount,
          warnings,
          generated_at: new Date().toISOString()
        },
        legal_basis: "Lei 4.090/1962, art. 1º, §§ 1º e 2º, e art. 3º; Decreto 57.155/1965",
        review_notes: "Conferir remuneração devida na rescisão, médias variáveis, afastamentos, adiantamentos e avos mês a mês."
      });
    }
    if (projectedAmount !== null && projected) {
      const amount = projectedAmount;
      rows.push({
        ...common,
        item_code: "DECIMO_TERCEIRO_AVISO_INDENIZADO",
        description: "13º salário incidente sobre aviso-prévio indenizado",
        reference_quantity: projectedAvos,
        rate: projectedAvos / 12,
        amount,
        calculation_snapshot: {
          component: "13th_salary_on_indemnified_notice",
          admission_date: admissionDate,
          termination_date: terminationDate,
          projected_notice_end_date: projectedNoticeEndDate,
          year,
          monthly_avo_rule: "15 dias ou mais no mês-calendário",
          termination_date_avos: termination.avos,
          projected_end_avos: projected.avos,
          additional_avos: projectedAvos,
          projected_month_details: projected.months.map(x => ({
            month: x.month, calendar_days_counted: x.days, included_as_avo: x.included
          })),
          fixed_remuneration_confirmed: Number(fixedBase),
          variable_average_confirmed: Number(variableAverage || 0),
          remuneration_base: base,
          formula: "remuneracao_base * avos_adicionais_da_projecao / 12",
          result: amount,
          warnings: [
            "Projeção considerada somente para dispensa sem justa causa com aviso indenizado e confirmação expressa do DP.",
            ...warnings
          ],
          generated_at: new Date().toISOString()
        },
        legal_basis: "CLT, art. 487, § 1º; Lei 4.090/1962; eSocial, rubrica 6001",
        review_notes: "Conferir dias de aviso, data projetada, tempo de serviço, norma coletiva e separação da rubrica de 13º proporcional."
      });
    }
    if (!rows.length) {
      setError("Não há avos de 13º a registrar para o período informado. Confira admissão, desligamento e ano-calendário.");
      return;
    }
    setSaving(true);
    const { error: insertError } = await createClient()
      .from("payroll_termination_calculation_items")
      .insert(rows);
    if (insertError) setError(insertError.message);
    else {
      setSuccess("13º proporcional registrado em rubrica(s) separada(s), pendente(s) de revisão.");
      setFixedBase("");
      setVariableAverage("0");
      setBaseConfirmed(false);
      setProjectionConfirmed(false);
      await onSaved();
    }
    setSaving(false);
  }

  return (
    <section className="payroll-create">
      <div>
        <div className="form-kicker">MOTOR ASSISTIDO · ETAPA 3</div>
        <h2><Calculator size={18}/> 13º salário proporcional na rescisão</h2>
        <p>Apura os avos por mês-calendário, com a regra de 15 dias, e separa a parcela decorrente do aviso indenizado quando cabível.</p>
      </div>
      <div className="employee-stats payroll-stats">
        <div><span>Admissão considerada</span><b>{admissionDate ? dateBR(admissionDate) : "Não informada"}</b></div>
        <div><span>Data do desligamento</span><b>{dateBR(terminationDate)}</b></div>
        <div><span>Avos até o desligamento</span><b>{termination.avos}/12</b></div>
        <div><span>Projeção do aviso</span><b>{projectionEligible && projectedNoticeEndDate ? dateBR(projectedNoticeEndDate) : "Não aplicada"}</b></div>
      </div>
      {blockedByCause ? <div className="notice error">13º proporcional bloqueado para justa causa. Não gere esta verba sem fundamento jurídico específico.</div> : <>
        {!admissionDate && <div className="notice error">A data de admissão não está cadastrada. O cálculo não pode apurar os avos corretamente.</div>}
        <div className="dependent-privacy"><ShieldAlert size={17}/><span>O avo é contado quando há pelo menos 15 dias no mês-calendário. A projeção do aviso não é presumida: só é aplicada nesta etapa para dispensa sem justa causa com aviso indenizado e data projetada posterior ao desligamento. Em outras modalidades, valide o enquadramento antes de lançar eventual diferença.</span></div>
        <div className="form-two">
          <label>Remuneração fixa mensal (R$)
            <input type="number" min="0" step="0.01" value={fixedBase} onChange={e=>{setFixedBase(e.target.value);setBaseConfirmed(false);}} placeholder="Salário devido na rescisão"/>
          </label>
          <label>Média mensal de variáveis/adicionais (R$)
            <input type="number" min="0" step="0.01" value={variableAverage} onChange={e=>{setVariableAverage(e.target.value);setBaseConfirmed(false);}}/>
          </label>
        </div>
        <div className="employee-stats payroll-stats">
          <div><span>Base remuneratória total</span><b>{fixedBase !== "" && Number.isFinite(base) ? money(base) : "—"}</b></div>
          <div><span>13º proporcional</span><b>{proportionalAmount === null ? "Bloqueado" : money(proportionalAmount)}</b></div>
          <div><span>Avos adicionais do aviso</span><b>{projectedAvos}/12</b></div>
          <div><span>13º sobre aviso</span><b>{projectedAmount === null ? "—" : money(projectedAmount)}</b></div>
        </div>
        {projectionEligible && projected && projectedAvos > 0 && <label className="dependent-privacy">
          <input type="checkbox" checked={projectionConfirmed} onChange={e=>setProjectionConfirmed(e.target.checked)}/>
          Confirmo que a data projetada e os avos adicionais do aviso indenizado foram conferidos com o aviso formal e o tempo de serviço.
        </label>}
        {projectionEligible && projectedAvos === 0 && <div className="dependent-privacy"><ShieldCheck size={17}/><span>A projeção não acrescenta avo além dos já contados até o desligamento; nenhuma rubrica adicional será gerada.</span></div>}
        <label className="dependent-privacy">
          <input type="checkbox" checked={baseConfirmed} onChange={e=>setBaseConfirmed(e.target.checked)}/>
          Confirmo que a base considera remuneração fixa devida na rescisão e médias de variáveis/adicionais cabíveis, conforme histórico e documentos.
        </label>
        <div className="dependent-privacy"><ShieldCheck size={17}/><span>O sistema não deduz adiantamentos do 13º, não interpreta automaticamente afastamentos/faltas e não apura médias. As rubricas são gravadas como pré-cálculo, com memória mensal e status pendente de revisão.</span></div>
        <button className="employee-primary" onClick={()=>void save()} disabled={saving || !validBase || !admissionDate || (projectionEligible && projectedAvos > 0 && !projectionConfirmed)}>
          {saving ? "Registrando..." : "Gerar 13º proporcional"}
        </button>
      </>}
      {error && <div className="notice error">{error}</div>}
      {success && <div className="notice success">{success}</div>}
    </section>
  );
}
