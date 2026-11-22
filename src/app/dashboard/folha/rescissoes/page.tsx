"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ClipboardList, Plus, RefreshCw, ShieldCheck, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Employee = { id: string; employee_code: string; full_name: string; admission_date: string | null; employment_status: string; };
type ChecklistItem = { key: string; label: string; done: boolean; };
type CaseRow = { id: string; employee_id: string; termination_reason: string; notice_type: string; termination_date: string; payment_deadline: string | null; case_status: string; calculation_status: string; notes: string | null; checklist: ChecklistItem[]; employees?: Employee | Employee[] | null; };
const reasons: Record<string,string> = {
 employer_without_cause:"Dispensa sem justa causa", employee_resignation:"Pedido de demissão",
 mutual_agreement:"Acordo entre as partes", employer_with_cause:"Dispensa por justa causa",
 fixed_term_end:"Término de contrato por prazo determinado", indirect_termination:"Rescisão indireta",
 death:"Falecimento", other:"Outro"
};
const statusLabel: Record<string,string> = { draft:"Rascunho", in_review:"Em conferência", ready_for_validation:"Aguardando validação", cancelled:"Cancelado" };
const noticeLabel: Record<string,string> = { worked:"Trabalhado", indemnified:"Indenizado", waived:"Dispensado", not_applicable:"Não aplicável", pending_review:"A definir" };
const brDate=(value:string|null)=>value?new Date(value+"T12:00:00").toLocaleDateString("pt-BR"):"—";
const caseEmployee=(row:CaseRow):Employee|null=>Array.isArray(row.employees)?row.employees[0]||null:row.employees||null;

