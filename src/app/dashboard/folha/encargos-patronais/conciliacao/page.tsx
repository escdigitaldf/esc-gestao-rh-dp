"use client";

import {useCallback,useEffect,useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import {ArrowLeft,RefreshCw,ShieldCheck,FileCheck2,Save,AlertTriangle,ReceiptText} from "lucide-react";
import {createClient} from "@/lib/supabase/client";

type Preview={id:string;competence:string;status:string;calculation_version:string;created_at:string;total_charges:number};
type Reconciliation={preview_id:string;contribution_key:string;contribution_label:string;calculated_amount:number;guide_value_id:string|null;guide_reference:string|null;assessed_amount:number|null;paid_amount:number|null;due_date:string|null;paid_at:string|null;evidence_reference:string|null;notes:string|null;reconciliation_status:string;payment_status:string;difference_amount:number|null};
type Draft={guide_reference:string;assessed_amount:string;paid_amount:string;due_date:string;paid_at:string;evidence_reference:string;notes:string};
const categories=[{key:"employer_inss",label:"INSS patronal"},{key:"rat",label:"RAT ajustado pelo FAP"},{key:"third_parties",label:"Terceiros"},{key:"payroll_pis",label:"PIS sobre folha"}] as const;
const emptyDraft=():Draft=>({guide_reference:"",assessed_amount:"",paid_amount:"",due_date:"",paid_at:"",evidence_reference:"",notes:""});
const money=(v:number|null|undefined)=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const statusLabel=(s:string)=>s==="matched"?"Conferido":s==="amount_difference"?"Diferença encontrada":s==="missing_guide_value"?"Aguardando valor da guia":"Prévia bloqueada";
export default function EmployerChargeReconciliationPage(){
 const router=useRouter();
 const [org,setOrg]=useState("");
 const [previews,setPreviews]=useState<Preview[]>([]);
 const [selected,setSelected]=useState("");
 const [rows,setRows]=useState<Reconciliation[]>([]);
 const [drafts,setDrafts]=useState<Record<string,Draft>>({});
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState("");
 const [error,setError]=useState("");
 const [success,setSuccess]=useState("");
 const load=useCallback(async()=>{
  setLoading(true);setError("");
  const s=createClient();
  const {data:{user},error:auth}=await s.auth.getUser();
  if(auth||!user){router.replace("/");return;}
  const {data:m,error:me}=await s.from("organization_memberships").select("organization_id").eq("user_id",user.id).eq("status","active").limit(1).maybeSingle();
  if(me||!m){setError(me?.message||"Organização ativa não encontrada.");setLoading(false);return;}
  setOrg(m.organization_id);
  const {data,error:e}=await s.from("payroll_employer_charge_previews").select("id,competence,status,calculation_version,created_at,total_charges").eq("organization_id",m.organization_id).order("created_at",{ascending:false}).limit(50);
  if(e)setError(e.message);
  const list=(data||[]) as Preview[];setPreviews(list);
  setSelected(current=>current||list[0]?.id||"");
  setLoading(false);
 },[router]);
 useEffect(()=>{void load()},[load]);
 useEffect(()=>{
  if(!org||!selected)return;
  let active=true;
  (async()=>{
   const s=createClient();
   const {data,error:e}=await s.from("payroll_employer_charge_reconciliation").select("*").eq("organization_id",org).eq("preview_id",selected).order("contribution_key");
   if(!active)return;
   if(e){setError(e.message);setRows([]);return;}
   const list=(data||[]) as Reconciliation[];setRows(list);
   const next:Record<string,Draft>={};
   for(const item of list)next[item.contribution_key]={
    guide_reference:item.guide_reference||"",
    assessed_amount:item.assessed_amount===null?"":String(item.assessed_amount),
    paid_amount:item.paid_amount===null?"":String(item.paid_amount),
    due_date:item.due_date||"",paid_at:item.paid_at||"",
    evidence_reference:item.evidence_reference||"",notes:item.notes||""
   };
   setDrafts(next);
  })();
  return()=>{active=false};
 },[org,selected]);
 const selectedPreview=useMemo(()=>previews.find(x=>x.id===selected)||null,[previews,selected]);
 const update=(key:string,field:keyof Draft,value:string)=>setDrafts(current=>({...current,[key]:{...(current[key]||emptyDraft()),[field]:value}}));
 async function save(key:string){
  const draft=drafts[key]||emptyDraft();
  const assessed=Number(draft.assessed_amount.replace(",","."));
  const paid=draft.paid_amount.trim()===""?null:Number(draft.paid_amount.replace(",","."));
  if(!selected||!draft.guide_reference.trim()||draft.assessed_amount.trim()===""||!Number.isFinite(assessed)||assessed<0){setError("Informe o identificador da guia e o valor apurado válido.");return;}
  if(paid!==null&&(!Number.isFinite(paid)||paid<0)){setError("O valor pago deve ser numérico e não negativo.");return;}
  if(draft.paid_at&&!draft.paid_amount.trim()){setError("Informe o valor pago antes de registrar a data de pagamento.");return;}
  setSaving(key);setError("");setSuccess("");
  try{
   const s=createClient();
   const {data:{user},error:auth}=await s.auth.getUser();if(auth||!user)throw auth||new Error("Sessão expirada.");
   const {error:e}=await s.from("payroll_employer_charge_guide_values").upsert({
    organization_id:org,preview_id:selected,contribution_key:key,guide_reference:draft.guide_reference.trim(),
    assessed_amount:assessed,paid_amount:paid,due_date:draft.due_date||null,paid_at:draft.paid_at||null,
    evidence_reference:draft.evidence_reference.trim()||null,notes:draft.notes.trim()||null,created_by:user.id,updated_by:user.id
   },{onConflict:"preview_id,contribution_key"});
   if(e)throw e;
   const {data,error:readError}=await s.from("payroll_employer_charge_reconciliation").select("*").eq("organization_id",org).eq("preview_id",selected).order("contribution_key");
   if(readError)throw readError;
   setRows((data||[]) as Reconciliation[]);setSuccess("Valor da guia registrado. A alteração ficou disponível no histórico de auditoria.");
  }catch(e){setError(e instanceof Error?e.message:"Não foi possível salvar a informação da guia.");}
  finally{setSaving("");}
 }
 if(loading)return <div className="loading-screen">Carregando conciliação de guias...</div>;
 return <main className="module-shell">
  <header className="module-top"><a href="/dashboard/folha/encargos-patronais"><ArrowLeft size={16}/> Encargos patronais</a><b><span className="brand-mark">ESC</span> Gestão de RH e DP</b><span>Conciliação de guias</span></header>
  <section className="module-content payroll-content">
   <div className="module-heading"><div><div className="form-kicker">DEPARTAMENTO PESSOAL · CONFERÊNCIA FISCAL</div><h1>Conciliação de encargos e guias</h1><p>Compare a prévia do sistema com os valores apurados nas guias oficiais, por competência e versão.</p></div><div className="salary-history-icon"><ReceiptText size={24}/></div></div>
   <div className="dependent-privacy"><ShieldCheck size={17}/> A conciliação é somente de conferência. O sistema não transmite declarações, não gera DARF/guia, não confirma pagamento automaticamente e não altera a folha.</div>
   {error&&<div className="notice error">{error}</div>}{success&&<div className="notice success">{success}</div>}
   <div className="employee-list-card payroll-list"><div className="employee-list-head"><div><h2>Selecionar prévia de cálculo</h2><p>Escolha a versão exata que será comparada com a guia.</p></div><button className="employee-secondary" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/> Atualizar</button></div>
    {!previews.length?<div className="employee-empty"><AlertTriangle size={22}/><b>Nenhuma prévia encontrada</b><p>Gere primeiro uma prévia dos encargos patronais. Prévia bloqueada não libera conciliação financeira.</p></div>:<><label>Prévia<select value={selected} onChange={e=>{setSelected(e.target.value);setSuccess("");setError("");}}>{previews.map(p=><option key={p.id} value={p.id}>{new Date(p.competence+"T12:00:00").toLocaleDateString("pt-BR",{month:"long",year:"numeric"})} · {p.status==="preview"?"Calculada":"Bloqueada"} · {new Date(p.created_at).toLocaleString("pt-BR")}</option>)}</select></label>
    {selectedPreview&&<div className="employee-stats-grid"><div className="employee-stat-card"><span>Status da prévia</span><b>{selectedPreview.status==="preview"?"Calculada":"Bloqueada"}</b></div><div className="employee-stat-card"><span>Versão</span><b>{selectedPreview.calculation_version||"—"}</b></div><div className="employee-stat-card"><span>Total calculado</span><b>{money(selectedPreview.total_charges)}</b></div></div>}</>}
   </div>
   {selectedPreview&&<>{selectedPreview.status!=="preview"&&<div className="notice error"><AlertTriangle size={16}/> Esta prévia está bloqueada. Valores informados poderão ser registrados como evidência, mas a conciliação não será marcada como conferida.</div>}
    {categories.map(category=>{
     const row=rows.find(x=>x.contribution_key===category.key);
     const draft=drafts[category.key]||emptyDraft();
     return <div className="employee-list-card payroll-list" key={category.key}>
      <div className="employee-list-head"><div><h2>{category.label}</h2><p>Valor calculado: <b>{money(row?.calculated_amount)}</b></p></div><span className={row?.reconciliation_status==="matched"?"dependent-active":"dependent-inactive"}>{statusLabel(row?.reconciliation_status||"missing_guide_value")}</span></div>
      <div className="form-two"><label>Identificação da guia<input value={draft.guide_reference} onChange={e=>update(category.key,"guide_reference",e.target.value)} placeholder="Número, código ou identificador"/></label><label>Valor apurado na guia (R$)<input inputMode="decimal" value={draft.assessed_amount} onChange={e=>update(category.key,"assessed_amount",e.target.value)} placeholder="0,00"/></label></div>
      <div className="form-two"><label>Vencimento<input type="date" value={draft.due_date} onChange={e=>update(category.key,"due_date",e.target.value)}/></label><label>Referência do documento / arquivo<input value={draft.evidence_reference} onChange={e=>update(category.key,"evidence_reference",e.target.value)} placeholder="Nome do arquivo ou referência documental"/></label></div>
      <div className="form-two"><label>Valor pago (R$)<input inputMode="decimal" value={draft.paid_amount} onChange={e=>update(category.key,"paid_amount",e.target.value)} placeholder="Deixe vazio se não confirmado"/></label><label>Data do pagamento<input type="date" value={draft.paid_at} onChange={e=>update(category.key,"paid_at",e.target.value)}/></label></div>
      <label>Observações<input value={draft.notes} onChange={e=>update(category.key,"notes",e.target.value)} placeholder="Diferenças, compensações ou justificativas"/></label>
      {row?.guide_value_id&&<div className="dependent-privacy"><FileCheck2 size={15}/> Informado na guia: {money(row.assessed_amount)} · Diferença (guia − prévia): {money(row.difference_amount)} · Pagamento: {row.payment_status==="payment_recorded"?"Data e valor informados":row.payment_status==="paid_amount_informed"?"Valor informado, sem data":"Não confirmado"}</div>}
      <button className="employee-primary" disabled={saving!==""||selectedPreview.status!=="preview"} onClick={()=>void save(category.key)}><Save size={15}/>{saving===category.key?"Salvando...":"Salvar conciliação"}</button>
     </div>;
    })}
    <div className="employee-list-card payroll-list"><div className="employee-list-head"><div><h2>Resumo comparativo</h2><p>Valores apurados na guia não são confundidos com valores pagos.</p></div></div><div className="table-scroll"><table className="employee-table"><thead><tr><th>Encargo</th><th>Prévia</th><th>Guia</th><th>Diferença</th><th>Conciliação</th><th>Pagamento</th></tr></thead><tbody>{rows.map(r=><tr key={r.contribution_key}><td><b>{r.contribution_label}</b></td><td>{money(r.calculated_amount)}</td><td>{r.assessed_amount===null?"—":money(r.assessed_amount)}</td><td>{money(r.difference_amount)}</td><td>{statusLabel(r.reconciliation_status)}</td><td>{r.payment_status==="payment_recorded"?"Informado":r.payment_status==="paid_amount_informed"?"Valor informado":"Não confirmado"}</td></tr>)}</tbody></table></div></div>
   </>}
  </section>
 </main>;
}
