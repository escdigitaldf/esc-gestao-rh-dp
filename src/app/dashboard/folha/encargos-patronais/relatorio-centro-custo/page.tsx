"use client";

import {useCallback,useEffect,useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import {ArrowLeft,RefreshCw,FileBarChart2,ShieldCheck,AlertTriangle} from "lucide-react";
import {createClient} from "@/lib/supabase/client";

type Preview={id:string;competence:string;status:string;created_at:string;calculation_version:string};
type Detail={preview_id:string;cost_center:string;employee_id:string;employee_code:string;employee_name:string;lotation_code:string|null;fpas_code:string|null;contribution_key:string;contribution_label:string;calculation_base:number;applied_rate:number;rubric_code:string;rubric_description:string;rubric_amount:number;rubric_calculated_amount:number;employee_calculation_status:string;blocking_issue:string|null;normative_sources:Record<string,string|null>|null;fap_factor:number|null};
const money=(v:number)=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const percent=(v:number)=>Number(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:5})+"%";
export default function EmployerChargeCostCenterReport(){
 const router=useRouter();
 const [org,setOrg]=useState("");
 const [previews,setPreviews]=useState<Preview[]>([]);
 const [selected,setSelected]=useState("");
 const [details,setDetails]=useState<Detail[]>([]);
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
  const {data,error:e}=await s.from("payroll_employer_charge_previews").select("id,competence,status,created_at,calculation_version").eq("organization_id",m.organization_id).order("created_at",{ascending:false}).limit(50);
  if(e)setError(e.message);
  const list=(data||[]) as Preview[];setPreviews(list);setSelected(current=>current||list[0]?.id||"");
  setLoading(false);
 },[router]);
 useEffect(()=>{void load()},[load]);
 useEffect(()=>{
  if(!org||!selected)return;
  let active=true;
  (async()=>{
   const s=createClient();
   const {data,error:e}=await s.from("payroll_employer_charge_preview_rubric_details").select("*").eq("organization_id",org).eq("preview_id",selected).order("cost_center").order("employee_code").order("rubric_code").order("contribution_key");
   if(!active)return;
   if(e){setError(e.message);setDetails([]);return;}
   setDetails((data||[]) as Detail[]);
  })();
  return()=>{active=false};
 },[org,selected]);
 const selectedPreview=previews.find(p=>p.id===selected);
 const totals=useMemo(()=>{
  const result=new Map<string,{employees:Set<string>;amount:number;blocked:Set<string>}>();
  for(const row of details){
   const key=row.cost_center||"Não informado";
   const current=result.get(key)||{employees:new Set<string>(),amount:0,blocked:new Set<string>()};
   current.employees.add(row.employee_id);
   current.amount+=Number(row.calculated_amount||0);
   if(row.employee_calculation_status!=="calculated")current.blocked.add(row.employee_id);
   result.set(key,current);
  }
  return [...result.entries()].map(([costCenter,value])=>({costCenter,employees:value.employees.size,amount:value.amount,blocked:value.blocked.size})).sort((a,b)=>a.costCenter.localeCompare(b.costCenter,"pt-BR"));
 },[details]);
 const total=details.reduce((sum,row)=>sum+Number(row.calculated_amount||0),0);
 if(loading)return <div className="loading-screen">Carregando relatório por centro de custo...</div>;
 return <main className="module-shell">
  <header className="module-top"><a href="/dashboard/folha/encargos-patronais"><ArrowLeft size={16}/> Encargos patronais</a><b><span className="brand-mark">ESC</span> Gestão de RH e DP</b><span>Relatório por centro de custo</span></header>
  <section className="module-content payroll-content">
   <div className="module-heading"><div><div className="form-kicker">DEPARTAMENTO PESSOAL · RELATÓRIO GERENCIAL</div><h1>Encargos por centro de custo</h1><p>Memória detalhada por colaborador, lotação tributária e tipo de encargo, preservada na versão da prévia.</p></div><div className="salary-history-icon"><FileBarChart2 size={24}/></div></div>
   <div className="dependent-privacy"><ShieldCheck size={17}/> Os valores são uma memória de cálculo da prévia, não representam guias emitidas nem valores recolhidos. Centro de custo sem cadastro aparece como “Não informado”.</div>
   {error&&<div className="notice error">{error}</div>}
   <div className="employee-list-card payroll-list">
    <div className="employee-list-head"><div><h2>Competência e versão</h2><p>Selecione uma prévia específica para evitar misturar versões.</p></div><button className="employee-secondary" onClick={()=>void load()}><RefreshCw size={14}/> Atualizar</button></div>
    {!previews.length?<div className="employee-empty"><AlertTriangle size={22}/><b>Nenhuma prévia encontrada</b><p>Gere uma prévia de encargos patronais para habilitar o relatório.</p></div>:<label>Prévia<select value={selected} onChange={e=>setSelected(e.target.value)}>{previews.map(p=><option key={p.id} value={p.id}>{new Date(p.competence+"T12:00:00").toLocaleDateString("pt-BR",{month:"long",year:"numeric"})} · {p.status==="preview"?"Calculada":"Bloqueada"} · {new Date(p.created_at).toLocaleString("pt-BR")}</option>)}</select></label>}
    {selectedPreview&&<div className="employee-stats-grid"><div className="employee-stat-card"><span>Competência</span><b>{new Date(selectedPreview.competence+"T12:00:00").toLocaleDateString("pt-BR",{month:"long",year:"numeric"})}</b></div><div className="employee-stat-card"><span>Status</span><b>{selectedPreview.status==="preview"?"Calculada":"Bloqueada"}</b></div><div className="employee-stat-card"><span>Versão</span><b>{selectedPreview.calculation_version}</b></div><div className="employee-stat-card"><span>Total detalhado</span><b>{money(total)}</b></div></div>}
   </div>
   {selectedPreview&&<>
    {selectedPreview.status!=="preview"&&<div className="notice error"><AlertTriangle size={16}/> Prévia bloqueada. Valores detalhados podem ser zero ou parciais por colaborador e não devem ser usados para recolhimento.</div>}
    <div className="employee-list-card payroll-list"><div className="employee-list-head"><div><h2>Resumo por centro de custo</h2><p>Quantidade de colaboradores, valores e pendências de enquadramento.</p></div></div>
     <div className="table-scroll"><table className="employee-table"><thead><tr><th>Centro de custo</th><th>Colaboradores</th><th>Com bloqueio</th><th>Total da prévia</th></tr></thead><tbody>{totals.map(row=><tr key={row.costCenter}><td><b>{row.costCenter}</b></td><td>{row.employees}</td><td>{row.blocked}</td><td>{money(row.amount)}</td></tr>)}{!totals.length&&<tr><td colSpan={4}>Nenhum detalhe encontrado nesta prévia.</td></tr>}</tbody><tfoot><tr><th>Total</th><th>{new Set(details.map(r=>r.employee_id)).size}</th><th>{new Set(details.filter(r=>r.employee_calculation_status!=="calculated").map(r=>r.employee_id)).size}</th><th>{money(total)}</th></tr></tfoot></table></div>
    </div>
    <div className="employee-list-card payroll-list"><div className="employee-list-head"><div><h2>Memória por colaborador e encargo</h2><p>Base de cálculo, alíquota efetiva e valor calculado conforme o snapshot da prévia.</p></div></div>
     <div className="table-scroll"><table className="employee-table"><thead><tr><th>Centro de custo</th><th>Colaborador</th><th>Rubrica</th><th>Lotação / FPAS</th><th>Encargo</th><th>Base da rubrica</th><th>Alíquota</th><th>Valor da rubrica</th><th>Fundamento / FAP</th><th>Status</th></tr></thead><tbody>{details.map((r,i)=><tr key={r.employee_id+"-"+r.contribution_key+"-"+i}><td>{r.cost_center||"Não informado"}</td><td><b>{r.employee_name}</b><br/><small>{r.employee_code}</small></td><td><b>{r.rubric_code}</b><br/><small>{r.rubric_description}</small></td><td>{r.lotation_code||"—"} / {r.fpas_code||"—"}</td><td>{r.contribution_label}</td><td>{money(Number(r.calculation_base))}</td><td>{percent(Number(r.applied_rate))}</td><td>{money(Number(r.rubric_calculated_amount))}</td><td><small>FAP: {r.fap_factor??"—"}<br/>INSS: {r.normative_sources?.employer_inss||"—"}<br/>RAT: {r.normative_sources?.rat_cnae||"—"}<br/>FAP: {r.normative_sources?.fap||"—"}<br/>Terceiros: {r.normative_sources?.third_parties||"—"}</small></td><td><span className={r.employee_calculation_status==="calculated"?"dependent-active":"dependent-inactive"}>{r.employee_calculation_status==="calculated"?"Calculado":"Bloqueado"}</span>{r.blocking_issue&&<small>{r.blocking_issue}</small>}</td></tr>)}</tbody></table></div>
    </div>
   </>}
  </section>
 </main>;
}
