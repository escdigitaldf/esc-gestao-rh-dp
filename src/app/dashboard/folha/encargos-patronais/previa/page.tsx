"use client";
import {useCallback,useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {ArrowLeft,Calculator,RefreshCw,ShieldCheck,AlertTriangle,FileText} from "lucide-react";
import {createClient} from "@/lib/supabase/client";

type Run={id:string;reference_month:string;status:string;employee_count:number};
type Preview={id:string;competence:string;status:"preview"|"blocked";total_employer_inss:number;total_rat:number;total_third_parties:number;total_payroll_pis:number;total_charges:number;blocked_count:number;snapshot:Array<Record<string,any>>;created_at:string};
const money=(v:number)=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
export default function EmployerChargePreviewPage(){
 const router=useRouter();
 const [org,setOrg]=useState("");
 const [runs,setRuns]=useState<Run[]>([]);
 const [selected,setSelected]=useState("");
 const [preview,setPreview]=useState<Preview|null>(null);
 const [loading,setLoading]=useState(true);
 const [calculating,setCalculating]=useState(false);
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
  const {data,error:e}=await s.from("payroll_runs").select("id,reference_month,status,employee_count").eq("organization_id",m.organization_id).order("reference_month",{ascending:false}).limit(30);
  if(e)setError(e.message);
  const list=(data||[]) as Run[];setRuns(list);if(!selected&&list[0])setSelected(list[0].id);
  setLoading(false);
 },[router,selected]);
 useEffect(()=>{void load()},[load]);
 async function calculate(){
  if(!selected)return;
  setCalculating(true);setError("");setSuccess("");setPreview(null);
  try{
   const s=createClient();
   const {data:id,error:rpcError}=await s.rpc("preview_payroll_employer_charges",{p_payroll_run_id:selected});
   if(rpcError)throw rpcError;
   const {data,error:e}=await s.from("payroll_employer_charge_previews").select("*").eq("id",id).eq("organization_id",org).single();
   if(e)throw e;
   setPreview(data as Preview);
   setSuccess(data.status==="blocked"?"Prévia registrada, mas o cálculo ficou bloqueado por pendências. Nenhum encargo foi liberado.":"Prévia calculada e armazenada para conferência. Nenhuma folha foi alterada.");
  }catch(e){setError(e instanceof Error?e.message:"Não foi possível gerar a prévia.");}
  finally{setCalculating(false);}
 }
 if(loading)return <div className="loading-screen">Carregando folhas para prévia...</div>;
 return <main className="module-shell">
  <header className="module-top"><a href="/dashboard/folha/encargos-patronais"><ArrowLeft size={16}/> Encargos patronais</a><b><span className="brand-mark">ESC</span> Gestão de RH e DP</b><span>Prévia de cálculo</span></header>
  <section className="module-content payroll-content">
   <div className="module-heading"><div><div className="form-kicker">DEPARTAMENTO PESSOAL · MOTOR DE CÁLCULO</div><h1>Prévia dos encargos patronais</h1><p>Simulação por colaborador com base nas rubricas, lotação tributária e parâmetros validados.</p></div><div className="salary-history-icon"><Calculator size={24}/></div></div>
   <div className="dependent-privacy"><ShieldCheck size={17}/> Esta operação gera somente uma memória de cálculo versionada. Não altera valores da folha, não fecha competência e não gera guias ou recolhimentos.</div>
   {error&&<div className="notice error">{error}</div>}{success&&<div className="notice success">{success}</div>}
   <div className="employee-list-card payroll-list"><div className="employee-list-head"><div><h2>Selecionar folha</h2><p>Escolha uma competência com lançamentos cadastrados.</p></div><button className="employee-secondary" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/> Atualizar</button></div>
    {!runs.length?<div className="employee-empty"><FileText size={22}/><b>Nenhuma folha cadastrada</b><p>Cadastre uma folha e seus lançamentos para habilitar a prévia.</p></div>:<><label>Competência<select value={selected} onChange={e=>{setSelected(e.target.value);setPreview(null);setSuccess("");}}>{runs.map(r=><option key={r.id} value={r.id}>{new Date(r.reference_month+"T12:00:00").toLocaleDateString("pt-BR",{month:"long",year:"numeric"})} · {r.employee_count} colaboradores · {r.status}</option>)}</select></label><button className="employee-primary" onClick={()=>void calculate()} disabled={calculating||!selected}><Calculator size={15}/>{calculating?"Calculando...":"Gerar prévia dos encargos"}</button></>}
   </div>
   {preview&&<><div className="employee-list-card payroll-list"><div className="employee-list-head"><div><h2>Resultado da prévia</h2><p>Competência {new Date(preview.competence+"T12:00:00").toLocaleDateString("pt-BR",{month:"long",year:"numeric"})} · Versão 2026.11.19.1</p></div><span className={preview.status==="preview"?"dependent-active":"dependent-inactive"}>{preview.status==="preview"?"Prévia calculada":"Bloqueada"}</span></div>
    {preview.status==="blocked"&&<div className="notice error"><AlertTriangle size={16}/> {preview.blocked_count} colaborador(es) com pendências. Os totais foram zerados para impedir liberação parcial.</div>}
    <div className="employee-stats-grid"><div className="employee-stat-card"><span>INSS patronal</span><b>{money(preview.total_employer_inss)}</b></div><div className="employee-stat-card"><span>RAT ajustado</span><b>{money(preview.total_rat)}</b></div><div className="employee-stat-card"><span>Terceiros</span><b>{money(preview.total_third_parties)}</b></div><div className="employee-stat-card"><span>PIS sobre folha</span><b>{money(preview.total_payroll_pis)}</b></div></div>
    <div className="employee-stat-card"><span>Total de encargos da prévia</span><b>{money(preview.total_charges)}</b></div>
   </div>
   <div className="employee-list-card payroll-list"><div className="employee-list-head"><div><h2>Memória por colaborador</h2><p>Bases, alíquotas aplicadas e motivo de bloqueio, quando houver.</p></div></div><div className="table-scroll"><table className="employee-table"><thead><tr><th>Colaborador</th><th>Lotação</th><th>Base CPP</th><th>CPP</th><th>Base RAT</th><th>RAT × FAP</th><th>Valor RAT</th><th>Terceiros</th><th>Situação</th></tr></thead><tbody>{preview.snapshot.map((x,i)=><tr key={x.payroll_entry_id||i}><td><b>{x.employee_name}</b><br/><small>{x.employee_code}</small></td><td>{x.lotation_code||"—"}<br/><small>{x.tax_regime||"Sem enquadramento"}</small></td><td>{money(x.bases?.employer_inss)}</td><td>{money(x.amounts?.employer_inss)}</td><td>{money(x.bases?.rat)}</td><td>{Number(x.rates?.rat_adjusted||0).toLocaleString("pt-BR",{maximumFractionDigits:5})}%</td><td>{money(x.amounts?.rat)}</td><td>{money(x.amounts?.third_parties)}</td><td><span className={x.status==="calculated"?"dependent-active":"dependent-inactive"}>{x.status==="calculated"?"Calculado":"Bloqueado"}</span>{x.issue&&<small>{x.issue}</small>}</td></tr>)}</tbody></table></div></div>
   </>}
  </section>
 </main>;
}
