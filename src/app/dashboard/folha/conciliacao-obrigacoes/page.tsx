"use client";

import {useCallback,useEffect,useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import {ArrowLeft,RefreshCw,ShieldCheck,Save,AlertTriangle,ReceiptText,FileCheck2} from "lucide-react";
import {createClient} from "@/lib/supabase/client";

type Row={payroll_run_id:string;competence:string;payroll_run_status:string;obligation_key:string;obligation_label:string;calculated_amount:number;guide_value_id:string|null;guide_reference:string|null;assessed_amount:number|null;paid_amount:number|null;due_date:string|null;paid_at:string|null;evidence_reference:string|null;notes:string|null;reconciliation_status:string;payment_status:string;difference_amount:number|null};
type Draft={guide_reference:string;assessed_amount:string;paid_amount:string;due_date:string;paid_at:string;evidence_reference:string;notes:string};
const money=(v:number|null|undefined)=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const emptyDraft=():Draft=>({guide_reference:"",assessed_amount:"",paid_amount:"",due_date:"",paid_at:"",evidence_reference:"",notes:""});
const statusLabel=(s:string)=>s==="matched"?"Conferido":s==="amount_difference"?"Diferença encontrada":s==="missing_guide_value"?"Aguardando guia":"Folha não fechada";

export default function StatutoryReconciliationPage(){
 const router=useRouter();const [org,setOrg]=useState("");const [rows,setRows]=useState<Row[]>([]);const [selected,setSelected]=useState("");const [drafts,setDrafts]=useState<Record<string,Draft>>({});const [loading,setLoading]=useState(true);const [saving,setSaving]=useState("");const [error,setError]=useState("");const [success,setSuccess]=useState("");
 const load=useCallback(async()=>{
  setLoading(true);setError("");const s=createClient();const {data:{user},error:auth}=await s.auth.getUser();if(auth||!user){router.replace("/");return;}
  const {data:m,error:me}=await s.from("organization_memberships").select("organization_id").eq("user_id",user.id).eq("status","active").limit(1).maybeSingle();
  if(me||!m){setError(me?.message||"Organização ativa não encontrada.");setLoading(false);return;}
  setOrg(m.organization_id);
  const {data,error:e}=await s.from("payroll_statutory_guide_reconciliation").select("*").eq("organization_id",m.organization_id).order("competence",{ascending:false}).order("obligation_key");
  if(e){setError(e.message);setRows([]);}else setRows((data||[]) as Row[]);
  setLoading(false);
 },[router]);
 useEffect(()=>{void load()},[load]);
 const runs=useMemo(()=>Array.from(new Map(rows.map(r=>[r.payroll_run_id,{id:r.payroll_run_id,competence:r.competence,status:r.payroll_run_status}])).values()),[rows]);
 useEffect(()=>{if(!selected&&runs.length)setSelected(runs[0].id);},[runs,selected]);
 const selectedRows=useMemo(()=>rows.filter(r=>r.payroll_run_id===selected),[rows,selected]);
 const update=(key:string,field:keyof Draft,value:string)=>setDrafts(current=>({...current,[key]:{...(current[key]||emptyDraft()),[field]:value}}));
 useEffect(()=>{const next:Record<string,Draft>={};for(const row of selectedRows)next[row.obligation_key]={guide_reference:row.guide_reference||"",assessed_amount:row.assessed_amount===null?"":String(row.assessed_amount),paid_amount:row.paid_amount===null?"":String(row.paid_amount),due_date:row.due_date||"",paid_at:row.paid_at||"",evidence_reference:row.evidence_reference||"",notes:row.notes||""};setDrafts(current=>({...current,...next}));},[selectedRows]);
 async function save(row:Row){
  const draft=drafts[row.obligation_key]||emptyDraft();const assessed=Number(draft.assessed_amount.replace(",","."));
  const paid=draft.paid_amount.trim()===""?null:Number(draft.paid_amount.replace(",","."));
  if(!draft.guide_reference.trim()||draft.assessed_amount.trim()===""||!Number.isFinite(assessed)||assessed<0){setError("Informe a identificação da guia e o valor apurado válido.");return;}
  if(paid!==null&&(!Number.isFinite(paid)||paid<0)){setError("O valor pago deve ser numérico e não negativo.");return;}
  if(draft.paid_at&&!draft.paid_amount.trim()){setError("Informe o valor pago antes da data do pagamento.");return;}
  setSaving(row.obligation_key);setError("");setSuccess("");
  try{const s=createClient();const {data:{user},error:auth}=await s.auth.getUser();if(auth||!user)throw auth||new Error("Sessão expirada.");
   const {error:e}=await s.from("payroll_statutory_guide_values").upsert({organization_id:org,payroll_run_id:selected,obligation_key:row.obligation_key,guide_reference:draft.guide_reference.trim(),assessed_amount:assessed,paid_amount:paid,due_date:draft.due_date||null,paid_at:draft.paid_at||null,evidence_reference:draft.evidence_reference.trim()||null,notes:draft.notes.trim()||null},{onConflict:"payroll_run_id,obligation_key"});
   if(e)throw e;setSuccess("Informações da guia registradas com trilha de auditoria.");await load();
  }catch(e){setError(e instanceof Error?e.message:"Não foi possível salvar a guia.");}finally{setSaving("");}
 }
 if(loading)return <div className="loading-screen">Carregando conciliação de obrigações...</div>;
 return <main className="module-shell"><header className="module-top"><a href="/dashboard/folha"><ArrowLeft size={16}/> Folha de pagamento</a><b><span className="brand-mark">ESC</span> Gestão de RH e DP</b><span>Conciliação geral</span></header><section className="module-content payroll-content">
  <div className="module-heading"><div><div className="form-kicker">DEPARTAMENTO PESSOAL · CONFERÊNCIA DE RECOLHIMENTOS</div><h1>Conciliação de obrigações</h1><p>Compare os valores lançados na folha com os valores informados nas guias, por competência.</p></div><div className="salary-history-icon"><ReceiptText size={24}/></div></div>
  <div className="dependent-privacy"><ShieldCheck size={17}/> Conferência somente leitura da folha. O sistema não transmite eSocial, DCTFWeb, FGTS Digital ou DARF, não gera guias e não confirma pagamentos sem informação e evidência registradas.</div>
  {error&&<div className="notice error">{error}</div>}{success&&<div className="notice success">{success}</div>}
  <div className="employee-list-card payroll-list"><div className="employee-list-head"><div><h2>Folha / competência</h2><p>Selecione uma folha fechada para conciliação.</p></div><button className="employee-secondary" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/> Atualizar</button></div>
   {!runs.length?<div className="employee-empty"><AlertTriangle size={22}/><b>Nenhuma folha encontrada</b><p>Gere e feche uma folha para visualizar os valores calculados.</p></div>:<label>Competência<select value={selected} onChange={e=>setSelected(e.target.value)}>{runs.map(r=><option key={r.id} value={r.id}>{new Date(r.competence+"T12:00:00").toLocaleDateString("pt-BR",{month:"long",year:"numeric"})} · {r.status==="closed"?"Fechada":"Em aberto"}</option>)}</select></label>}
  </div>
  {selectedRows.map(row=>{const draft=drafts[row.obligation_key]||emptyDraft();return <div className="employee-list-card payroll-list" key={row.obligation_key}>
   <div className="employee-list-head"><div><h2>{row.obligation_label}</h2><p>Valor registrado nos itens da folha: <b>{money(row.calculated_amount)}</b></p></div><span className={row.reconciliation_status==="matched"?"dependent-active":"dependent-inactive"}>{statusLabel(row.reconciliation_status)}</span></div>
   {row.payroll_run_status!=="closed"&&<div className="notice error"><AlertTriangle size={15}/> A folha precisa estar fechada para a conciliação ser considerada conferida.</div>}
   <div className="form-two"><label>Identificação da guia<input value={draft.guide_reference} onChange={e=>update(row.obligation_key,"guide_reference",e.target.value)} placeholder="Número, código ou identificador"/></label><label>Valor apurado na guia (R$)<input inputMode="decimal" value={draft.assessed_amount} onChange={e=>update(row.obligation_key,"assessed_amount",e.target.value)} placeholder="0,00"/></label></div>
   <div className="form-two"><label>Vencimento<input type="date" value={draft.due_date} onChange={e=>update(row.obligation_key,"due_date",e.target.value)}/></label><label>Referência documental<input value={draft.evidence_reference} onChange={e=>update(row.obligation_key,"evidence_reference",e.target.value)} placeholder="Arquivo, recibo ou referência"/></label></div>
   <div className="form-two"><label>Valor pago (R$)<input inputMode="decimal" value={draft.paid_amount} onChange={e=>update(row.obligation_key,"paid_amount",e.target.value)} placeholder="Deixe vazio se não confirmado"/></label><label>Data do pagamento<input type="date" value={draft.paid_at} onChange={e=>update(row.obligation_key,"paid_at",e.target.value)}/></label></div>
   <label>Observações<input value={draft.notes} onChange={e=>update(row.obligation_key,"notes",e.target.value)} placeholder="Compensações, diferenças ou justificativas"/></label>
   {row.guide_value_id&&<div className="dependent-privacy"><FileCheck2 size={15}/> Guia: {money(row.assessed_amount)} · Diferença: {money(row.difference_amount)} · Pagamento: {row.payment_status==="payment_recorded"?"Valor e data informados":row.payment_status==="paid_amount_informed"?"Valor informado, sem data":"Não confirmado"}</div>}
   <button className="employee-primary" disabled={saving!==""||row.payroll_run_status!=="closed"} onClick={()=>void save(row)}><Save size={15}/>{saving===row.obligation_key?"Salvando...":"Salvar conciliação"}</button>
  </div>;})}
  <div className="employee-list-card payroll-list"><div className="employee-list-head"><div><h2>Resumo da competência</h2><p>Diferença positiva indica guia acima do valor registrado na folha.</p></div></div><div className="table-scroll"><table className="employee-table"><thead><tr><th>Obrigação</th><th>Folha</th><th>Guia</th><th>Diferença</th><th>Conciliação</th><th>Pagamento</th></tr></thead><tbody>{selectedRows.map(r=><tr key={r.obligation_key}><td><b>{r.obligation_label}</b></td><td>{money(r.calculated_amount)}</td><td>{r.assessed_amount===null?"—":money(r.assessed_amount)}</td><td>{money(r.difference_amount)}</td><td>{statusLabel(r.reconciliation_status)}</td><td>{r.payment_status==="payment_recorded"?"Informado":r.payment_status==="paid_amount_informed"?"Valor informado":"Não confirmado"}</td></tr>)}</tbody></table></div></div>
 </section></main>;
}
