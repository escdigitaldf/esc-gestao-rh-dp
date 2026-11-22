"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, RefreshCw, ClipboardList, ShieldCheck, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import TerminationCaseDataPanel from "./TerminationCaseDataPanel";
import TerminationRubricGuide from "./TerminationRubricGuide";
import TerminationPreliminaryCalculator from "./TerminationPreliminaryCalculator";
import TerminationAcquiredVacationCalculator from "./TerminationAcquiredVacationCalculator";

type CaseRow = { id: string; employee_id: string; termination_date: string; termination_reason: string; notice_type: string; case_status: string; calculation_status: string; };
type Employee = { id: string; employee_code: string; full_name: string; };
type ItemRow = { id: string; item_code: string; description: string; item_type: string; reference_period: string | null; reference_quantity: number | null; reference_unit: string | null; calculation_base: number | null; rate: number | null; amount: number; calculation_method: string; calculation_status: string; legal_basis: string | null; review_notes: string | null; };
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
  const {data:caseData,error:caseError}=await s.from("payroll_termination_cases").select("id,employee_id,termination_date,termination_reason,notice_type,case_status,calculation_status").eq("organization_id",membership.organization_id).neq("case_status","cancelled").order("termination_date",{ascending:false});
  if(caseError){setError(caseError.message);setLoading(false);return;}
  const rows=(caseData||[]) as CaseRow[];
  setCases(rows);
  const employeeIds=[...new Set(rows.map(x=>x.employee_id))];
  if(employeeIds.length){
   const {data:employeeData,error:employeeError}=await s.from("employees").select("id,employee_code,full_name").eq("organization_id",membership.organization_id).in("id",employeeIds);
   if(employeeError){setError(employeeError.message);setLoading(false);return;}
   setEmployees(Object.fromEntries(((employeeData||[]) as Employee[]).map(x=>[x.id,x])));
  }else setEmployees({});
  const chosen=selectedCase&&rows.some(x=>x.id===selectedCase)?selectedCase:rows[0]?.id||"";
  setSelectedCase(chosen);
  if(chosen){
   const {data:itemData,error:itemError}=await s.from("payroll_termination_calculation_items").select("id,item_code,description,item_type,reference_period,reference_quantity,reference_unit,calculation_base,rate,amount,calculation_method,calculation_status,legal_basis,review_notes").eq("organization_id",membership.organization_id).eq("termination_case_id",chosen).order("sort_order").order("created_at");
   if(itemError){setError(itemError.message);setLoading(false);return;}
   setItems((itemData||[]) as ItemRow[]);
  }else setItems([]);
  setLoading(false);
 },[router,selectedCase]);
 useEffect(()=>{void load();},[load]);

 async function selectCase(id:string){
  setSelectedCase(id);setError("");setSuccess("");
  if(!id){setItems([]);return;}
  const {data,error:e}=await createClient().from("payroll_termination_calculation_items").select("id,item_code,description,item_type,reference_period,reference_quantity,reference_unit,calculation_base,rate,amount,calculation_method,calculation_status,legal_basis,review_notes").eq("organization_id",org).eq("termination_case_id",id).order("sort_order").order("created_at");
  if(e)setError(e.message);else setItems((data||[]) as ItemRow[]);
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
    {selected&&<TerminationPreliminaryCalculator organizationId={org} terminationCaseId={selected.id} userId={userId} reason={selected.termination_reason} existingCodes={items.map(x=>x.item_code)} onSaved={()=>selectCase(selected.id)}/> }
    {selected&&<TerminationAcquiredVacationCalculator organizationId={org} terminationCaseId={selected.id} employeeId={selected.employee_id} terminationDate={selected.termination_date} userId={userId} existingCodes={items.map(x=>x.item_code)} onSaved={()=>selectCase(selected.id)}/> }
    <div className="employee-stats payroll-stats"><div><span>Proventos preliminares</span><b>{money(totals.earnings)}</b></div><div><span>Descontos preliminares</span><b>{money(totals.deductions)}</b></div><div><span>Líquido preliminar</span><b>{money(totals.earnings-totals.deductions)}</b></div><div><span>Encargos patronais informados</span><b>{money(totals.charges)}</b></div></div>
    <div className="payroll-create"><div><div className="form-kicker">NOVO ITEM</div><h2>Adicionar verba ou informação</h2><p>O valor será gravado exatamente como informado, sem aplicação automática de alíquota ou fórmula.</p></div>
     <form onSubmit={addItem}>
      <div className="form-two"><label>Natureza<select value={itemType} onChange={e=>setItemType(e.target.value)}><option value="earning">Provento</option><option value="deduction">Desconto</option><option value="employer_charge">Encargo patronal</option><option value="information">Informativo</option></select></label><label>Código da rubrica<input required value={code} onChange={e=>setCode(e.target.value)} placeholder="Ex.: SALDO_SALARIO"/></label></div>
      <label>Descrição<input required value={description} onChange={e=>setDescription(e.target.value)} placeholder="Ex.: Saldo de salário"/></label>
      <div className="form-two"><label>Período de referência<input value={period} onChange={e=>setPeriod(e.target.value)} placeholder="Ex.: 12 dias / 11-2026"/></label><label>Quantidade<input type="number" step="0.0001" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label></div>
      <div className="form-two"><label>Unidade de referência<input value={unit} onChange={e=>setUnit(e.target.value)} placeholder="Dias, avos, horas..."/></label><label>Base de cálculo (R$)<input type="number" min="0" step="0.0001" value={base} onChange={e=>setBase(e.target.value)}/></label></div>
      <div className="form-two"><label>Alíquota/fator informado<input type="number" step="0.00000001" value={rate} onChange={e=>setRate(e.target.value)} placeholder="Opcional"/></label><label>Valor do item (R$)<input required type="number" min="0" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label></div>
      <label>Fundamento legal ou coletivo<input value={legalBasis} onChange={e=>setLegalBasis(e.target.value)} placeholder="Informe artigo, CCT/ACT, cláusula ou referência"/></label>
      <label>Observação da conferência<textarea rows={2} value={reviewNotes} onChange={e=>setReviewNotes(e.target.value)} placeholder="Origem do valor, documento consultado ou pendência"/></label>
      <button className="employee-primary" disabled={saving}>{saving?"Salvando...":<><Plus size={15}/> Registrar item preliminar</>}</button>
     </form>
    </div>
    <div className="employee-list-card payroll-list"><div className="employee-list-head"><div><h2>Itens da memória</h2><p>{items.length} item(ns) · todos sujeitos à conferência do DP</p></div><button className="employee-secondary" onClick={()=>void selectCase(selectedCase)} disabled={saving}><RefreshCw size={14}/> Atualizar</button></div>
     {!items.length?<div className="employee-empty"><ClipboardList size={24}/><b>Nenhum item informado</b><p>Adicione as verbas, descontos e informações que compõem a conferência deste processo.</p></div>:<div className="table-scroll"><table className="employee-table"><thead><tr><th>Natureza</th><th>Código</th><th>Descrição</th><th>Referência</th><th>Base</th><th>Fator</th><th>Valor</th><th>Situação</th><th>Fundamento</th></tr></thead><tbody>{items.map(x=><tr key={x.id}><td>{typeLabel[x.item_type]||x.item_type}</td><td><b>{x.item_code}</b></td><td>{x.description}</td><td>{[x.reference_quantity??null,x.reference_unit,x.reference_period].filter(Boolean).join(" · ")||"—"}</td><td>{x.calculation_base===null?"—":money(Number(x.calculation_base))}</td><td>{x.rate===null?"—":Number(x.rate).toLocaleString("pt-BR")}</td><td><b>{money(Number(x.amount))}</b></td><td><span className="dependent-inactive">Pendente de revisão</span></td><td>{x.legal_basis||"Não informado"}</td></tr>)}</tbody></table></div>}
    </div>
   </>}
  </section>
 </main>;
}
