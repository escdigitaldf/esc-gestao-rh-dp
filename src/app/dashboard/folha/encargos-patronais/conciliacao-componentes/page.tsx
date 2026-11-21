"use client";

import {useCallback,useEffect,useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import {ArrowLeft,RefreshCw,ShieldCheck,AlertTriangle,GitCompareArrows} from "lucide-react";
import {createClient} from "@/lib/supabase/client";

type Preview={id:string;competence:string;status:string;calculation_version:string;created_at:string};
type Row={preview_id:string;payroll_run_id:string;competence:string;preview_status:string;employee_id:string;employee_code:string;employee_name:string;cost_center:string;contribution_key:string;contribution_label:string;preview_amount:number|null;processed_amount:number;unclassified_amount:number;reconciliation_status:string;difference_amount:number|null};
const money=(v:number|null|undefined)=>v===null||v===undefined?"—":Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const statusLabel=(s:string)=>({matched:"Conferido",amount_difference:"Diferença encontrada",mapping_pending:"Classificação pendente",fgts_processed_only:"FGTS lançado (sem prévia)",preview_blocked:"Prévia bloqueada"} as Record<string,string>)[s]||s;
export default function EmployerChargeComponentReconciliationPage(){
 const router=useRouter();const [org,setOrg]=useState("");const [previews,setPreviews]=useState<Preview[]>([]);const [selected,setSelected]=useState("");const [rows,setRows]=useState<Row[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState("");
 const load=useCallback(async()=>{
  setLoading(true);setError("");const s=createClient();const {data:{user},error:auth}=await s.auth.getUser();if(auth||!user){router.replace("/");return;}
  const {data:m,error:me}=await s.from("organization_memberships").select("organization_id").eq("user_id",user.id).eq("status","active").limit(1).maybeSingle();
  if(me||!m){setError(me?.message||"Organização ativa não encontrada.");setLoading(false);return;}setOrg(m.organization_id);
  const {data,error:e}=await s.from("payroll_employer_charge_previews").select("id,competence,status,calculation_version,created_at").eq("organization_id",m.organization_id).order("created_at",{ascending:false}).limit(50);
  if(e){setError(e.message);setPreviews([]);}else{const list=(data||[]) as Preview[];setPreviews(list);setSelected(current=>list.some(x=>x.id===current)?current:(list[0]?.id||""));}
  setLoading(false);
 },[router]);
 useEffect(()=>{void load()},[load]);
 useEffect(()=>{if(!org||!selected){setRows([]);return;}let active=true;(async()=>{const s=createClient();const {data,error:e}=await s.from("payroll_employer_charge_component_reconciliation").select("*").eq("organization_id",org).eq("preview_id",selected).order("cost_center").order("employee_code").order("contribution_key");if(!active)return;if(e){setError(e.message);setRows([]);}else setRows((data||[]) as Row[]);})();return()=>{active=false};},[org,selected]);
 const grouped=useMemo(()=>{const map=new Map<string,{preview:number;processed:number;unclassified:number;count:number;issues:number}>();for(const r of rows){const k=r.contribution_label;const v=map.get(k)||{preview:0,processed:0,unclassified:0,count:0,issues:0};v.preview+=Number(r.preview_amount||0);v.processed+=Number(r.processed_amount||0);v.unclassified+=Number(r.unclassified_amount||0);v.count++;if(!["matched","fgts_processed_only"].includes(r.reconciliation_status))v.issues++;map.set(k,v);}return [...map.entries()].map(([label,v])=>({label,...v}));},[rows]);
 const selectedPreview=previews.find(p=>p.id===selected);
 if(loading)return <div className="loading-screen">Carregando conciliação por contribuição...</div>;
 return <main className="module-shell"><header className="module-top"><a href="/dashboard/folha/encargos-patronais"><ArrowLeft size={16}/> Encargos patronais</a><b><span className="brand-mark">ESC</span> Gestão de RH e DP</b><span>Conciliação por contribuição</span></header>
  <section className="module-content payroll-content">
   <div className="module-heading"><div><div className="form-kicker">DEPARTAMENTO PESSOAL · CONCILIAÇÃO ANALÍTICA</div><h1>Conciliação por contribuição</h1><p>Compara a prévia patronal com os itens individualizados na folha e destaca classificações ainda não validadas.</p></div><div className="salary-history-icon"><GitCompareArrows size={24}/></div></div>
   <div className="dependent-privacy"><ShieldCheck size={17}/> INSS patronal, RAT, terceiros e PIS só recebem valores processados quando o parâmetro de origem possui classificação validada por segundo responsável. FGTS aparece separado como valor processado, sem comparação com a prévia patronal.</div>
   {error&&<div className="notice error">{error}</div>}
   <div className="employee-list-card payroll-list"><div className="employee-list-head"><div><h2>Prévia e competência</h2><p>Selecione uma versão específica.</p></div><button className="employee-secondary" onClick={()=>void load()}><RefreshCw size={14}/> Atualizar</button></div>
    {!previews.length?<div className="employee-empty"><AlertTriangle size={22}/><b>Nenhuma prévia encontrada</b><p>Gere uma prévia patronal para consultar a conciliação.</p></div>:<label>Prévia<select value={selected} onChange={e=>setSelected(e.target.value)}>{previews.map(p=><option key={p.id} value={p.id}>{new Date(p.competence+"T12:00:00").toLocaleDateString("pt-BR",{month:"long",year:"numeric"})} · {p.status==="preview"?"Calculada":"Bloqueada"} · {new Date(p.created_at).toLocaleString("pt-BR")}</option>)}</select></label>}
    {selectedPreview&&<div className="employee-stats-grid"><div className="employee-stat-card"><span>Competência</span><b>{new Date(selectedPreview.competence+"T12:00:00").toLocaleDateString("pt-BR",{month:"long",year:"numeric"})}</b></div><div className="employee-stat-card"><span>Versão</span><b>{selectedPreview.calculation_version}</b></div><div className="employee-stat-card"><span>Colaboradores</span><b>{new Set(rows.map(x=>x.employee_id)).size}</b></div><div className="employee-stat-card"><span>Pendências</span><b>{rows.filter(x=>x.reconciliation_status==="mapping_pending").length}</b></div></div>}
   </div>
   {selectedPreview&&<>
    <div className="employee-list-card payroll-list"><div className="employee-list-head"><div><h2>Resumo por contribuição</h2><p>Valores consolidados sem rateio de parâmetros não classificados.</p></div></div><div className="table-scroll"><table className="employee-table"><thead><tr><th>Contribuição</th><th>Prévia</th><th>Folha classificada</th><th>Não classificado</th><th>Diferença</th><th>Pendências</th></tr></thead><tbody>{grouped.map(g=><tr key={g.label}><td><b>{g.label}</b></td><td>{g.label==="FGTS"?"—":money(g.preview)}</td><td>{money(g.processed)}</td><td>{money(g.unclassified)}</td><td>{g.label==="FGTS"?"—":money(g.processed-g.preview)}</td><td>{g.issues}</td></tr>)}</tbody></table></div></div>
    <div className="employee-list-card payroll-list"><div className="employee-list-head"><div><h2>Detalhamento por colaborador</h2><p>Centro de custo, contribuição, valor da prévia e valor processado.</p></div></div><div className="table-scroll"><table className="employee-table"><thead><tr><th>Centro de custo</th><th>Colaborador</th><th>Contribuição</th><th>Prévia</th><th>Folha</th><th>Não classificado</th><th>Diferença</th><th>Status</th></tr></thead><tbody>{rows.map((r,i)=><tr key={r.employee_id+"-"+r.contribution_key+"-"+i}><td>{r.cost_center}</td><td><b>{r.employee_name}</b><br/><small>{r.employee_code}</small></td><td>{r.contribution_label}</td><td>{money(r.preview_amount)}</td><td>{money(r.processed_amount)}</td><td>{money(r.unclassified_amount)}</td><td>{money(r.difference_amount)}</td><td><span className={r.reconciliation_status==="matched"?"dependent-active":"dependent-inactive"}>{statusLabel(r.reconciliation_status)}</span></td></tr>)}</tbody></table></div></div>
    <div className="dependent-privacy"><AlertTriangle size={16}/> Valores sem classificação documental não são atribuídos a nenhuma contribuição. Revise-os em <a href="/dashboard/folha/encargos-patronais/classificacao-rubricas">Classificação de rubricas</a>. A tela não gera guias nem confirma recolhimentos.</div>
   </>}
  </section>
 </main>;
}
