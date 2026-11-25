"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import {ArrowLeft,Download,FileBarChart,RefreshCw,Users,CalendarDays,Wallet,Plane,FileText,Building2} from "lucide-react";
import {createClient} from "@/lib/supabase/client";

type Employee={id:string;employee_code:string;full_name:string;cpf:string;employment_status:string;admission_date:string|null;termination_date:string|null;salary_amount:number|null;departments?:{name:string}|null;positions?:{title:string}|null};
type Run={id:string;reference_month:string;status:string;employee_count:number;total_earnings:number;total_deductions:number;total_net:number;payment_date:string|null};
type Metric={label:string;value:number;icon:typeof Users;detail:string};
const money=(v:number)=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
function csv(rows:string[][]){const content="\uFEFF"+rows.map(r=>r.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(";")).join("\r\n");const url=URL.createObjectURL(new Blob([content],{type:"text/csv;charset=utf-8;"}));const a=document.createElement("a");a.href=url;a.download="esc-relatorio-rh.csv";a.click();URL.revokeObjectURL(url);}
export default function ReportsPage(){
 const router=useRouter();const [org,setOrg]=useState("");const [employees,setEmployees]=useState<Employee[]>([]);const [runs,setRuns]=useState<Run[]>([]);const [counts,setCounts]=useState({departments:0,positions:0,vacationPeriods:0,vacationSchedules:0,documents:0,occurrences:0});const [loading,setLoading]=useState(true);const [error,setError]=useState("");const [search,setSearch]=useState("");const [status,setStatus]=useState("all");
 const load=useCallback(async()=>{setLoading(true);setError("");const s=createClient();const {data:{user},error:auth}=await s.auth.getUser();if(auth||!user){router.replace("/");return;}const {data:m,error:me}=await s.from("organization_memberships").select("organization_id").eq("user_id",user.id).eq("status","active").limit(1).maybeSingle();if(me||!m){setError(me?.message||"Organização não encontrada.");setLoading(false);return;}const id=m.organization_id;setOrg(id);
 const [e,r,d,p,vp,vs,docs,occ]=await Promise.all([
 s.from("employees").select("id,employee_code,full_name,cpf,employment_status,admission_date,termination_date,salary_amount,departments(name),positions(title)").eq("organization_id",id).order("full_name"),
 s.from("payroll_runs").select("id,reference_month,status,employee_count,total_earnings,total_deductions,total_net,payment_date").eq("organization_id",id).order("reference_month",{ascending:false}).limit(24),
 s.from("departments").select("id",{count:"exact",head:true}).eq("organization_id",id),
 s.from("positions").select("id",{count:"exact",head:true}).eq("organization_id",id),
 s.from("employee_vacation_periods").select("id",{count:"exact",head:true}).eq("organization_id",id),
 s.from("employee_vacation_schedules").select("id",{count:"exact",head:true}).eq("organization_id",id),
 s.from("employee_documents").select("id",{count:"exact",head:true}).eq("organization_id",id),
 s.from("employee_work_occurrences").select("id",{count:"exact",head:true}).eq("organization_id",id)
 ]);
 if(e.error)setError(e.error.message);setEmployees((e.data||[]) as unknown as Employee[]);setRuns((r.data||[]) as Run[]);setCounts({departments:d.count||0,positions:p.count||0,vacationPeriods:vp.count||0,vacationSchedules:vs.count||0,documents:docs.count||0,occurrences:occ.count||0});setLoading(false);
 },[router]);
 useEffect(()=>{void load()},[load]);
 const visible=useMemo(()=>employees.filter(e=>(status==="all"||e.employment_status===status)&&(e.full_name+" "+e.employee_code+" "+e.cpf).toLowerCase().includes(search.toLowerCase())),[employees,status,search]);
 const active=employees.filter(e=>e.employment_status==="active").length;
 const metrics:Metric[]=[{label:"Colaboradores",value:employees.length,icon:Users,detail:active+" ativos"},{label:"Departamentos",value:counts.departments,icon:Building2,detail:counts.positions+" cargos cadastrados"},{label:"Programações de férias",value:counts.vacationSchedules,icon:Plane,detail:counts.vacationPeriods+" períodos aquisitivos"},{label:"Documentos arquivados",value:counts.documents,icon:FileText,detail:"Prontuários digitais"},{label:"Ocorrências de jornada",value:counts.occurrences,icon:CalendarDays,detail:"Registros de frequência"}];
 function exportEmployees(){csv([["Matrícula","Nome","CPF","Situação","Admissão","Desligamento","Departamento","Cargo","Salário"],...visible.map(e=>[e.employee_code,e.full_name,e.cpf,e.employment_status,e.admission_date||"",e.termination_date||"",e.departments?.name||"",e.positions?.title||"",String(e.salary_amount??"")])]);}
 function exportPayroll(){csv([["Competência","Status","Colaboradores","Proventos","Descontos","Líquido","Pagamento"],...runs.map(r=>[r.reference_month,r.status,String(r.employee_count||0),String(r.total_earnings||0),String(r.total_deductions||0),String(r.total_net||0),r.payment_date||""])]);}
 if(loading)return <div className="loading-screen">Consolidando relatórios...</div>;
 return <main className="module-shell"><header className="module-top"><a href="/dashboard"><ArrowLeft size={16}/> Painel</a><b><span className="brand-mark">ESC</span> Gestão de RH e DP</b><span>Relatórios gerenciais</span></header><section className="module-content">
 <div className="module-heading"><div><div className="form-kicker">GESTÃO E INDICADORES</div><h1>Relatórios gerenciais</h1><p>Indicadores consolidados da organização. Os dados são consultados diretamente dos módulos operacionais.</p></div><button className="employee-secondary" onClick={()=>void load()}><RefreshCw size={16}/> Atualizar</button></div>
 {error&&<div className="notice error">{error}</div>}
 <div className="metric-grid">{metrics.map(m=><article className="metric-card" key={m.label}><div className="metric-top"><span>{m.label}</span><m.icon size={19}/></div><strong>{m.value}</strong><small>{m.detail}</small></article>)}</div>
 <section className="module-card"><div className="module-heading"><div><h2>Quadro funcional</h2><p>Consulte e exporte a relação de colaboradores.</p></div><button className="employee-primary" onClick={exportEmployees}><Download size={16}/> Exportar CSV</button></div>
 <div className="form-two"><label>Pesquisar<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nome, matrícula ou CPF"/></label><label>Situação<select value={status} onChange={e=>setStatus(e.target.value)}><option value="all">Todas</option><option value="active">Ativos</option><option value="terminated">Desligados</option><option value="on_leave">Afastados</option></select></label></div>
 <div className="table-wrap"><table><thead><tr><th>Matrícula</th><th>Colaborador</th><th>Departamento</th><th>Cargo</th><th>Situação</th><th>Admissão</th></tr></thead><tbody>{visible.map(e=><tr key={e.id}><td>{e.employee_code}</td><td>{e.full_name}</td><td>{e.departments?.name||"—"}</td><td>{e.positions?.title||"—"}</td><td>{e.employment_status}</td><td>{e.admission_date?new Date(e.admission_date+"T12:00:00").toLocaleDateString("pt-BR"):"—"}</td></tr>)}</tbody></table>{!visible.length&&<p className="module-empty">Nenhum colaborador encontrado.</p>}</div></section>
 <section className="module-card"><div className="module-heading"><div><h2>Histórico de folhas</h2><p>Últimas 24 competências disponíveis.</p></div><button className="employee-secondary" onClick={exportPayroll}><Download size={16}/> Exportar CSV</button></div>
 <div className="table-wrap"><table><thead><tr><th>Competência</th><th>Status</th><th>Colaboradores</th><th>Proventos</th><th>Descontos</th><th>Líquido</th><th>Pagamento</th></tr></thead><tbody>{runs.map(r=><tr key={r.id}><td>{r.reference_month}</td><td>{r.status}</td><td>{r.employee_count||0}</td><td>{money(r.total_earnings)}</td><td>{money(r.total_deductions)}</td><td>{money(r.total_net)}</td><td>{r.payment_date?new Date(r.payment_date+"T12:00:00").toLocaleDateString("pt-BR"):"—"}</td></tr>)}</tbody></table>{!runs.length&&<p className="module-empty">Nenhuma folha cadastrada.</p>}</div></section>
 <p className="footer-note">Relatórios respeitam as permissões e políticas de acesso da organização. Exportações são geradas no navegador e não armazenadas no servidor.</p>
 </section></main>;
}
