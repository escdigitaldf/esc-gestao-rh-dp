"use client";
import {useCallback,useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {ArrowLeft,Plus,RefreshCw,ShieldCheck,Users,ReceiptText,Calculator} from "lucide-react";
import {createClient} from "@/lib/supabase/client";
type Employee={id:string;employee_code:string;full_name:string};
type Classification={id:string;employee_id:string;activity_classification:string;validity_from:string;validity_to:string|null;status:string;source_reference:string};
type Revenue={id:string;competence:string;total_gross_revenue:number;annex_iv_gross_revenue:number;status:string;source_reference:string};
const money=(v:number)=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const today=new Date().toISOString().slice(0,10);
export default function ConcomitantActivitiesPage(){
 const router=useRouter();
 const [org,setOrg]=useState("");const [employees,setEmployees]=useState<Employee[]>([]);
 const [classifications,setClassifications]=useState<Classification[]>([]);const [revenues,setRevenues]=useState<Revenue[]>([]);
 const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false);const [error,setError]=useState("");const [success,setSuccess]=useState("");
 const [employeeId,setEmployeeId]=useState("");const [kind,setKind]=useState("concomitant_annex_iv");const [from,setFrom]=useState(today);const [to,setTo]=useState("");const [source,setSource]=useState("");
 const [competence,setCompetence]=useState(new Date().toISOString().slice(0,7));const [total,setTotal]=useState("");const [annexIV,setAnnexIV]=useState("");const [revenueSource,setRevenueSource]=useState("");const [revenueUrl,setRevenueUrl]=useState("");
 const load=useCallback(async()=>{
  setLoading(true);setError("");const s=createClient();const {data:{user},error:auth}=await s.auth.getUser();
  if(auth||!user){router.replace("/");return;}
  const {data:m,error:me}=await s.from("organization_memberships").select("organization_id").eq("user_id",user.id).eq("status","active").limit(1).maybeSingle();
  if(me||!m){setError(me?.message||"Organização ativa não encontrada.");setLoading(false);return;}
  setOrg(m.organization_id);
  const [e,c,r]=await Promise.all([
   s.from("employees").select("id,employee_code,full_name").eq("organization_id",m.organization_id).eq("employment_status","active").order("full_name"),
   s.from("employee_payroll_activity_classifications").select("*").eq("organization_id",m.organization_id).order("validity_from",{ascending:false}),
   s.from("organization_payroll_activity_revenue").select("*").eq("organization_id",m.organization_id).order("competence",{ascending:false}).limit(24)
  ]);
  if(e.error||c.error||r.error)setError(e.error?.message||c.error?.message||r.error?.message||"Falha ao carregar dados.");
  setEmployees((e.data||[]) as Employee[]);setClassifications((c.data||[]) as Classification[]);setRevenues((r.data||[]) as Revenue[]);setLoading(false);
 },[router]);
 useEffect(()=>{void load()},[load]);
 async function saveClassification(ev:React.FormEvent){
  ev.preventDefault();setError("");setSuccess("");
  if(!employeeId||!source.trim()){setError("Selecione o colaborador e informe o fundamento documental.");return;}
  setSaving(true);
  try{const s=createClient();const {data:{user}}=await s.auth.getUser();const {error:e}=await s.from("employee_payroll_activity_classifications").insert({organization_id:org,employee_id:employeeId,activity_classification:kind,validity_from:from,validity_to:to||null,source_reference:source.trim(),status:"pending",created_by:user?.id||null});
   if(e)throw e;setSuccess("Classificação registrada como pendente. Valide após conferir a atividade efetivamente exercida.");setSource("");await load();
  }catch(e){setError(e instanceof Error?e.message:"Não foi possível salvar a classificação.");}finally{setSaving(false);}
 }
 async function validateClassification(row:Classification){
  if(row.status!=="pending"||!confirm("Confirmar que a classificação reflete as atividades efetivamente exercidas pelo colaborador no período?"))return;
  setSaving(true);setError("");try{const s=createClient();const {error:e}=await s.from("employee_payroll_activity_classifications").update({status:"validated"}).eq("id",row.id).eq("organization_id",org);if(e)throw e;setSuccess("Classificação validada.");await load();}catch(e){setError(e instanceof Error?e.message:"Falha ao validar classificação.");}finally{setSaving(false);}
 }
 async function saveRevenue(ev:React.FormEvent){
  ev.preventDefault();setError("");setSuccess("");
  const all=Number(total),iv=Number(annexIV);
  if(!revenueSource.trim()||!total||annexIV===""||!Number.isFinite(all)||!Number.isFinite(iv)||all<0||iv<0||iv>all){setError("Informe valores válidos; a receita do Anexo IV não pode superar a receita total.");return;}
  setSaving(true);
  try{const s=createClient();const {data:{user}}=await s.auth.getUser();const {error:e}=await s.from("organization_payroll_activity_revenue").insert({organization_id:org,competence:competence+"-01",total_gross_revenue:all,annex_iv_gross_revenue:iv,source_reference:revenueSource.trim(),source_url:revenueUrl.trim()||null,status:"pending",created_by:user?.id||null});if(e)throw e;setSuccess("Receita mensal registrada como pendente.");setTotal("");setAnnexIV("");setRevenueSource("");setRevenueUrl("");await load();
  }catch(e){setError(e instanceof Error?e.message:"Não foi possível salvar a receita.");}finally{setSaving(false);}
 }
 async function validateRevenue(row:Revenue){
  if(row.status!=="pending"||!confirm("Confirmar os valores de receita total e receita do Anexo IV com base na apuração fiscal da competência?"))return;
  setSaving(true);setError("");try{const s=createClient();const {error:e}=await s.from("organization_payroll_activity_revenue").update({status:"validated"}).eq("id",row.id).eq("organization_id",org);if(e)throw e;setSuccess("Receita mensal validada.");await load();}catch(e){setError(e instanceof Error?e.message:"Falha ao validar receita.");}finally{setSaving(false);}
 }
 if(loading)return <div className="loading-screen">Carregando atividades concomitantes...</div>;
 return <main className="module-shell"><header className="module-top"><a href="/dashboard/folha"><ArrowLeft size={16}/> Folha de pagamento</a><b><span className="brand-mark">ESC</span> Gestão de RH e DP</b><span>Atividades concomitantes</span></header><section className="module-content payroll-content">
  <div className="module-heading"><div><div className="form-kicker">DEPARTAMENTO PESSOAL · SIMPLES NACIONAL</div><h1>Atividades do Anexo IV</h1><p>Classificação individual do colaborador e segregação mensal da receita para apurar o fator de proporcionalidade.</p></div><div className="salary-history-icon"><Calculator size={24}/></div></div>
  {error&&<div className="notice error">{error}</div>}{success&&<div className="notice success">{success}</div>}
  <div className="dependent-privacy"><ShieldCheck size={17}/><span>Fundamento: IN RFB nº 2.110/2022, arts. 170 e 171, e Solução de Consulta Cosit nº 169/2024. Para empregado concomitante, o fator mensal é receita do Anexo IV dividida pela receita bruta total. Para empregado exclusivo do Anexo IV, a CPP permanece integral, mesmo sem receita do Anexo IV no mês. A classificação exige validação documental.</span></div>
  <div className="payroll-create"><div><div className="form-kicker">1 · CLASSIFICAÇÃO DO COLABORADOR</div><h2>Atividade efetivamente exercida</h2><p>Informe se o empregado atua exclusivamente no Anexo IV, concomitantemente com outros anexos ou exclusivamente em outros anexos.</p></div>
   <form onSubmit={saveClassification}>
    <label>Colaborador<select required value={employeeId} onChange={e=>setEmployeeId(e.target.value)}><option value="">Selecione</option>{employees.map(e=><option key={e.id} value={e.id}>{e.employee_code} · {e.full_name}</option>)}</select></label>
    <label>Classificação da atividade<select value={kind} onChange={e=>setKind(e.target.value)}><option value="exclusive_annex_iv">Exclusivamente Anexo IV</option><option value="concomitant_annex_iv">Concomitante: Anexo IV + outros anexos</option><option value="exclusive_other_annex">Exclusivamente outros anexos (I, II, III ou V)</option></select></label>
    <div className="form-two"><label>Início da vigência<input type="date" required value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Fim da vigência<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div>
    <label>Documento / fundamento<input required value={source} onChange={e=>setSource(e.target.value)} placeholder="Descrição de função, contrato, ordem de serviço, relatório de atividades..."/></label>
    <button className="employee-primary" disabled={saving||!employees.length}><Plus size={15}/> Registrar classificação pendente</button>
   </form>
  </div>
  <div className="employee-list-card payroll-list"><div className="employee-list-head"><div><h2>Classificações cadastradas</h2><p>Vigências validadas são imutáveis; mudanças exigem nova versão.</p></div><button className="employee-secondary" onClick={()=>void load()} disabled={saving}><RefreshCw size={14}/> Atualizar</button></div>
   {!classifications.length?<div className="employee-empty"><Users size={22}/><b>Nenhuma classificação registrada</b><p>Cadastre a atividade efetiva de cada colaborador lotado no Anexo IV.</p></div>:<div className="table-scroll"><table className="employee-table"><thead><tr><th>Colaborador</th><th>Classificação</th><th>Vigência</th><th>Status</th><th></th></tr></thead><tbody>{classifications.map(c=>{const e=employees.find(x=>x.id===c.employee_id);const label=c.activity_classification==="exclusive_annex_iv"?"Exclusivo Anexo IV":c.activity_classification==="concomitant_annex_iv"?"Concomitante":"Exclusivo outros anexos";return <tr key={c.id}><td>{e?.employee_code||"—"} · {e?.full_name||"Colaborador"}</td><td>{label}</td><td>{c.validity_from}{c.validity_to?" a "+c.validity_to:" em aberto"}</td><td>{c.status==="validated"?"Validado":"Pendente"}</td><td>{c.status==="pending"&&<button className="employee-secondary" disabled={saving} onClick={()=>void validateClassification(c)}>Validar</button>}</td></tr>})}</tbody></table></div>}
  </div>
  <div className="payroll-create"><div><div className="form-kicker">2 · RECEITA BRUTA DA EMPRESA</div><h2>Segregação mensal por atividade</h2><p>Informe os valores apurados no período. O fator é calculado como receita Anexo IV ÷ receita total.</p></div>
   <form onSubmit={saveRevenue}>
    <label>Competência<input type="month" required value={competence} onChange={e=>setCompetence(e.target.value)}/></label>
    <div className="form-two"><label>Receita bruta total (R$)<input type="number" min="0" step="0.01" required value={total} onChange={e=>setTotal(e.target.value)} placeholder="0,00"/></label><label>Receita bruta Anexo IV (R$)<input type="number" min="0" step="0.01" required value={annexIV} onChange={e=>setAnnexIV(e.target.value)} placeholder="0,00"/></label></div>
    <label>Fonte documental<input required value={revenueSource} onChange={e=>setRevenueSource(e.target.value)} placeholder="PGDAS-D, relatório fiscal, livros de receitas..."/></label>
    <label>URL da documentação (opcional)<input type="url" value={revenueUrl} onChange={e=>setRevenueUrl(e.target.value)} placeholder="https://"/></label>
    <button className="employee-primary" disabled={saving}><Plus size={15}/> Salvar receita pendente</button>
   </form>
  </div>
  <div className="employee-list-card payroll-list"><div className="employee-list-head"><div><h2>Receitas por competência</h2><p>O sistema só usa registros validados na prévia de encargos.</p></div></div>
   {!revenues.length?<div className="employee-empty"><ReceiptText size={22}/><b>Nenhuma receita segregada</b><p>Cadastre a receita total e a parcela do Anexo IV para cada competência com empregados concomitantes.</p></div>:<div className="table-scroll"><table className="employee-table"><thead><tr><th>Competência</th><th>Receita total</th><th>Receita Anexo IV</th><th>Fator</th><th>Status</th><th></th></tr></thead><tbody>{revenues.map(r=><tr key={r.id}><td>{new Date(r.competence+"T12:00:00").toLocaleDateString("pt-BR",{month:"long",year:"numeric"})}</td><td>{money(r.total_gross_revenue)}</td><td>{money(r.annex_iv_gross_revenue)}</td><td>{r.total_gross_revenue>0?(100*r.annex_iv_gross_revenue/r.total_gross_revenue).toLocaleString("pt-BR",{maximumFractionDigits:4})+"%":r.annex_iv_gross_revenue===0?"0,00%":"—"}</td><td>{r.status==="validated"?"Validado":"Pendente"}</td><td>{r.status==="pending"&&<button className="employee-secondary" disabled={saving} onClick={()=>void validateRevenue(r)}>Validar</button>}</td></tr>)}</tbody></table></div>}
  </div>
  <div className="dependent-privacy"><ShieldCheck size={16}/> O motor não estima receitas, não presume a classificação do empregado e não aplica fatores sem documento validado. A receita do Anexo IV deve ser conferida com a apuração fiscal da mesma competência.</div>
 </section></main>;
}
