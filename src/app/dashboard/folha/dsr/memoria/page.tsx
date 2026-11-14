"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import {ArrowLeft,CalendarDays,Clock,ShieldAlert,ClipboardList,RefreshCw} from "lucide-react";
import {createClient} from "@/lib/supabase/client";

type Employee={id:string;employee_code:string;full_name:string;employment_status:string};
type Schedule={id:string;employee_id:string;schedule_name:string;schedule_type:string;effective_from:string;effective_to:string|null;dsr_rule_status:string;weekly_hours:number|null;cycle_days:number|null};
type Occurrence={id:string;employee_id:string;work_schedule_id:string;occurrence_date:string;occurrence_type:string;scheduled_hours:number;worked_hours:number;record_status:string};
type VariableEvent={id:string;employee_id:string;code:string;description:string;amount:number|null;quantity:number;unit_value:number;status:string;event_date:string|null;dsr_category:string};
type Summary={employee:Employee;schedules:Schedule[];occurrences:Occurrence[];events:VariableEvent[];scheduled:number;worked:number;draft:number;validated:number;rejected:number};

const monthName=(v:string)=>new Date(v+"-15T12:00:00").toLocaleDateString("pt-BR",{month:"long",year:"numeric"});
const money=(v:number)=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const eventAmount=(x:VariableEvent)=>Number(x.amount??(Number(x.quantity||0)*Number(x.unit_value||0)));
const dsrCategoryName=(v:string)=>({overtime:"Horas extras",commission:"Comissões",additional:"Adicionais",bonus:"Prêmios/bonificações",other:"Outras parcelas",not_applicable:"Não aplicável"} as Record<string,string>)[v]||v;
const hours=(v:number)=>Number(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})+" h";
const typeName=(v:string)=>({fixed_weekly:"Semanal fixa",rotating:"Revezamento",twelve_by_thirty_six:"12x36",custom:"Personalizada"} as Record<string,string>)[v]||v;

