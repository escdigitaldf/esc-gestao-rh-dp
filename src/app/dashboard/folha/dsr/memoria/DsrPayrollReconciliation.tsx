"use client";
import {useEffect,useMemo,useState} from "react";
import {RefreshCw,ShieldAlert,CheckCircle2,AlertTriangle} from "lucide-react";
import {createClient} from "@/lib/supabase/client";

type ReconciliationRow={
 variable_event_id:string|null;organization_id:string;employee_id:string|null;employee_code:string|null;employee_name:string|null;
 competence_month:string;event_date:string|null;code:string;description:string;event_amount:number|null;event_status:string|null;
 processed_entry_id:string|null;payroll_item_count:number;payroll_item_amount:number;payroll_competences:string[]|null;
 payroll_run_statuses:string[]|null;payroll_entry_statuses:string[]|null;reconciliation_status:string;
};
const statusLabel:Record<string,string>={
 reconciled:"Conciliado",awaiting_approval:"Aguardando aprovação",approved_not_posted:"Aprovado · não lançado",
 processed_without_item:"Processado sem item na folha",duplicate_posting:"Possível duplicidade",
 amount_mismatch:"Divergência de valor",competence_mismatch:"Competência divergente",
 event_status_mismatch:"Status do evento divergente",rejected_not_posted:"Evento rejeitado · sem lançamento",
 rejected_event_posted:"Evento rejeitado com lançamento",payroll_item_without_event:"Item DSR sem evento de origem"
};
const money=(v:number|null)=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
export default function DsrPayrollReconciliation({month}:{month:string}){
 const [rows,setRows]=useState<ReconciliationRow[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [refreshed,setRefreshed]=useState("");
 const load=async()=>{
  setLoading(true);setError("");
  const s=createClient();
  const {data:{user},error:authError}=await s.auth.getUser();
  if(authError||!user){setError("Sessão não identificada.");setLoading(false);return;}
  const {data:membership,error:membershipError}=await s.from("organization_memberships").select("organization_id").eq("user_id",user.id).eq("status","active").limit(1).maybeSingle();
  if(membershipError||!membership){setError(membershipError?.message||"Organização não encontrada.");setLoading(false);return;}
  const {data,error:queryError}=await s.from("dsr_payroll_reconciliation").select("variable_event_id,organization_id,employee_id,employee_code,employee_name,competence_month,event_date,code,description,event_amount,event_status,processed_entry_id,payroll_item_count,payroll_item_amount,payroll_competences,payroll_run_statuses,payroll_entry_statuses,reconciliation_status").eq("organization_id",membership.organization_id).eq("competence_month",month+"-01").order("employee_name").order("code");
  if(queryError)setError(queryError.message);
  setRows((data||[]) as ReconciliationRow[]);
  setRefreshed(new Date().toLocaleString("pt-BR"));
  setLoading(false);
 };
 useEffect(()=>{void load();},[month]);
 const counts=useMemo(()=>({
  total:rows.length,
  reconciled:rows.filter(x=>x.reconciliation_status==="reconciled").length,
  blockers:rows.filter(x=>x.reconciliation_status!=="reconciled").length,
  pending:rows.filter(x=>["awaiting_approval","approved_not_posted"].includes(x.reconciliation_status)).length,
  anomalies:rows.filter(x=>["duplicate_posting","amount_mismatch","competence_mismatch","processed_without_item","event_status_mismatch","rejected_event_posted","payroll_item_without_event"].includes(x.reconciliation_status)).length
 }),[rows]);
 return <section className="employee-list-card payroll-list">
  <div className="employee-list-head"><div><h2>Conciliação integrada: DSR × folha</h2><p>Compara eventos variáveis com incidência de DSR aos itens efetivamente lançados na folha, identificando pendências, divergências e possíveis duplicidades. Não calcula DSR nem altera lançamentos.</p></div><button className="employee-secondary" onClick={()=>void load()} disabled={loading}><RefreshCw size={15}/> Atualizar</button></div>
  <div className="employee-stats payroll-stats">
   <div><span>Registros conciliados</span><b>{counts.reconciled}</b></div>
   <div><span>Pendentes de aprovação/lançamento</span><b>{counts.pending}</b></div>
   <div><span>Divergências / anomalias</span><b>{counts.anomalies}</b></div>
   <div><span>Total de registros</span><b>{counts.total}</b></div>
  </div>
  {error&&<p className="form-error"><ShieldAlert size={16}/> {error}</p>}
  {loading?<div className="employee-empty">Carregando conciliação...</div>:!rows.length?<div className="employee-empty"><CheckCircle2 size={22}/><b>Nenhum evento ou item DSR localizado nesta competência</b><p>Isso pode significar que ainda não há eventos variáveis ou lançamentos vinculados. Não representa aprovação nem liberação do cálculo.</p></div>:
   <div className="table-scroll"><table className="employee-table"><thead><tr><th>Colaborador</th><th>Rubrica</th><th>Evento</th><th>Valor origem</th><th>Itens na folha</th><th>Valor lançado</th><th>Competência da folha</th><th>Conferência</th></tr></thead><tbody>
    {rows.map((row,index)=><tr key={(row.variable_event_id||"item")+"-"+index}>
     <td><b>{row.employee_name||"Colaborador não identificado"}</b><br/><small>{row.employee_code||"—"}</small></td>
     <td>{row.code} · {row.description}</td>
     <td>{row.event_status?({pending:"Pendente",approved:"Aprovado",processed:"Processado",rejected:"Rejeitado"} as Record<string,string>)[row.event_status]||row.event_status:"Sem evento de origem"}</td>
     <td>{row.event_amount===null?"—":money(row.event_amount)}</td>
     <td>{row.payroll_item_count}</td><td>{money(row.payroll_item_amount)}</td>
     <td>{row.payroll_competences?.length?row.payroll_competences.map(x=>new Date(x+"T12:00:00").toLocaleDateString("pt-BR",{month:"2-digit",year:"numeric"})).join(", "):"—"}</td>
     <td><span className="status-pill">{statusLabel[row.reconciliation_status]||row.reconciliation_status}</span>{row.reconciliation_status!=="reconciled"&&<small><br/><AlertTriangle size={12}/> Revisar antes de qualquer processamento</small>}</td>
    </tr>)}
   </tbody></table></div>}
  <p className="form-hint">Atualizado em {refreshed||"—"}. O valor lançado é comparado ao valor do evento de origem, com tolerância técnica de R$ 0,01. Eventos aprovados não são considerados lançados até existir item de folha vinculado.</p>
 </section>;
}
