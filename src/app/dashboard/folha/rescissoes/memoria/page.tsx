"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, RefreshCw, ClipboardList, ShieldCheck, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import TerminationCaseDataPanel from "./TerminationCaseDataPanel";
import TerminationRubricGuide from "./TerminationRubricGuide";
import TerminationPreliminaryCalculator from "./TerminationPreliminaryCalculator";
import TerminationAcquiredVacationCalculator from "./TerminationAcquiredVacationCalculator";
import TerminationThirteenthCalculator from "./TerminationThirteenthCalculator";
import TerminationRemunerationEvidence from "./TerminationRemunerationEvidence";
import TerminationAverageEngine from "./TerminationAverageEngine";
import TerminationAverageApplication from "./TerminationAverageApplication";

type CaseRow = { id: string; employee_id: string; termination_date: string; termination_reason: string; notice_type: string; projected_notice_end_date: string | null; case_status: string; calculation_status: string; };
type Employee = { id: string; employee_code: string; full_name: string; admission_date: string | null; };
type ItemRow = { id: string; item_code: string; description: string; item_type: string; reference_period: string | null; reference_quantity: number | null; reference_unit: string | null; calculation_base: number | null; rate: number | null; amount: number; calculation_method: string; calculation_status: string; legal_basis: string | null; review_notes: string | null; source_calculation_item_id: string | null; calculation_snapshot: Record<string, unknown> | null; };
const reasonLabel:Record<string,string>={employer_without_cause:"Dispensa sem justa causa",employee_resignation:"Pedido de demissão",mutual_agreement:"Acordo entre as partes",employer_with_cause:"Dispensa por justa causa",fixed_term_end:"Término de contrato",indirect_termination:"Rescisão indireta",death:"Falecimento",other:"Outro"};
const typeLabel:Record<string,string>={earning:"Provento",deduction:"Desconto",employer_charge:"Encargo patronal",information:"Informativo"};
const money=(v:number)=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const dateLabel=(v:string)=>new Date(v+"T12:00:00").toLocaleDateString("pt-BR");

