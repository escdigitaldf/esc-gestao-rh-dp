"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import {Activity,AlertTriangle,ArrowUpRight,Bell,BookOpen,BriefcaseBusiness,Building2,CalendarClock,CalendarDays,ChartNoAxesCombined,ChevronDown,ClipboardList,Clock3,FileText,FolderOpen,Gift,HeartPulse,LayoutDashboard,LogOut,Plane,ReceiptText,Search,Settings,ShieldCheck,Target,Users,Wallet,WalletCards,X} from "lucide-react";
import {createClient} from "@/lib/supabase/client";
type Employee={id:string;employment_status:string;department_id:string|null;admission_date:string|null};
type AlertItem={title:string;detail:string;level:"high"|"medium"|"info";href:string};
const groups=[
 {name:"Visão estratégica",caption:"Acompanhe a operação",icon:ChartNoAxesCombined,color:"violet",items:[["Visão geral","/dashboard",LayoutDashboard],["Relatórios gerenciais","/dashboard/relatorios",ChartNoAxesCombined]]},
 {name:"Gestão de pessoas",caption:"Estrutura e ciclo do colaborador",icon:Users,color:"blue",items:[["Colaboradores","/dashboard/colaboradores",Users],["Admissão e integração","/dashboard/admissao",ClipboardList],["Departamentos","/dashboard/departamentos",Building2],["Acessos e permissões","/dashboard/acessos",ShieldCheck],["Cargos e funções","/dashboard/cargos",BriefcaseBusiness],["Férias e programação","/dashboard/ferias",Plane],["Afastamentos e licenças","/dashboard/afastamentos",CalendarClock],["Benefícios","/dashboard/beneficios",Gift],["Treinamentos","/dashboard/treinamentos",BookOpen],["Avaliação de desempenho","/dashboard/avaliacoes",Target],["Saúde ocupacional","/dashboard/saude-ocupacional",HeartPulse],["Documentos funcionais","/dashboard/documentos",FolderOpen]]},
 {name:"Departamento pessoal",caption:"Rotinas, folha e obrigações",icon:Wallet,color:"teal",items:[["Folha de pagamento","/dashboard/folha",Wallet],["Eventos variáveis","/dashboard/folha/eventos",ReceiptText],["13º salário","/dashboard/folha/decimo-terceiro",WalletCards],["Rescisões","/dashboard/folha/rescisoes",FileText],["Encargos patronais","/dashboard/folha/encargos-patronais",ShieldCheck],["Jornadas e DSR","/dashboard/folha/dsr",CalendarClock],["Frequência","/dashboard/frequencia",Clock3],["Parâmetros e rubricas","/dashboard/folha/configuracoes",Settings]]}
] as const;
const br=(n:number)=>n.toLocaleString("pt-BR");
const dateBR=(v:string)=>new Date(v+"T12:00:00").toLocaleDateString("pt-BR");
export default function Dashboard(){
 const router=useRouter();
 const [email,setEmail]=useState("");const [company,setCompany]=useState("");const [role,setRole]=useState("");const [trial,setTrial]=useState<string|null>(null);const [tenantOptions,setTenantOptions]=useState<{id:string;name:string;role:string}[]>([]);const [selectedOrgId,setSelectedOrgId]=useState("");
 const [employees,setEmployees]=useState<Employee[]>([]);const [departments,setDepartments]=useState<{id:string;name:string}[]>([]);
 const [alerts,setAlerts]=useState<AlertItem[]>([]);const [benefitCount,setBenefitCount]=useState(0);const [loading,setLoading]=useState(true);const [error,setError]=useState("");const [search,setSearch]=useState("");const [mobileNav,setMobileNav]=useState(false);
 const load=useCallback(async()=>{
  const s=createClient();const {data:{user},error:authError}=await s.auth.getUser();if(authError||!user){router.replace("/");return;}setEmail(user.email||"");
  const {data:memberships,error:memberError}=await s.from("organization_memberships").select("organization_id,role,organizations(id,trade_name,legal_name)").eq("user_id",user.id).eq("status","active");
  if(memberError){setError(memberError.message);setLoading(false);return;}if(!memberships?.length){router.replace("/onboarding");return;}
  const available=memberships.map((m:any)=>({id:m.organization_id,role:m.role,name:m.organizations?.trade_name||m.organizations?.legal_name||"Empresa"}));
  setTenantOptions(available);
  const savedOrgId=typeof window!=="undefined"?window.localStorage.getItem("esc_selected_org_id"):null;
  const membership=available.find(m=>m.id===(selectedOrgId||savedOrgId))||available[0];
  if(!selectedOrgId)setSelectedOrgId(membership.id);
  if(typeof window!=="undefined")window.localStorage.setItem("esc_selected_org_id",membership.id);
  setRole(membership.role);const id=membership.id;const today=new Date();const iso=today.toISOString().slice(0,10);const in30=new Date(today.getTime()+30*86400000).toISOString().slice(0,10);const in60=new Date(today.getTime()+60*86400000).toISOString().slice(0,10);
  const [org,emp,dept,abs,vac,period,benefit]=await Promise.all([
   s.from("organizations").select("trade_name,legal_name,trial_ends_at").eq("id",id).single(),
   s.from("employees").select("id,employment_status,department_id,admission_date").eq("organization_id",id),
   s.from("departments").select("id,name").eq("organization_id",id).eq("is_active",true).order("name"),
   s.from("employee_absences").select("id,start_date,end_date,status").eq("organization_id",id).eq("status","open"),
   s.from("employee_vacation_schedules").select("id,start_date,end_date,status").eq("organization_id",id).gte("start_date",iso).lte("start_date",in30),
   s.from("employee_vacation_periods").select("id,concession_end,status").eq("organization_id",id).gte("concession_end",iso).lte("concession_end",in60),
   s.from("employee_benefit_assignments").select("id").eq("organization_id",id).eq("status","active")
  ]);
  const issue=org.error||emp.error||dept.error||abs.error||vac.error||period.error||benefit.error;if(issue)setError(issue.message);
  if(org.data){setCompany(org.data.trade_name||org.data.legal_name||"Empresa");setTrial(org.data.trial_ends_at||null);}
  setEmployees(emp.data||[]);setDepartments(dept.data||[]);setBenefitCount(benefit.data?.length||0);
  const openAbs=abs.data||[];const overdue=openAbs.filter(x=>x.end_date&&x.end_date<iso).length;
  const nextVac=vac.data||[];const deadlines=period.data||[];
  const nextAlerts:AlertItem[]=[];
  if(overdue)nextAlerts.push({title:"Afastamentos com prazo ultrapassado",detail:`${overdue} registro(s) continuam abertos após a data final.`,level:"high",href:"/dashboard/afastamentos"});
  if(openAbs.length)nextAlerts.push({title:"Afastamentos em andamento",detail:`${openAbs.length} ocorrência(s) exigem acompanhamento do DP.`,level:"medium",href:"/dashboard/afastamentos"});
  if(deadlines.length)nextAlerts.push({title:"Prazos de concessão de férias próximos",detail:`${deadlines.length} período(s) vencem nos próximos 60 dias.`,level:"medium",href:"/dashboard/ferias"});
  if(nextVac.length)nextAlerts.push({title:"Férias programadas para os próximos 30 dias",detail:`${nextVac.length} programação(ões) com início próximo.`,level:"info",href:"/dashboard/ferias"});
  if(!nextAlerts.length)nextAlerts.push({title:"Nenhum alerta operacional identificado",detail:"Não há ocorrências nos indicadores monitorados neste momento.",level:"info",href:"/dashboard/relatorios"});
  setAlerts(nextAlerts);setLoading(false);
 },[router,selectedOrgId]);
 useEffect(()=>{void load()},[load]);
 async function logout(){const s=createClient();await s.auth.signOut();router.replace("/");router.refresh();}
 const active=employees.filter(e=>e.employment_status==="active").length;const inactive=Math.max(0,employees.length-active);const activePct=employees.length?Math.round(active/employees.length*100):0;
 const departmentBars=useMemo(()=>departments.map(d=>({...d,total:employees.filter(e=>e.department_id===d.id).length})).sort((a,b)=>b.total-a.total).slice(0,6),[departments,employees]);const maxDept=Math.max(1,...departmentBars.map(x=>x.total));
 const visibleGroups=groups.map(g=>({...g,items:g.items.filter(x=>x[0].toLowerCase().includes(search.toLowerCase()))})).filter(g=>g.items.length);
 if(loading)return <div className="loading-screen">Carregando seu ambiente de gestão...</div>;
 return <main className="dash-shell dash-modern">
  {mobileNav&&<button className="mobile-nav-backdrop" aria-label="Fechar menu" onClick={()=>setMobileNav(false)}/>}
  <aside className={`sidebar sidebar-modern ${mobileNav?"mobile-open":""}`}>
   <div className="brand side-brand"><div className="brand-mark">ESC</div><div><strong>ESC</strong><span>GESTÃO DE RH E DP</span></div><button className="mobile-close" onClick={()=>setMobileNav(false)} aria-label="Fechar menu"><X size={18}/></button></div>
   <div className="sidebar-search"><Search size={15}/><input aria-label="Buscar funcionalidade" placeholder="Buscar funcionalidade..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
   <nav className="dash-nav dash-nav-modern">{visibleGroups.map(group=><section className="nav-group" key={group.name}><div className="nav-group-heading"><span className={`nav-group-icon ${group.color}`}><group.icon size={15}/></span><div><b>{group.name}</b><small>{group.caption}</small></div></div>{group.items.map(([label,href,Icon])=><a key={href} className={`nav-item nav-item-modern ${href==="/dashboard"?"selected":""}`} href={href} onClick={()=>setMobileNav(false)}><span className={`nav-icon-tile ${group.color}`}><Icon size={16}/></span><span>{label}</span>{href==="/dashboard"&&<span className="nav-current-dot"/>}</a>)}</section>)}</nav>
   <div className="side-bottom"><div className="tenant-chip tenant-chip-modern"><div className="tenant-avatar">{(company||"E").slice(0,1).toUpperCase()}</div><div><b>{company||"Empresa"}</b><span>Ambiente empresarial</span></div><ChevronDown size={15}/></div><button className="logout" onClick={logout}><LogOut size={17}/> Sair da plataforma</button></div>
  </aside>
  <section className="dash-main"><header className="dash-top dash-top-modern"><button className="mobile-menu-toggle" onClick={()=>setMobileNav(true)} aria-label="Abrir menu"><span/><span/><span/></button><div className="top-context"><span className="top-context-dot"/><span>Central de gestão de pessoas</span></div><div className="top-actions">{tenantOptions.length>1&&<label className="tenant-switcher-label"><Building2 size={14}/><select className="tenant-switcher" aria-label="Selecionar empresa" value={selectedOrgId} onChange={e=>{const id=e.target.value;setSelectedOrgId(id);if(typeof window!=="undefined")window.localStorage.setItem("esc_selected_org_id",id);}}>{tenantOptions.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}<span className="role-chip"><ShieldCheck size={14}/>{role}</span><div className="user-pill"><div className="user-avatar">{email.slice(0,1).toUpperCase()}</div><span>{email}</span></div></div></header>
   <div className="dash-content dash-content-modern"><div className="welcome-row welcome-row-modern"><div><div className="form-kicker">PAINEL EXECUTIVO · RH & DP</div><h1>Visão geral</h1><p>Olá! Aqui está o panorama operacional de <b>{company||"sua empresa"}</b>.</p></div><div className="date-chip"><CalendarDays size={16}/>{new Date().toLocaleDateString("pt-BR",{day:"2-digit",month:"long",year:"numeric"})}</div></div>
    {trial&&<div className="setup-banner"><div className="setup-icon"><Activity/></div><div><b>Período de avaliação</b><p>Seu ambiente está em avaliação até {dateBR(trial.slice(0,10))}.</p></div><span className="status-pill">AVALIAÇÃO</span></div>}
    {error&&<div className="notice error">{error}</div>}
    <div className="dashboard-section-title"><div><span>RESUMO DO QUADRO FUNCIONAL</span><h2>Indicadores principais</h2></div><small>Atualizado ao carregar o painel</small></div>
    <div className="metric-grid metric-grid-modern">
     <article className="metric-card metric-modern blue"><div className="metric-top"><span>Colaboradores</span><span className="metric-icon"><Users size={18}/></span></div><strong>{br(employees.length)}</strong><small>Total cadastrado na organização</small><div className="metric-foot"><span>Quadro funcional</span><b>{activePct}% ativos</b></div></article>
     <article className="metric-card metric-modern green"><div className="metric-top"><span>Vínculos ativos</span><span className="metric-icon"><Activity size={18}/></span></div><strong>{br(active)}</strong><small>Colaboradores em atividade</small><div className="metric-foot"><span>Ativos no cadastro</span><b>{employees.length?br(inactive)+" inativos":"—"}</b></div></article>
     <article className="metric-card metric-modern violet"><div className="metric-top"><span>Departamentos</span><span className="metric-icon"><Building2 size={18}/></span></div><strong>{br(departments.length)}</strong><small>Áreas organizacionais ativas</small><div className="metric-foot"><span>Estrutura</span><b>{departmentBars.length} em destaque</b></div></article>
     <article className="metric-card metric-modern orange"><div className="metric-top"><span>Benefícios ativos</span><span className="metric-icon"><Gift size={18}/></span></div><strong>{br(benefitCount)}</strong><small>Atribuições vigentes</small><div className="metric-foot"><span>Gestão de benefícios</span><b>Detalhar <ArrowUpRight size={12}/></b></div></article>
    </div>
    <div className="dashboard-panels">
     <section className="dashboard-panel workforce-panel"><div className="panel-heading"><div><span>COMPOSIÇÃO</span><h3>Situação do quadro</h3></div><Users size={18}/></div><div className="workforce-total"><strong>{br(employees.length)}</strong><span>colaboradores cadastrados</span></div><div className="workforce-bar"><span style={{width:activePct+"%"}}/><i style={{width:(100-activePct)+"%"}}/></div><div className="workforce-legend"><div><i className="legend-dot active-dot"/><span>Ativos</span><b>{br(active)}</b><small>{activePct}%</small></div><div><i className="legend-dot inactive-dot"/><span>Outros status</span><b>{br(inactive)}</b><small>{100-activePct}%</small></div></div><a className="panel-link" href="/dashboard/colaboradores">Ver quadro de colaboradores <ArrowUpRight size={14}/></a></section>
     <section className="dashboard-panel department-panel"><div className="panel-heading"><div><span>ESTRUTURA ORGANIZACIONAL</span><h3>Distribuição por departamento</h3></div><Building2 size={18}/></div>{departmentBars.length? <div className="department-bars">{departmentBars.map((d,i)=><div className="department-bar-row" key={d.id}><div><span>{d.name}</span><b>{d.total}</b></div><div className="department-track"><i style={{width:(d.total/maxDept*100)+"%"}} className={`dept-color-${i%5}`}/></div></div>)}</div>:<div className="panel-empty">Cadastre departamentos e vincule colaboradores para visualizar a distribuição.</div>}<a className="panel-link" href="/dashboard/departamentos">Gerenciar departamentos <ArrowUpRight size={14}/></a></section>
    </div>
    <section className="dashboard-panel alerts-panel"><div className="panel-heading"><div><span>MONITORAMENTO OPERACIONAL</span><h3><Bell size={17}/> Alertas e pontos de atenção</h3></div><span className="alert-counter">{alerts.filter(a=>a.level!=="info").length} atenção(ões)</span></div><div className="alert-list">{alerts.map((a,i)=><a href={a.href} className={`alert-row alert-${a.level}`} key={a.title}><span className="alert-symbol">{a.level==="high"?<AlertTriangle size={17}/>:a.level==="medium"?<CalendarClock size={17}/>:<ShieldCheck size={17}/>}</span><span className="alert-copy"><b>{a.title}</b><small>{a.detail}</small></span><span className="alert-action">Verificar <ArrowUpRight size={13}/></span></a>)}</div><p className="alert-disclaimer">Os alertas são calculados com base nos registros disponíveis no sistema. Confira os prazos e documentos oficiais antes de concluir rotinas do DP.</p></section>
    <div className="dashboard-section-title modules-title"><div><span>ACESSO RÁPIDO</span><h2>Módulos por área</h2></div><small>Escolha uma funcionalidade para continuar</small></div>
    <div className="module-launch-grid">{groups.slice(1).map(group=><section className="module-launch-card" key={group.name}><div className="module-launch-heading"><span className={`nav-group-icon ${group.color}`}><group.icon size={17}/></span><div><b>{group.name}</b><small>{group.caption}</small></div></div><div className="module-launch-links">{group.items.slice(0,6).map(([label,href,Icon])=><a key={href} href={href}><Icon size={15}/>{label}<ArrowUpRight size={13}/></a>)}</div></section>)}</div>
    <div className="footer-note">ESC Gestão de RH e DP <span>•</span> Ambiente protegido por permissões de acesso</div>
   </div>
  </section>
 </main>;
}