"use client";

import {useCallback,useEffect,useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import {ArrowLeft,RefreshCw,ShieldCheck,AlertTriangle,GitCompareArrows} from "lucide-react";
import {createClient} from "@/lib/supabase/client";

type Row={preview_id:string;payroll_run_id:string;competence:string;preview_status:string;calculation_version:string;employee_id:string;employee_code:string;employee_name:string;cost_center:string;preview_employee_status:string;blocking_issue:string|null;preview_employer_inss:number;preview_rat:number;preview_third_parties:number;preview_payroll_pis:number;preview_total:number;processed_employer_charges_total:number;processed_amount_status:string;indicative_total_difference:number|null};
type Preview={id:string;competence:string;status:string;calculation_version:string;created_at:string};
const money=(v:number|null|undefined)=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const dateLabel=(v:string)=>new Date(v+"T12:00:00").toLocaleDateString("pt-BR",{month:"long",year:"numeric"});

export default function IntegratedEmployerChargeReconciliationPage(){
 const router=useRouter();
 const [org,setOrg]=useState("");
 const [previews,setPreviews]=useState<Preview[]>([]);
 const [selected,setSelected]=useState("");
 const [rows,setRows]=useState<Row[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const load=useCallback(async()=>{
  setLoading(true);setError("");
  const s=createClient();
  const {data:{user},error:auth}=await s.auth.getUser();
  if(auth||!user){router.replace("/");return;}
  const {data:m,error:me}=await s.from("organization_memberships").select("organization_id").eq("user_id",user.id).eq("status","active").limit(1).maybeSingle();
  if(me||!m){setError(me?.message||"Organização ativa não encontrada.");setLoading(false);return;}
  setOrg(m.organization_id);
  const {data,error:e}=await s.from("payroll_employer_charge_previews").select("id,competence,status,calculation_version,created_at").eq("organization_id",m.organization_id).order("created_at",{ascending:false}).limit(50);
  if(e){setError(e.message);setPreviews([]);setRows([]);}else{
   const list=(data||[]) as Preview[];setPreviews(list);
   setSelected(current=>list.some(p=>p.id===current)?current:(list[0]?.id||""));
  }
  setLoading(false);
 },[router]);
 useEffect(()=>{void load()},[load]);
 useEffect(()=>{
  if(!org||!selected){setRows([]);return;}
  let active=true;
  (async()=>{
   const s=createClient();
   const {data,error:e}=await s.from("payroll_employer_charge_employee_reconciliation").select("*").eq("organization_id",org).eq("preview_id",selected).order("cost_center").order("employee_code");
   if(!active)return;
   if(e){setError(e.message);setRows([]);}else setRows((data||[]) as Row[]);
  })();
  return()=>{active=false};
 },[org,selected]);
 const grouped=useMemo(()=>{
  const groups=new Map<string,{employees:number;preview:number;processed:number;withRecorded:number;blocked:number}>();
  for(const r of rows){
   const g=groups.get(r.cost_center)||{employees:0,preview:0,processed:0,withRecorded:0,blocked:0};
   g.employees++;g.preview+=Number(r.preview_total||0);g.processed+=Number(r.processed_employer_charges_total||0);
   if(r.processed_amount_status==="consolidated_only")g.withRecorded++;
   if(r.preview_employee_status!=="calculated")g.blocked++;
   groups.set(r.cost_center,g);
  }
  return [...groups.entries()].map(([costCenter,v])=>({costCenter,...v})).sort((a,b)=>a.costCenter.localeCompare(b.costCenter,"pt-BR"));
 },[rows]);
 const selectedPreview=previews.find(p=>p.id===selected);
 const previewTotal=rows.reduce((s,r)=>s+Number(r.preview_total||0),0);
 const processedTotal=rows.reduce((s,r)=>s+Number(r.processed_employer_charges_total||0),0);
 if(loading)return <div className="loading-screen">Carregando conciliação integrada...</div>;
 return <main className="module-shell">
  <header className="module-top"><a href="/dashboard/folha/encargos-patronais"><ArrowLeft size={16}/> Encargos patronais</a><b><span className="brand-mark">ESC</span> Gestão de RH e DP</b><span>Conciliação integrada</span></header>
  <section className="module-content payroll-content">
   <div className="module-heading"><div><div className="form-kicker">DEPARTAMENTO PESSOAL · AUDITORIA DE ENCARGOS</div><h1>Conciliação integrada</h1><p>Prévia patronal, valores gravados na folha e memória por colaborador e centro de custo.</p></div><div className="salary-history-icon"><GitCompareArrows size={24}/></div></div>
   <div className="dependent-privacy"><ShieldCheck size={17}/> A prévia é comparada ao total de encargos patronais efetivamente gravado em cada lançamento. Como o banco ainda não possui um mapeamento validado de código por contribuição, o valor processado é exibido somente de forma consolidada — nunca rateado artificialmente entre INSS patronal, RAT, terceiros e PIS.</div>
   {error&&<div className="notice error">{error}</div>}
   <div className="employee-list-card payroll-list">
    <div className="employee-list-head"><div><h2>Competência e versão</h2><p>Uma prévia por vez; versões diferentes não são somadas.</p></div><button className="employee-secondary" onClick={()=>void load()}><RefreshCw size={14}/> Atualizar</button></div>
    {!previews.length?<div className="employee-empty"><AlertTriangle size={22}/><b>Nenhuma prévia encontrada</b><p>Gere a prévia de encargos patronais para habilitar esta conciliação.</p></div>:<label>Prévia<select value={selected} onChange={e=>setSelected(e.target.value)}>{previews.map(p=><option key={p.id} value={p.id}>{dateLabel(p.competence)} · {p.status==="preview"?"Calculada":"Bloqueada"} · {new Date(p.created_at).toLocaleString("pt-BR")}</option>)}</select></label>}
    {selectedPreview&&<div className="employee-stats-grid"><div className="employee-stat-card"><span>Competência</span><b>{dateLabel(selectedPreview.competence)}</b></div><div className="employee-stat-card"><span>Versão</span><b>{selectedPreview.calculation_version}</b></div><div className="employee-stat-card"><span>Total da prévia</span><b>{money(previewTotal)}</b></div><div className="employee-stat-card"><span>Total gravado na folha</span><b>{money(processedTotal)}</b></div></div>}
   </div>
   {selectedPreview&&<>
    {selectedPreview.status!=="preview"&&<div className="notice error"><AlertTriangle size={16}/> Prévia bloqueada: não utilize os valores para fechamento ou recolhimento.</div>}
    <div className="employee-list-card payroll-list"><div className="employee-list-head"><div><h2>Resumo por centro de custo</h2><p>O total processado é o encargo patronal consolidado do lançamento individual.</p></div></div>
     <div className="table-scroll"><table className="employee-table"><thead><tr><th>Centro de custo</th><th>Colaboradores</th><th>Bloqueados</th><th>Prévia</th><th>Folha gravada</th><th>Diferença indicativa</th></tr></thead><tbody>{grouped.map(g=><tr key={g.costCenter}><td><b>{g.costCenter}</b></td><td>{g.employees}</td><td>{g.blocked}</td><td>{money(g.preview)}</td><td>{money(g.processed)}</td><td>{money(g.processed-g.preview)}</td></tr>)}</tbody><tfoot><tr><th>Total</th><th>{rows.length}</th><th>{rows.filter(r=>r.preview_employee_status!=="calculated").length}</th><th>{money(previewTotal)}</th><th>{money(processedTotal)}</th><th>{money(processedTotal-previewTotal)}</th></tr></tfoot></table></div>
    </div>
    <div className="employee-list-card payroll-list"><div className="employee-list-head"><div><h2>Conferência por colaborador</h2><p>Detalhamento da prévia e do total efetivamente registrado na folha.</p></div></div>
     <div className="table-scroll"><table className="employee-table"><thead><tr><th>Centro de custo</th><th>Colaborador</th><th>INSS patronal</th><th>RAT</th><th>Terceiros</th><th>PIS folha</th><th>Total prévia</th><th>Encargos gravados</th><th>Estado</th></tr></thead><tbody>{rows.map(r=><tr key={r.employee_id}><td>{r.cost_center}</td><td><b>{r.employee_name}</b><br/><small>{r.employee_code}</small></td><td>{money(r.preview_employer_inss)}</td><td>{money(r.preview_rat)}</td><td>{money(r.preview_third_parties)}</td><td>{money(r.preview_payroll_pis)}</td><td>{money(r.preview_total)}</td><td>{r.processed_amount_status==="audit_unavailable"?"Auditoria indisponível":money(r.processed_employer_charges_total)}</td><td><span className={r.preview_employee_status==="calculated"?"dependent-active":"dependent-inactive"}>{r.preview_employee_status==="calculated"?(r.processed_amount_status==="consolidated_only"?"Consolidado":"Sem item patronal gravado"):"Bloqueado"}</span>{r.blocking_issue&&<small>{r.blocking_issue}</small>}</td></tr>)}</tbody></table></div>
    </div>
    <div className="dependent-privacy"><AlertTriangle size={16}/> A diferença exibida é indicativa, não uma conciliação contábil definitiva: o valor da folha ainda não está discriminado por contribuição. A conciliação das guias por tipo permanece na tela <a href="/dashboard/folha/encargos-patronais/conciliacao">Conciliação de guias</a>. Não há confirmação automática de apuração ou pagamento.</div>
   </>}
  </section>
 </main>;
}