export default function TerminationCalculationMemoryPage(){
 const router=useRouter();
 const [org,setOrg]=useState("");
 const [userId,setUserId]=useState("");
 const [cases,setCases]=useState<CaseRow[]>([]);
 const [employees,setEmployees]=useState<Record<string,Employee>>({});
 const [selectedCase,setSelectedCase]=useState("");
 const [items,setItems]=useState<ItemRow[]>([]);
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState("");
 const [success,setSuccess]=useState("");
 const [code,setCode]=useState("");
 const [description,setDescription]=useState("");
 const [itemType,setItemType]=useState("earning");
 const [period,setPeriod]=useState("");
 const [quantity,setQuantity]=useState("1");
 const [unit,setUnit]=useState("");
 const [base,setBase]=useState("");
 const [rate,setRate]=useState("");
 const [amount,setAmount]=useState("");
 const [legalBasis,setLegalBasis]=useState("");
 const [reviewNotes,setReviewNotes]=useState("");

 const load=useCallback(async()=>{
  setLoading(true);setError("");
  const s=createClient();
  const {data:{user},error:authError}=await s.auth.getUser();
  if(authError||!user){router.replace("/");return;}
  setUserId(user.id);
  const {data:membership,error:membershipError}=await s.from("organization_memberships").select("organization_id").eq("user_id",user.id).eq("status","active").limit(1).maybeSingle();
  if(membershipError||!membership){setError(membershipError?.message||"Organização ativa não encontrada.");setLoading(false);return;}
  setOrg(membership.organization_id);
  const {data:caseData,error:caseError}=await s.from("payroll_termination_cases").select("id,employee_id,termination_date,termination_reason,notice_type,projected_notice_end_date,case_status,calculation_status").eq("organization_id",membership.organization_id).neq("case_status","cancelled").order("termination_date",{ascending:false});
  if(caseError){setError(caseError.message);setLoading(false);return;}
  const rows=(caseData||[]) as CaseRow[];
  setCases(rows);
  const employeeIds=[...new Set(rows.map(x=>x.employee_id))];
  if(employeeIds.length){
   const {data:employeeData,error:employeeError}=await s.from("employees").select("id,employee_code,full_name,admission_date").eq("organization_id",membership.organization_id).in("id",employeeIds);
   if(employeeError){setError(employeeError.message);setLoading(false);return;}
   setEmployees(Object.fromEntries(((employeeData||[]) as Employee[]).map(x=>[x.id,x])));
  }else setEmployees({});
  const chosen=selectedCase&&rows.some(x=>x.id===selectedCase)?selectedCase:rows[0]?.id||"";
  setSelectedCase(chosen);
  if(chosen){
   const {data:itemData,error:itemError}=await s.from("payroll_termination_calculation_items").select("id,item_code,description,item_type,reference_period,reference_quantity,reference_unit,calculation_base,rate,amount,calculation_method,calculation_status,legal_basis,review_notes,source_calculation_item_id,calculation_snapshot").eq("organization_id",membership.organization_id).eq("termination_case_id",chosen).order("sort_order").order("created_at");
   if(itemError){setError(itemError.message);setLoading(false);return;}
   setItems((itemData||[]) as ItemRow[]);
  }else setItems([]);
  setLoading(false);
 },[router,selectedCase]);
 useEffect(()=>{void load();},[load]);

 async function selectCase(id:string){
  setSelectedCase(id);setError("");setSuccess("");
  if(!id){setItems([]);return;}
  const {data,error:e}=await createClient().from("payroll_termination_calculation_items").select("id,item_code,description,item_type,reference_period,reference_quantity,reference_unit,calculation_base,rate,amount,calculation_method,calculation_status,legal_basis,review_notes,source_calculation_item_id,calculation_snapshot").eq("organization_id",org).eq("termination_case_id",id).order("sort_order").order("created_at");
  if(e)setError(e.message);else setItems((data||[]) as ItemRow[]);
 }

 async function reviewItem(item:ItemRow){
  if(!selected||selected.case_status==="validated")return;
  const note=window.prompt("Registre a evidência ou observação da conferência deste item:");
  if(!note?.trim())return;
  let resolvedMethod=item.calculation_method;
  if(item.calculation_method==="formula_pending"&&item.item_type!=="information"){
   const method=window.prompt("A fórmula preliminar foi concluída e conferida? Informe manual ou parameter_table:", "manual");
   if(!method||!["manual","parameter_table"].includes(method.trim()))return;
   resolvedMethod=method.trim();
  }
  if(!window.confirm("Confirma que conferiu a base, o valor, o método e o fundamento desta rubrica?"))return;
  setSaving(true);setError("");setSuccess("");
  const {error:e}=await createClient().rpc("review_payroll_termination_calculation_item",{
   p_organization_id:org,p_termination_case_id:selected.id,p_item_id:item.id,
   p_review_notes:note.trim(),p_resolved_method:resolvedMethod,p_confirmed:true
  });
  if(e)setError(e.message);else{setSuccess("Item revisado e registrado na trilha de auditoria.");await selectCase(selected.id);}
  setSaving(false);
 }

 async function completeDerivedCalculation(item:ItemRow){
  if(!selected||selected.case_status==="validated"||!item.source_calculation_item_id||item.calculation_method!=="formula_pending")return;
  const amountText=window.prompt("Informe o valor final recalculado da verba de destino (R$). Use ponto ou vírgula decimal:");
  if(amountText===null)return;
  const finalAmount=Number(amountText.trim().replace(",","."));
  if(!Number.isFinite(finalAmount)||finalAmount<0){setError("Informe um valor final válido e não negativo.");return;}
  const method=window.prompt("Método efetivamente concluído: manual ou parameter_table","manual")?.trim();
  if(!method||!["manual","parameter_table"].includes(method))return;
  let parameterTableId:string|null=null;
  if(method==="parameter_table"){
   parameterTableId=window.prompt("Informe o UUID da tabela de parâmetros utilizada:")?.trim()||null;
   if(!parameterTableId){setError("A tabela de parâmetros utilizada é obrigatória.");return;}
  }
  const evidence=window.prompt("Descreva a memória/evidência do recálculo (base, período, divisor, critério e documento):");
  if(!evidence?.trim())return;
  const basis=window.prompt("Informe o fundamento legal ou coletivo específico da verba de destino:",item.legal_basis||"");
  if(!basis?.trim())return;
  if(!window.confirm("Confirma o recálculo? O valor original da média será preservado no snapshot; a verba continuará pendente de revisão individual."))return;
  setSaving(true);setError("");setSuccess("");
  const {data,error:e}=await createClient().rpc("complete_payroll_termination_derived_calculation",{
   p_organization_id:org,p_termination_case_id:selected.id,p_item_id:item.id,
   p_final_amount:finalAmount,p_calculation_method:method,
   p_calculation_base:null,p_rate:null,p_reference_period:null,p_reference_quantity:null,p_reference_unit:null,
   p_source_parameter_table_id:parameterTableId,p_evidence:evidence.trim(),p_legal_basis:basis.trim(),p_confirmed:true
  });
  if(e)setError(e.message);else{setSuccess("Recálculo concluído. A verba permanece pendente de revisão individual.");await selectCase(selected.id);}
  setSaving(false);
 }

 async function validateCase(){
  if(!selected)return;
  const justification=window.prompt("Justificativa da validação final. Registre a conferência realizada e a responsabilidade pela aprovação:");
  if(!justification?.trim())return;
  if(!window.confirm("Confirma a validação final? Após validado, o processo e sua memória ficarão bloqueados para alterações."))return;
  setSaving(true);setError("");setSuccess("");
  const {data,error:e}=await createClient().rpc("validate_payroll_termination_case",{
   p_organization_id:org,p_termination_case_id:selected.id,
   p_justification:justification.trim(),p_confirmed:true
  });
  if(e)setError(e.message);else{setSuccess("Processo rescisório validado e congelado. Registro de validação: "+JSON.stringify(data));await load();}
  setSaving(false);
 }

 async function addItem(event:React.FormEvent){
  event.preventDefault();setError("");setSuccess("");
  if(!selectedCase){setError("Selecione um processo rescisório.");return;}
  if(!code.trim()||!description.trim()||amount===""||!Number.isFinite(Number(amount))||Number(amount)<0){setError("Informe código, descrição e valor válido não negativo.");return;}
  setSaving(true);
  const s=createClient();
  const {error:e}=await s.from("payroll_termination_calculation_items").insert({
   organization_id:org,termination_case_id:selectedCase,item_code:code.trim().toUpperCase(),description:description.trim(),item_type:itemType,
   reference_period:period.trim()||null,reference_quantity:quantity===""?null:Number(quantity),reference_unit:unit.trim()||null,
   calculation_base:base===""?null:Number(base),rate:rate===""?null:Number(rate),amount:Number(amount),
   calculation_method:"manual",calculation_status:"pending_review",source_parameter_snapshot:{},
   calculation_snapshot:{entry_mode:"manual",entered_by:userId,entered_at:new Date().toISOString()},
   legal_basis:legalBasis.trim()||null,review_notes:reviewNotes.trim()||null,updated_by:userId
  });
  if(e)setError(e.message);else{
   setSuccess("Item registrado como valor preliminar, pendente de conferência.");
   setCode("");setDescription("");setPeriod("");setQuantity("1");setUnit("");setBase("");setRate("");setAmount("");setLegalBasis("");setReviewNotes("");
   await selectCase(selectedCase);
  }
  setSaving(false);
 }

 const totals=useMemo(()=>items.reduce((a,x)=>{if(x.item_type==="earning")a.earnings+=Number(x.amount||0);if(x.item_type==="deduction")a.deductions+=Number(x.amount||0);if(x.item_type==="employer_charge")a.charges+=Number(x.amount||0);return a;},{earnings:0,deductions:0,charges:0}),[items]);
 const selected=cases.find(x=>x.id===selectedCase);
 if(loading)return <div className="loading-screen">Carregando memória de cálculo rescisório...</div>;
 return <main className="module-shell">
  <header className="module-top"><a href="/dashboard/folha/rescissoes"><ArrowLeft size={16}/> Rescisões</a><b><span className="brand-mark">ESC</span> Gestão de RH e DP</b><span>Memória rescisória</span></header>
  <section className="module-content payroll-content">
   <div className="module-heading"><div><div className="form-kicker">DEPARTAMENTO PESSOAL · MEMÓRIA DE CÁLCULO</div><h1>Memória de cálculo rescisório</h1><p>Itens individualizados por processo, com origem, base, referência e trilha de revisão.</p></div><a className="employee-secondary" href="/dashboard/folha/rescissoes"><ArrowLeft size={15}/> Voltar aos processos</a></div>
   {error&&<div className="notice error">{error}</div>}{success&&<div className="notice success">{success}</div>}
   <div className="dependent-privacy"><ShieldCheck size={17}/><span>Esta etapa registra valores informados manualmente e mantém cada item pendente de revisão. Não aplica fórmulas legais automaticamente, não gera TRCT e não efetiva o desligamento.</span></div>
   <div className="dependent-privacy"><AlertTriangle size={17}/><span>Antes de validar, confira modalidade, aviso-prévio, projeção, histórico salarial e médias, férias, 13º, FGTS, descontos, normas coletivas e parâmetros vigentes. Itens sem fundamento ou conferência não devem ser tratados como definitivos.</span></div>
   {!cases.length?<div className="employee-empty"><ClipboardList size={25}/><b>Nenhum processo disponível</b><p>Abra um processo rescisório antes de registrar sua memória de cálculo.</p></div>:<>
    <div className="payroll-create"><div><div className="form-kicker">PROCESSO SELECIONADO</div><h2>{selected?employees[selected.employee_id]?.full_name||"Colaborador": "Selecione um processo"}</h2><p>{selected?reasonLabel[selected.termination_reason]+" · Desligamento em "+dateLabel(selected.termination_date):""}</p></div><label>Processo rescisório<select value={selectedCase} onChange={e=>void selectCase(e.target.value)}>{cases.map(x=><option key={x.id} value={x.id}>{employees[x.employee_id]?.employee_code||"—"} — {employees[x.employee_id]?.full_name||"Colaborador"} · {dateLabel(x.termination_date)}</option>)}</select></label></div>
    {selected&&<><TerminationCaseDataPanel organizationId={org} employeeId={selected.employee_id} terminationDate={selected.termination_date}/><TerminationRubricGuide reason={selected.termination_reason} noticeType={selected.notice_type}/></>}
    {selected&&<TerminationRemunerationEvidence organizationId={org} employeeId={selected.employee_id} terminationDate={selected.termination_date}/>}
    {selected&&<TerminationAverageEngine organizationId={org} terminationCaseId={selected.id} employeeId={selected.employee_id} terminationDate={selected.termination_date} userId={userId} existingCodes={items.map(x=>x.item_code)} onSaved={()=>selectCase(selected.id)}/> }
    {selected&&<TerminationAverageApplication organizationId={org} terminationCaseId={selected.id} userId={userId} items={items} onSaved={()=>selectCase(selected.id)}/> }
    {selected&&<TerminationPreliminaryCalculator organizationId={org} terminationCaseId={selected.id} userId={userId} reason={selected.termination_reason} existingCodes={items.map(x=>x.item_code)} onSaved={()=>selectCase(selected.id)}/> }
    {selected&&<TerminationAcquiredVacationCalculator organizationId={org} terminationCaseId={selected.id} employeeId={selected.employee_id} terminationDate={selected.termination_date} userId={userId} existingCodes={items.map(x=>x.item_code)} onSaved={()=>selectCase(selected.id)}/> }
    {selected&&<TerminationThirteenthCalculator organizationId={org} terminationCaseId={selected.id} employeeId={selected.employee_id} admissionDate={employees[selected.employee_id]?.admission_date||null} terminationDate={selected.termination_date} projectedNoticeEndDate={selected.projected_notice_end_date} reason={selected.termination_reason} noticeType={selected.notice_type} userId={userId} existingCodes={items.map(x=>x.item_code)} onSaved={()=>selectCase(selected.id)}/> }
    <div className="employee-stats payroll-stats"><div><span>Proventos preliminares</span><b>{money(totals.earnings)}</b></div><div><span>Descontos preliminares</span><b>{money(totals.deductions)}</b></div><div><span>Líquido preliminar</span><b>{money(totals.earnings-totals.deductions)}</b></div><div><span>Encargos patronais informados</span><b>{money(totals.charges)}</b></div></div>
    <div className="payroll-create">
     <div><div className="form-kicker">CONTROLE DE APROVAÇÃO</div><h2>Validação final</h2><p>{selected?.case_status==="validated"?"Processo validado e bloqueado para alterações.":"A validação exige checklist completo, todos os itens revisados, fundamento das verbas e fórmulas financeiras concluídas."}</p></div>
     {selected?.case_status==="validated"?<span className="status-pill">Validado</span>:<button className="employee-primary" disabled={saving||!selected||selected.case_status==="cancelled"||selected.case_status==="draft"} onClick={()=>void validateCase()}>Validar e bloquear processo</button>}
    </div>
    <div className="payroll-create"><div><div className="form-kicker">NOVO ITEM</div><h2>Adicionar verba ou informação</h2><p>O valor será gravado exatamente como informado, sem aplicação automática de alíquota ou fórmula.</p></div>
     <form onSubmit={addItem}>
      <div className="form-two"><label>Natureza<select value={itemType} onChange={e=>setItemType(e.target.value)}><option value="earning">Provento</option><option value="deduction">Desconto</option><option value="employer_charge">Encargo patronal</option><option value="information">Informativo</option></select></label><label>Código da rubrica<input required value={code} onChange={e=>setCode(e.target.value)} placeholder="Ex.: SALDO_SALARIO"/></label></div>
      <label>Descrição<input required value={description} onChange={e=>setDescription(e.target.value)} placeholder="Ex.: Saldo de salário"/></label>
      <div className="form-two"><label>Período de referência<input value={period} onChange={e=>setPeriod(e.target.value)} placeholder="Ex.: 12 dias / 11-2026"/></label><label>Quantidade<input type="number" step="0.0001" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label></div>
      <div className="form-two"><label>Unidade de referência<input value={unit} onChange={e=>setUnit(e.target.value)} placeholder="Dias, avos, horas..."/></label><label>Base de cálculo (R$)<input type="number" min="0" step="0.0001" value={base} onChange={e=>setBase(e.target.value)}/></label></div>
      <div className="form-two"><label>Alíquota/fator informado<input type="number" step="0.00000001" value={rate} onChange={e=>setRate(e.target.value)} placeholder="Opcional"/></label><label>Valor do item (R$)<input required type="number" min="0" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label></div>
      <label>Fundamento legal ou coletivo<input value={legalBasis} onChange={e=>setLegalBasis(e.target.value)} placeholder="Informe artigo, CCT/ACT, cláusula ou referência"/></label>
      <label>Observação da conferência<textarea rows={2} value={reviewNotes} onChange={e=>setReviewNotes(e.target.value)} placeholder="Origem do valor, documento consultado ou pendência"/></label>
      <button className="employee-primary" disabled={saving||selected?.case_status==="validated"}>{saving?"Salvando...":<><Plus size={15}/> Registrar item preliminar</>}</button>
     </form>
    </div>
    <div className="employee-list-card payroll-list"><div className="employee-list-head"><div><h2>Itens da memória</h2><p>{items.length} item(ns) · todos sujeitos à conferência do DP</p></div><button className="employee-secondary" onClick={()=>void selectCase(selectedCase)} disabled={saving}><RefreshCw size={14}/> Atualizar</button></div>
     {!items.length?<div className="employee-empty"><ClipboardList size={24}/><b>Nenhum item informado</b><p>Adicione as verbas, descontos e informações que compõem a conferência deste processo.</p></div>:<div className="table-scroll"><table className="employee-table"><thead><tr><th>Natureza</th><th>Código</th><th>Descrição</th><th>Referência</th><th>Base</th><th>Fator</th><th>Valor</th><th>Situação</th><th>Fundamento</th><th>Ação</th></tr></thead><tbody>{items.map(x=><tr key={x.id}><td>{typeLabel[x.item_type]||x.item_type}</td><td><b>{x.item_code}</b></td><td>{x.description}</td><td>{[x.reference_quantity??null,x.reference_unit,x.reference_period].filter(Boolean).join(" · ")||"—"}</td><td>{x.calculation_base===null?"—":money(Number(x.calculation_base))}</td><td>{x.rate===null?"—":Number(x.rate).toLocaleString("pt-BR")}</td><td><b>{money(Number(x.amount))}</b></td><td>{x.calculation_status==="reviewed"?<span className="status-pill">Revisado</span>:x.calculation_status==="blocked"?<span className="dependent-inactive">Bloqueado</span>:<span className="dependent-inactive">Pendente de revisão</span>}</td><td>{x.legal_basis||"Não informado"}</td><td>{x.calculation_status==="reviewed"?<span className="status-pill">Revisado</span>:x.source_calculation_item_id&&x.calculation_method==="formula_pending"?<button className="employee-secondary" disabled={saving||selected?.case_status==="validated"} onClick={()=>void completeDerivedCalculation(x)}>Concluir recálculo</button>:<button className="employee-secondary" disabled={saving||selected?.case_status==="validated"||x.calculation_status==="blocked"} onClick={()=>void reviewItem(x)}>Revisar item</button>}</td></tr>)}</tbody></table></div>}
    </div>
   </>}
  </section>
 </main>;
}