export default function TerminationModulePage(){
 const router=useRouter();
 const [org,setOrg]=useState("");
 const [employees,setEmployees]=useState<Employee[]>([]);
 const [cases,setCases]=useState<CaseRow[]>([]);
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState("");
 const [success,setSuccess]=useState("");
 const [employeeId,setEmployeeId]=useState("");
 const [reason,setReason]=useState("employer_without_cause");
 const [notice,setNotice]=useState("pending_review");
 const [noticeDate,setNoticeDate]=useState("");
 const [lastWorked,setLastWorked]=useState("");
 const [terminationDate,setTerminationDate]=useState("");
 const [deadline,setDeadline]=useState("");
 const [notes,setNotes]=useState("");
 const [expandedCase,setExpandedCase]=useState("");

 const load=useCallback(async()=>{
  setLoading(true);setError("");
  const s=createClient();
  const {data:{user},error:authError}=await s.auth.getUser();
  if(authError||!user){router.replace("/");return;}
  const {data:membership,error:membershipError}=await s.from("organization_memberships").select("organization_id").eq("user_id",user.id).eq("status","active").limit(1).maybeSingle();
  if(membershipError||!membership){setError(membershipError?.message||"Organização ativa não encontrada.");setLoading(false);return;}
  setOrg(membership.organization_id);
  const [employeeResult,caseResult]=await Promise.all([
   s.from("employees").select("id,employee_code,full_name,admission_date,employment_status").eq("organization_id",membership.organization_id).eq("employment_status","active").order("full_name"),
   s.from("payroll_termination_cases").select("id,employee_id,termination_reason,notice_type,termination_date,payment_deadline,case_status,calculation_status,notes,checklist,employees(id,employee_code,full_name,admission_date,employment_status)").eq("organization_id",membership.organization_id).order("termination_date",{ascending:false})
  ]);
  if(employeeResult.error||caseResult.error){setError(employeeResult.error?.message||caseResult.error?.message||"Falha ao carregar processos rescisórios.");setLoading(false);return;}
  setEmployees((employeeResult.data||[]) as Employee[]);
  setCases((caseResult.data||[]) as CaseRow[]);
  setLoading(false);
 },[router]);
 useEffect(()=>{void load();},[load]);

 const openCases=useMemo(()=>cases.filter(c=>c.case_status!=="cancelled"),[cases]);
 const pending=useMemo(()=>openCases.filter(c=>c.calculation_status!=="validated").length,[openCases]);

 async function createCase(event:React.FormEvent){
  event.preventDefault();setError("");setSuccess("");
  if(!employeeId||!terminationDate){setError("Selecione o colaborador e informe a data do desligamento.");return;}
  if(noticeDate&&noticeDate>terminationDate){setError("A data do aviso não pode ser posterior à data de desligamento.");return;}
  if(lastWorked&&lastWorked>terminationDate){setError("O último dia trabalhado não pode ser posterior à data de desligamento.");return;}
  if(deadline&&deadline<terminationDate){setError("A data de pagamento informada é anterior ao desligamento. Revise o prazo legal aplicável.");return;}
  setSaving(true);
  const s=createClient();
  const {error:insertError}=await s.from("payroll_termination_cases").insert({
   organization_id:org,employee_id:employeeId,termination_reason:reason,notice_type:notice,
   notice_date:noticeDate||null,last_worked_date:lastWorked||null,termination_date:terminationDate,
   payment_deadline:deadline||null,case_status:"draft",calculation_status:"pending_manual_review",
   checklist:[
    {key:"contract_data",label:"Conferir dados contratuais e cadastrais",done:false},
    {key:"salary_history",label:"Conferir histórico salarial e médias",done:false},
    {key:"vacation",label:"Conferir férias vencidas e proporcionais",done:false},
    {key:"thirteenth",label:"Conferir 13º salário proporcional",done:false},
    {key:"notice",label:"Conferir aviso-prévio e projeção",done:false},
    {key:"deductions",label:"Conferir descontos e adiantamentos",done:false},
    {key:"fgts",label:"Conferir FGTS e multa rescisória, quando aplicável",done:false},
    {key:"documents",label:"Conferir documentos e obrigações de desligamento",done:false}
   ],
   notes:notes.trim()||null
  });
  if(insertError){setError(insertError.message);}else{
   setSuccess("Processo rescisório aberto como rascunho. Nenhuma verba foi calculada e o cadastro do colaborador não foi alterado.");
   setEmployeeId("");setNoticeDate("");setLastWorked("");setTerminationDate("");setDeadline("");setNotes("");
   await load();
  }
  setSaving(false);
 }

 async function toggleChecklist(row:CaseRow,itemKey:string,done:boolean){
  setError("");setSuccess("");setSaving(true);
  const checklist=(row.checklist||[]).map(item=>item.key===itemKey?{...item,done}:item);
  const {error:updateError}=await createClient().from("payroll_termination_cases").update({
   checklist,updated_by:(await createClient().auth.getUser()).data.user?.id
  }).eq("id",row.id).eq("organization_id",org);
  if(updateError)setError(updateError.message);else{setSuccess("Checklist atualizado e registrado na trilha de auditoria.");await load();}
  setSaving(false);
 }

 async function updateStatus(row:CaseRow,next:string){
  setError("");setSuccess("");
  if(next==="ready_for_validation"&&row.calculation_status!=="validated"){
   setError("O processo não pode ir para validação final enquanto a memória de cálculo não estiver validada.");return;
  }
  setSaving(true);
  const {error:updateError}=await createClient().from("payroll_termination_cases").update({case_status:next,updated_by:(await createClient().auth.getUser()).data.user?.id}).eq("id",row.id).eq("organization_id",org);
  if(updateError)setError(updateError.message);else{setSuccess("Etapa do processo atualizada e registrada no histórico.");await load();}
  setSaving(false);
 }

 if(loading)return <div className="loading-screen">Carregando módulo de rescisões...</div>;
 return <main className="module-shell">
  <header className="module-top"><a href="/dashboard/folha"><ArrowLeft size={16}/> Folha de pagamento</a><b><span className="brand-mark">ESC</span> Gestão de RH e DP</b><span>Rescisões</span></header>
  <section className="module-content payroll-content">
   <div className="module-heading"><div><div className="form-kicker">DEPARTAMENTO PESSOAL · DESLIGAMENTOS</div><h1>Gestão de Rescisões</h1><p>Abertura, conferência documental e acompanhamento dos processos de desligamento.</p></div><a className="employee-secondary" href="/dashboard/folha"><ArrowLeft size={15}/> Voltar à folha</a></div>
   {error&&<div className="notice error">{error}</div>}{success&&<div className="notice success">{success}</div>}
   <div className="dependent-privacy"><ShieldCheck size={17}/><span>O processo mantém trilha de auditoria e separa o cadastro do desligamento da efetivação contratual. Não há cálculo automático de verbas nem alteração automática do vínculo do colaborador nesta etapa.</span></div>
   <div className="dependent-privacy"><AlertTriangle size={17}/><span><b>Conferência obrigatória:</b> aviso-prévio, médias, férias, 13º, FGTS, descontos e prazo de pagamento dependem da modalidade e das condições do contrato. Valores não validados não serão tratados como definitivos.</span></div>
   <div className="employee-stats payroll-stats">
    <div><span>Processos em aberto</span><b>{openCases.length}</b></div>
    <div><span>Aguardando conferência</span><b>{pending}</b></div>
    <div><span>Colaboradores ativos</span><b>{employees.length}</b></div>
    <div><span>Processos cancelados</span><b>{cases.filter(c=>c.case_status==="cancelled").length}</b></div>
   </div>
   <div className="payroll-create">
    <div><div className="form-kicker">NOVO PROCESSO</div><h2>Abertura de rescisão</h2><p>Registre os dados iniciais. A memória de cálculo será desenvolvida na próxima etapa.</p></div>
    <form onSubmit={createCase}>
     <label>Colaborador<select required value={employeeId} onChange={e=>setEmployeeId(e.target.value)}><option value="">Selecione o colaborador</option>{employees.map(e=><option key={e.id} value={e.id}>{e.employee_code} — {e.full_name}</option>)}</select></label>
     <label>Motivo do desligamento<select value={reason} onChange={e=>setReason(e.target.value)}>{Object.entries(reasons).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
     <label>Tipo de aviso-prévio<select value={notice} onChange={e=>setNotice(e.target.value)}>{Object.entries(noticeLabel).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
     <div className="form-two"><label>Data do aviso<input type="date" value={noticeDate} onChange={e=>setNoticeDate(e.target.value)}/></label><label>Último dia trabalhado<input type="date" value={lastWorked} onChange={e=>setLastWorked(e.target.value)}/></label></div>
     <div className="form-two"><label>Data do desligamento<input required type="date" value={terminationDate} onChange={e=>setTerminationDate(e.target.value)}/></label><label>Prazo de pagamento previsto<input type="date" value={deadline} onChange={e=>setDeadline(e.target.value)}/><small>Informe após confirmar a regra aplicável ao caso.</small></label></div>
     <label>Observações<textarea rows={3} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Motivo detalhado, particularidades contratuais e documentos pendentes"/></label>
     <button className="employee-primary" disabled={saving||!employees.length}><Plus size={15}/> Abrir processo rescisório</button>
    </form>
   </div>
   <div className="employee-list-card payroll-list">
    <div className="employee-list-head"><div><h2>Processos de desligamento</h2><p>Registro histórico, status e pendências por colaborador.</p></div><button className="employee-secondary" onClick={()=>void load()} disabled={saving}><RefreshCw size={14}/> Atualizar</button></div>
    {!cases.length?<div className="employee-empty"><ClipboardList size={24}/><b>Nenhum processo rescisório cadastrado.</b><p>Abra o primeiro processo para iniciar o controle.</p></div>:
     <div className="table-scroll"><table className="employee-table"><thead><tr><th>Colaborador</th><th>Motivo</th><th>Desligamento</th><th>Aviso</th><th>Pagamento previsto</th><th>Processo</th><th>Cálculo</th><th>Ação</th></tr></thead><tbody>
      {cases.map(row=><><tr key={row.id}><td><b>{caseEmployee(row)?.full_name||"Colaborador"}</b><br/><small>{caseEmployee(row)?.employee_code||"—"}</small></td><td>{reasons[row.termination_reason]||row.termination_reason}</td><td>{brDate(row.termination_date)}</td><td>{noticeLabel[row.notice_type]||row.notice_type}</td><td>{brDate(row.payment_deadline)}</td><td><span className="status-pill">{statusLabel[row.case_status]||row.case_status}</span></td><td>{row.calculation_status==="validated"?"Validado":row.calculation_status==="blocked_missing_data"?"Bloqueado":"Pendente de revisão"}</td><td><div className="payroll-detail-actions"><button className="employee-secondary" disabled={saving} onClick={()=>setExpandedCase(expandedCase===row.id?"":row.id)}>Checklist</button>{row.case_status==="draft"?<button className="employee-secondary" disabled={saving} onClick={()=>void updateStatus(row,"in_review")}>Enviar à conferência</button>:row.case_status==="in_review"?<button className="employee-secondary" disabled={saving} onClick={()=>void updateStatus(row,"draft")}>Voltar ao rascunho</button>:<span>—</span>}</div></td></tr>{expandedCase===row.id&&<tr key={row.id+"-checklist"}><td colSpan={8}><div className="dependent-privacy"><ClipboardList size={16}/><b>Checklist de conferência — {row.employees?.full_name||"Colaborador"}</b></div><div className="form-two">{(row.checklist||[]).map(item=><label key={item.key} className="dependent-privacy"><input type="checkbox" checked={!!item.done} disabled={saving||row.case_status==="cancelled"} onChange={e=>void toggleChecklist(row,item.key,e.target.checked)}/>{item.label}</label>)}</div><small>O checklist organiza a revisão; marcar todos os itens não valida automaticamente os cálculos nem libera o desligamento.</small></td></tr>}</>)}
     </tbody></table></div>}
   </div>
  </section>
 </main>;
}
