"use client";
import {useEffect,useMemo,useState} from "react";
import {RefreshCw,ShieldAlert,CheckCircle2,AlertTriangle} from "lucide-react";
import {createClient} from "@/lib/supabase/client";

type ReconciliationRow={
 variable_event_id:string;organization_id:string;employee_id:string;employee_code:string|null;employee_name:string|null;
 competence_month:string;event_date:string|null;code:string;description:string;item_type:string;quantity:number;quantity_unit:string;unit_value:number;event_amount:number;event_status:string;
 processed_entry_id:string|null;event_affects_inss:boolean;event_affects_irrf:boolean;event_affects_fgts:boolean;event_affects_dsr:boolean;
 rubric_id:string|null;rubric_active:boolean|null;rubric_item_type:string|null;rubric_affects_inss:boolean|null;rubric_affects_irrf:boolean|null;rubric_affects_fgts:boolean|null;rubric_affects_dsr:boolean|null;
 payroll_item_count:number;payroll_item_amount:number;payroll_competences:string[]|null;payroll_run_statuses:string[]|null;payroll_entry_statuses:string[]|null;payroll_entry_ids:string[]|null;
 item_inss_mismatch:boolean;item_irrf_mismatch:boolean;item_fgts_mismatch:boolean;item_dsr_mismatch:boolean;rubric_incidence_mismatch:boolean;reconciliation_status:string;
};
const statusLabel:Record<string,string>={
 reconciled:"Conciliado",awaiting_approval:"Aguardando aprovação",approved_not_posted:"Aprovado · não lançado",
 processed_without_item:"Processado sem item na folha",not_posted:"Evento não lançado",duplicate_posting:"Possível duplicidade",
 amount_mismatch:"Divergência de valor",competence_mismatch:"Competência divergente",
 event_status_mismatch:"Status do evento divergente",rejected_event_posted:"Evento rejeitado com lançamento",
 event_without_rubric:"Evento sem rubrica vinculada",inactive_rubric:"Rubrica inativa",rubric_type_mismatch:"Tipo de rubrica divergente",
 rubric_incidence_mismatch:"Incidências da rubrica divergentes",incidence_mismatch:"Incidências divergentes na folha",
 entry_reference_mismatch:"Referência do processamento divergente"
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
  const {data,error:queryError}=await s.from("payroll_variable_event_reconciliation").select("variable_event_id,organization_id,employee_id,employee_code,employee_name,competence_month,event_date,code,description,item_type,quantity,quantity_unit,unit_value,event_amount,event_status,processed_entry_id,event_affects_inss,event_affects_irrf,event_affects_fgts,event_affects_dsr,rubric_id,rubric_active,rubric_item_type,rubric_affects_inss,rubric_affects_irrf,rubric_affects_fgts,rubric_affects_dsr,payroll_item_count,payroll_item_amount,payroll_competences,payroll_run_statuses,payroll_entry_statuses,payroll_entry_ids,item_inss_mismatch,item_irrf_mismatch,item_fgts_mismatch,item_dsr_mismatch,rubric_incidence_mismatch,reconciliation_status").eq("organization_id",membership.organization_id).eq("competence_month",month+"-01").order("employee_name").order("code");
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
  pending:rows.filter(x=>["awaiting_approval","approved_not_posted","not_posted"].includes(x.reconciliation_status)).length,
  anomalies:rows.filter(x=>x.reconciliation_status!=="reconciled"&&!["awaiting_approval","approved_not_posted","not_posted"].includes(x.reconciliation_status)).length
 }),[rows]);
 return <section className="employee-list-card payroll-list">
  <div className="employee-list-head"><div><h2>Conciliação integrada: eventos variáveis × folha</h2><p>Compara todos os eventos variáveis aprovados ou processados com os itens lançados na folha. Confere valores, competência, rubrica, incidências de INSS, IRRF, FGTS e DSR, duplicidades e vínculo ao processamento. Não calcula nem altera a folha.</p></div><button className="employee-secondary" onClick={()=>void load()} disabled={loading}><RefreshCw size={15}/> Atualizar</button></div>
  <div className="employee-stats payroll-stats">
   <div><span>Registros conciliados</span><b>{counts.reconciled}</b></div>
   <div><span>Pendentes de aprovação/lançamento</span><b>{counts.pending}</b></div>
   <div><span>Divergências / anomalias</span><b>{counts.anomalies}</b></div>
   <div><span>Total de registros</span><b>{counts.total}</b></div>
  </div>
  {error&&<p className="form-error"><ShieldAlert size={16}/> {error}</p>}
  {loading?<div className="employee-empty">Carregando conciliação...</div>:!rows.length?<div className="employee-empty"><CheckCircle2 size={22}/><b>Nenhum evento ou item DSR localizado nesta competência</b><p>Isso pode significar que ainda não há eventos variáveis ou lançamentos vinculados. Não representa aprovação nem liberação do cálculo.</p></div>:
   <div className="table-scroll"><table className="employee-table"><thead><tr><th>Colaborador</th><th>Rubrica / tipo</th><th>Evento</th><th>Composição / valor</th><th>Incidências do evento</th><th>Itens na folha</th><th>Valor lançado</th><th>Competência da folha</th><th>Vínculo do processamento</th><th>Conferência</th></tr></thead><tbody>
    {rows.map((row,index)=><tr key={(row.variable_event_id||"item")+"-"+index}>
     <td><b>{row.employee_name||"Colaborador não identificado"}</b><br/><small>{row.employee_code||"—"}</small></td>
     <td>{row.code} · {row.description}<br/><small>{row.rubric_id?(row.rubric_active?"Rubrica ativa":"Rubrica inativa"):"Sem rubrica"} · {row.rubric_item_type||"tipo não identificado"}</small></td>
     <td>{({pending:"Pendente",approved:"Aprovado",processed:"Processado",rejected:"Rejeitado"} as Record<string,string>)[row.event_status]||row.event_status}</td>
     <td>{Number(row.quantity).toLocaleString("pt-BR")} {row.quantity_unit==="hours"?"h":row.quantity_unit==="days"?"dias":"unid."} × {money(row.unit_value)}<br/><b>{money(row.event_amount)}</b></td>
     <td><small>INSS: {row.event_affects_inss?"Sim":"Não"} · {row.payroll_item_count?(row.item_inss_mismatch?"diverge":"confere"):"sem lançamento"}<br/>IRRF: {row.event_affects_irrf?"Sim":"Não"} · {row.payroll_item_count?(row.item_irrf_mismatch?"diverge":"confere"):"sem lançamento"}<br/>FGTS: {row.event_affects_fgts?"Sim":"Não"} · {row.payroll_item_count?(row.item_fgts_mismatch?"diverge":"confere"):"sem lançamento"}<br/>DSR: {row.event_affects_dsr?"Sim":"Não"} · {row.payroll_item_count?(row.item_dsr_mismatch?"diverge":"confere"):"sem lançamento"}<br/>{row.rubric_incidence_mismatch?"Evento diverge da configuração da rubrica": "Evento compatível com a rubrica"}</small></td>
     <td>{row.payroll_item_count}</td><td>{money(row.payroll_item_amount)}</td>
     <td>{row.payroll_competences?.length?row.payroll_competences.map(x=>new Date(x+"T12:00:00").toLocaleDateString("pt-BR",{month:"2-digit",year:"numeric"})).join(", "):"—"}</td>
     <td><small>Entrada: {row.payroll_entry_ids?.length?row.payroll_entry_ids.join(", "):"—"}<br/>Referência no evento: {row.processed_entry_id||"—"}<br/>Status da folha: {row.payroll_entry_statuses?.join(", ")||"—"} / {row.payroll_run_statuses?.join(", ")||"—"}</small></td>
     <td><span className="status-pill">{statusLabel[row.reconciliation_status]||row.reconciliation_status}</span>{row.reconciliation_status!=="reconciled"&&<small><br/><AlertTriangle size={12}/> Revisar antes de qualquer processamento</small>}</td>
    </tr>)}
   </tbody></table></div>}
  <p className="form-hint">Atualizado em {refreshed||"—"}. O valor lançado é comparado ao valor do evento de origem, com tolerância técnica de R$ 0,01. As incidências são comparadas separadamente entre evento, rubrica e item de folha. Nenhuma divergência é corrigida automaticamente.</p>
 </section>;
}