export default function DsrMemoryPage(){
 const router=useRouter();
 const [month,setMonth]=useState(new Date().toISOString().slice(0,7));
 const [employees,setEmployees]=useState<Employee[]>([]);
 const [schedules,setSchedules]=useState<Schedule[]>([]);
 const [occurrences,setOccurrences]=useState<Occurrence[]>([]);
 const [events,setEvents]=useState<VariableEvent[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [refreshed,setRefreshed]=useState("");

 const load=useCallback(async()=>{
  setLoading(true);setError("");
  const s=createClient();
  const {data:{user},error:authError}=await s.auth.getUser();
  if(authError||!user){router.replace("/");return;}
  const {data:membership,error:membershipError}=await s.from("organization_memberships").select("organization_id").eq("user_id",user.id).eq("status","active").limit(1).maybeSingle();
  if(membershipError||!membership){setError(membershipError?.message||"Organização não encontrada.");setLoading(false);return;}
  const start=month+"-01";
  const end=new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).toISOString().slice(0,10);
  const [emp,sch,occ,ev]=await Promise.all([
   s.from("employees").select("id,employee_code,full_name,employment_status").eq("organization_id",membership.organization_id).order("full_name"),
   s.from("employee_work_schedules").select("id,employee_id,schedule_name,schedule_type,effective_from,effective_to,dsr_rule_status,weekly_hours,cycle_days").eq("organization_id",membership.organization_id).lte("effective_from",end).or("effective_to.is.null,effective_to.gte."+start),
   s.from("employee_work_occurrences").select("id,employee_id,work_schedule_id,occurrence_date,occurrence_type,scheduled_hours,worked_hours,record_status").eq("organization_id",membership.organization_id).gte("occurrence_date",start).lte("occurrence_date",end).order("occurrence_date"),
   s.from("payroll_variable_events").select("id,employee_id,code,description,amount,quantity,unit_value,status,event_date,dsr_category").eq("organization_id",membership.organization_id).eq("competence",start).eq("affects_dsr",true).in("status",["pending","approved","processed"]).order("event_date")
  ]);
  const issue=emp.error||sch.error||occ.error||ev.error;
  if(issue)setError(issue.message);
  setEmployees((emp.data||[]) as Employee[]);
  setSchedules((sch.data||[]) as Schedule[]);
  setOccurrences((occ.data||[]) as Occurrence[]);
  setEvents((ev.data||[]) as VariableEvent[]);
  setRefreshed(new Date().toLocaleString("pt-BR"));
  setLoading(false);
 },[router,month]);

 useEffect(()=>{void load()},[load]);
 const summaries=useMemo<Summary[]>(()=>employees.map(employee=>{
  const employeeSchedules=schedules.filter(x=>x.employee_id===employee.id);
  const employeeOccurrences=occurrences.filter(x=>x.employee_id===employee.id);
  const employeeEvents=events.filter(x=>x.employee_id===employee.id);
  return {employee,schedules:employeeSchedules,occurrences:employeeOccurrences,events:employeeEvents,
   scheduled:employeeOccurrences.filter(x=>x.record_status==="validated").reduce((a,x)=>a+Number(x.scheduled_hours||0),0),
   worked:employeeOccurrences.filter(x=>x.record_status==="validated").reduce((a,x)=>a+Number(x.worked_hours||0),0),
   draft:employeeOccurrences.filter(x=>x.record_status==="draft").length,
   validated:employeeOccurrences.filter(x=>x.record_status==="validated").length,
   rejected:employeeOccurrences.filter(x=>x.record_status==="rejected").length};
 }),[employees,schedules,occurrences,events]);
 const totals=useMemo(()=>({draft:occurrences.filter(x=>x.record_status==="draft").length,validated:occurrences.filter(x=>x.record_status==="validated").length,rejected:occurrences.filter(x=>x.record_status==="rejected").length,unvalidatedSchedules:schedules.filter(x=>x.dsr_rule_status!=="validated").length,dsrEvents:events.length,approvedEvents:events.filter(x=>x.status==="approved").length,pendingEvents:events.filter(x=>x.status==="pending").length,processedEvents:events.filter(x=>x.status==="processed").length,approvedAmount:events.filter(x=>x.status==="approved").reduce((a,x)=>a+eventAmount(x),0)}),[occurrences,schedules,events]);

 if(loading)return <div className="loading-screen">Preparando memória preliminar do DSR...</div>;
 return <main className="module-shell">
  <header className="module-top"><a href="/dashboard/folha/dsr"><ArrowLeft size={16}/> Jornadas e DSR</a><b><span className="brand-mark">ESC</span> Gestão de RH e DP</b><span>Memória preliminar</span></header>
  <section className="module-content payroll-content">
   <div className="module-heading"><div><div className="form-kicker">DEPARTAMENTO PESSOAL · CONFERÊNCIA</div><h1>Memória preliminar do DSR</h1><p>Consolidação operacional por colaborador, antes da apuração financeira.</p></div><div className="salary-history-icon"><ClipboardList size={24}/></div></div>
   {error&&<div className="notice error">{error}</div>}
   <div className="dependent-privacy"><ShieldAlert size={17}/><span><b>Prévia sem lançamento financeiro.</b> Esta tela consolida apontamentos validados e eventos com incidência de DSR. Não calcula valor, não cria rubrica e não altera a folha. A apuração permanece bloqueada até validação da regra legal/coletiva e da escala.</span></div>
   <div className="employee-list-card payroll-list"><div className="employee-list-head"><div><h2>Competência analisada</h2><p>{monthName(month)}</p></div><label>Competência<input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label><button className="employee-secondary" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/> Atualizar</button></div></div>
   <div className="employee-stats payroll-stats">
    <div><span>Ocorrências validadas</span><b>{totals.validated}</b></div>
    <div><span>Pendentes de validação</span><b>{totals.draft}</b></div>
    <div><span>Escalas sem regra validada</span><b>{totals.unvalidatedSchedules}</b></div>
    <div><span>Eventos DSR aprovados</span><b>{totals.approvedEvents}</b></div>
    <div><span>Eventos já processados</span><b>{totals.processedEvents}</b></div>
    <div><span>Base variável aprovada (informativa)</span><b>{money(totals.approvedAmount)}</b></div>
   </div>
   <div className="employee-list-card payroll-list">
    <div className="employee-list-head"><div><h2>Consolidação por colaborador</h2><p>Horas abaixo consideram somente ocorrências validadas.</p></div><span>{summaries.length} colaborador(es)</span></div>
    {!summaries.length?<div className="employee-empty"><CalendarDays size={22}/><b>Nenhum colaborador cadastrado</b><p>Cadastre colaboradores para iniciar a conferência de jornadas.</p></div>:
    <div className="table-scroll"><table className="employee-table"><thead><tr><th>Colaborador</th><th>Escala vigente</th><th>Ocorrências</th><th>Horas previstas validadas</th><th>Horas trabalhadas validadas</th><th>Eventos DSR aprovados</th><th>Condição</th></tr></thead><tbody>
     {summaries.map(row=>{
      const approved=row.events.filter(x=>x.status==="approved");
      const pending=row.events.filter(x=>x.status==="pending");
      const processed=row.events.filter(x=>x.status==="processed");
      const scheduleOk=row.schedules.length>0&&row.schedules.every(x=>x.dsr_rule_status==="validated");
      const hasDraft=row.draft>0;
      const condition=!scheduleOk?"Regra/escala pendente":hasDraft?"Apontamentos pendentes":approved.length?"Evento DSR requer apuração":processed.length?"Evento já processado na folha":"Aguardando validação DP";
      return <tr key={row.employee.id}>
       <td><b>{row.employee.full_name}</b><br/><small>{row.employee.employee_code}</small></td>
       <td>{row.schedules.length?row.schedules.map(x=><div key={x.id}>{x.schedule_name}<br/><small>{typeName(x.schedule_type)} · {x.dsr_rule_status==="validated"?"Regra validada":"Regra pendente"}</small></div>):"Sem escala"}</td>
       <td>{row.validated} validadas · {row.draft} rascunhos · {row.rejected} rejeitadas</td>
       <td>{hours(row.scheduled)}</td><td>{hours(row.worked)}</td>
       <td>{approved.length} aprovados{pending.length?" · "+pending.length+" pendentes":""}{processed.length?" · "+processed.length+" processados":""}{approved.length>0&&<small><br/>Base informativa: {money(approved.reduce((a,x)=>a+eventAmount(x),0))}</small>}</td>
       <td><span className="status-pill">{condition}</span></td>
      </tr>;
     })}
    </tbody></table></div>}
   </div>
   <div className="employee-list-card payroll-list">
    <div className="employee-list-head"><div><h2>Eventos variáveis com incidência de DSR</h2><p>Valores são exibidos apenas para conferência da base informativa; não representam DSR calculado.</p></div><span>{events.length} evento(s)</span></div>
    {!events.length?<div className="employee-empty"><Clock size={22}/><b>Nenhum evento com incidência de DSR</b><p>Eventos aprovados serão listados aqui para compor a futura memória de cálculo.</p></div>:
    <div className="table-scroll"><table className="employee-table"><thead><tr><th>Colaborador</th><th>Data</th><th>Rubrica</th><th>Classificação DSR</th><th>Valor do evento</th><th>Situação</th></tr></thead><tbody>{events.map(x=><tr key={x.id}><td>{employees.find(e=>e.id===x.employee_id)?.full_name||"Colaborador"}</td><td>{x.event_date?new Date(x.event_date+"T12:00:00").toLocaleDateString("pt-BR"):"—"}</td><td>{x.code} · {x.description}</td><td>{dsrCategoryName(x.dsr_category)}</td><td>{money(eventAmount(x))}</td><td>{x.status==="approved"?"Aprovado":x.status==="processed"?"Já processado na folha":"Pendente de aprovação"}</td></tr>)}</tbody></table></div>}
   </div>
   <div className="dependent-privacy"><Clock size={16}/><span>Atualizado em {refreshed||"—"}. Próxima etapa: vincular a regra do DSR à convenção/acordo coletivo aplicável e ao regime de jornada, validar a cobertura diária e somente então liberar o cálculo financeiro e a integração atômica com a folha.</span></div>
  </section>
 </main>;
}
