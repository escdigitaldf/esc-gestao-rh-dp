"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import {ArrowLeft,CalendarDays,Clock,ShieldAlert,ClipboardList,RefreshCw} from "lucide-react";
import {createClient} from "@/lib/supabase/client";

type Employee={id:string;employee_code:string;full_name:string;employment_status:string};
type Schedule={id:string;employee_id:string;dsr_rule_id:string|null;schedule_name:string;schedule_type:string;effective_from:string;effective_to:string|null;dsr_rule_status:string;weekly_hours:number|null;cycle_days:number|null;work_days:number[];weekly_rest_days:number[];cycle_pattern:string[]};
type Holiday={id:string;holiday_date:string;name:string;holiday_scope:string;state_code:string|null;city:string|null;is_optional_workday:boolean};
type Occurrence={id:string;employee_id:string;work_schedule_id:string;occurrence_date:string;occurrence_type:string;scheduled_hours:number;worked_hours:number;record_status:string};
type VariableEvent={id:string;employee_id:string;rubric_id:string|null;code:string;description:string;item_type:string;amount:number|null;quantity:number;unit_value:number;status:string;event_date:string|null;dsr_category:string};
type Rubric={id:string;code:string;description:string;item_type:string;affects_dsr:boolean;dsr_category:string;active:boolean};
type DsrRule={id:string;rule_name:string;professional_category:string|null;union_name:string|null;source_type:string;validity_from:string|null;validity_to:string|null;status:string;calculation_method:string|null};
type CategoryParameter={id:string;dsr_rule_id:string;category:string;unit:string;denominator:number;rest_units:number;effective_from:string;effective_to:string|null;status:string;justification:string;source_reference:string|null;version:number};
type Summary={employee:Employee;schedules:Schedule[];occurrences:Occurrence[];events:VariableEvent[];scheduled:number;worked:number;draft:number;validated:number;rejected:number};
type ReviewLog={action:string;actor_user_id:string|null;created_at:string;metadata:Record<string,unknown>};

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
 const [rubrics,setRubrics]=useState<Rubric[]>([]);
 const [dsrRules,setDsrRules]=useState<DsrRule[]>([]);
 const [categoryParameters,setCategoryParameters]=useState<CategoryParameter[]>([]);
 const [holidays,setHolidays]=useState<Holiday[]>([]);
 const [dailyEmployee,setDailyEmployee]=useState("");
 const [organizationId,setOrganizationId]=useState("");
 const [currentUserId,setCurrentUserId]=useState("");
 const [currentRole,setCurrentRole]=useState("");
 const [reviewHistory,setReviewHistory]=useState<ReviewLog[]>([]);
 const [reviewNote,setReviewNote]=useState("");
 const [savingReview,setSavingReview]=useState(false);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [refreshed,setRefreshed]=useState("");

 const load=useCallback(async()=>{
  setLoading(true);setError("");
  const s=createClient();
  const {data:{user},error:authError}=await s.auth.getUser();
  if(authError||!user){router.replace("/");return;}
  const {data:membership,error:membershipError}=await s.from("organization_memberships").select("organization_id,role").eq("user_id",user.id).eq("status","active").limit(1).maybeSingle();
  if(membershipError||!membership){setError(membershipError?.message||"Organização não encontrada.");setLoading(false);return;}
  const start=month+"-01";
  setOrganizationId(membership.organization_id);setCurrentUserId(user.id);setCurrentRole(membership.role||"");
  const end=new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).toISOString().slice(0,10);
  const [emp,sch,occ,ev,rub,rule,param,hol,history]=await Promise.all([
   s.from("employees").select("id,employee_code,full_name,employment_status").eq("organization_id",membership.organization_id).order("full_name"),
   s.from("employee_work_schedules").select("id,employee_id,dsr_rule_id,schedule_name,schedule_type,effective_from,effective_to,dsr_rule_status,weekly_hours,cycle_days,work_days,weekly_rest_days,cycle_pattern").eq("organization_id",membership.organization_id).lte("effective_from",end).or("effective_to.is.null,effective_to.gte."+start),
   s.from("employee_work_occurrences").select("id,employee_id,work_schedule_id,occurrence_date,occurrence_type,scheduled_hours,worked_hours,record_status").eq("organization_id",membership.organization_id).gte("occurrence_date",start).lte("occurrence_date",end).order("occurrence_date"),
   s.from("payroll_variable_events").select("id,employee_id,rubric_id,code,description,item_type,amount,quantity,unit_value,status,event_date,dsr_category").eq("organization_id",membership.organization_id).eq("competence",start).eq("affects_dsr",true).in("status",["pending","approved","processed"]).order("event_date"),
   s.from("payroll_rubrics").select("id,code,description,item_type,affects_dsr,dsr_category,active").eq("organization_id",membership.organization_id).eq("active",true).order("code"),
   s.from("organization_dsr_rules").select("id,rule_name,professional_category,union_name,source_type,validity_from,validity_to,status,calculation_method").eq("organization_id",membership.organization_id).order("rule_name"),
   s.from("organization_dsr_rule_category_parameters").select("id,dsr_rule_id,category,unit,denominator,rest_units,effective_from,effective_to,status,justification,source_reference,version").eq("organization_id",membership.organization_id).order("category"),
   s.from("organization_holidays").select("id,holiday_date,name,holiday_scope,state_code,city,is_optional_workday").eq("organization_id",membership.organization_id).gte("holiday_date",start).lte("holiday_date",end),
   s.from("audit_logs").select("action,actor_user_id,created_at,metadata").eq("organization_id",membership.organization_id).eq("resource_type","dsr_competence_review").eq("resource_id",start).order("created_at",{ascending:false}).limit(20)
  ]);
  const issue=emp.error||sch.error||occ.error||ev.error||rub.error||rule.error||param.error||hol.error||history.error;
  if(issue)setError(issue.message);
  setEmployees((emp.data||[]) as Employee[]);
  setSchedules((sch.data||[]) as Schedule[]);
  setOccurrences((occ.data||[]) as Occurrence[]);
  setEvents((ev.data||[]) as VariableEvent[]);
  setRubrics((rub.data||[]) as Rubric[]);
  setDsrRules((rule.data||[]) as DsrRule[]);
  setCategoryParameters((param.data||[]) as CategoryParameter[]);
  setHolidays((hol.data||[]) as Holiday[]);
  setReviewHistory((history.data||[]) as ReviewLog[]);
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
 const rulesInUse=useMemo(()=>dsrRules.filter(rule=>schedules.some(schedule=>schedule.dsr_rule_id===rule.id)),[dsrRules,schedules]);
 const selectedDailyEmployee=dailyEmployee||employees[0]?.id||"";
 const dailyRows=useMemo(()=>{
  const year=Number(month.slice(0,4)),monthIndex=Number(month.slice(5,7))-1;
  const count=new Date(year,monthIndex+1,0).getDate();
  const rows=[] as {date:string;dayLabel:string;scheduleLabel:string;dayType:string;occurrenceLabel:string;hoursLabel:string;statusLabel:string;alert:boolean}[];
  for(let day=1;day<=count;day++){
   const date=year+"-"+String(monthIndex+1).padStart(2,"0")+"-"+String(day).padStart(2,"0");
   const active=schedules.filter(x=>x.employee_id===selectedDailyEmployee&&x.effective_from<=date&&(!x.effective_to||x.effective_to>=date));
   const occurrence=occurrences.find(x=>x.employee_id===selectedDailyEmployee&&x.occurrence_date===date);
   const holiday=holidays.find(x=>x.holiday_date===date);
   let dayType="Sem escala vigente",scheduledDay:boolean|null=null;
   if(active.length>1)dayType="Conflito: mais de uma escala vigente";
   else if(active.length===1){
    const s=active[0];
    if(s.schedule_type==="fixed_weekly"){const weekday=new Date(date+"T12:00:00").getDay();if((s.work_days||[]).includes(weekday)){scheduledDay=true;dayType="Dia previsto de trabalho";}else if((s.weekly_rest_days||[]).includes(weekday)){scheduledDay=false;dayType="Repouso semanal previsto";}else dayType="Dia sem classificação na escala";}
    else if(s.cycle_days&&s.cycle_days>0&&(s.cycle_pattern||[]).length===s.cycle_days){const offset=Math.floor((Date.parse(date+"T00:00:00Z")-Date.parse(s.effective_from+"T00:00:00Z"))/86400000);const pattern=s.cycle_pattern[((offset%s.cycle_days)+s.cycle_days)%s.cycle_days];if(pattern==="work"){scheduledDay=true;dayType="Dia previsto de trabalho (ciclo)";}else if(pattern==="rest"){scheduledDay=false;dayType="Repouso previsto (ciclo)";}else dayType="Padrão de ciclo inconsistente";}
    else dayType="Escala sem padrão diário utilizável";
   }
   if(holiday){if(["national","organization"].includes(holiday.holiday_scope))dayType+=" · "+(holiday.is_optional_workday?"ponto facultativo":"feriado cadastrado");else dayType+=" · data local cadastrada (abrangência a conferir)";}
   const occurrenceLabel=occurrence?({workday:"Trabalho",weekly_rest:"Repouso semanal",holiday:"Feriado",compensatory_rest:"Folga compensatória",absence_justified:"Falta justificada",absence_unjustified:"Falta injustificada",leave:"Afastamento",vacation:"Férias",other:"Outra ocorrência"} as Record<string,string>)[occurrence.occurrence_type]||occurrence.occurrence_type:"Sem apontamento";
   const statusLabel=occurrence?(occurrence.record_status==="validated"?"Validada":occurrence.record_status==="rejected"?"Rejeitada":"Rascunho"):"Sem apontamento";
   const mismatch=Boolean(occurrence&&scheduledDay!==null&&((scheduledDay&&["weekly_rest","compensatory_rest"].includes(occurrence.occurrence_type))||(!scheduledDay&&occurrence.occurrence_type==="workday")));
   const alert=active.length!==1||Boolean(active[0]&&active[0].dsr_rule_status!=="validated")||mismatch||Boolean(occurrence&&occurrence.record_status!=="validated");
   rows.push({date,dayLabel:new Date(date+"T12:00:00").toLocaleDateString("pt-BR",{weekday:"short",day:"2-digit"}),scheduleLabel:active.length===1?active[0].schedule_name:active.length>1?"Múltiplas escalas":"—",dayType,occurrenceLabel:occurrenceLabel+(mismatch?" · divergência com escala":""),hoursLabel:occurrence?Number(occurrence.worked_hours||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})+" h":"—",statusLabel,alert});
  }
  return rows;
 },[month,selectedDailyEmployee,schedules,occurrences,holidays]);
 const competenceAudit=useMemo(()=>{
  const year=Number(month.slice(0,4)),monthIndex=Number(month.slice(5,7))-1;
  const count=new Date(year,monthIndex+1,0).getDate();
  const today=new Date().toISOString().slice(0,10);
  const results:{date:string;employee:string;employeeCode:string;issue:string;detail:string}[]=[];
  for(const employee of employees){
   if(employee.employment_status!=="active")continue;
   for(let day=1;day<=count;day++){
    const date=year+"-"+String(monthIndex+1).padStart(2,"0")+"-"+String(day).padStart(2,"0");
    if(date>today)continue;
    const active=schedules.filter(x=>x.employee_id===employee.id&&x.effective_from<=date&&(!x.effective_to||x.effective_to>=date));
    const occurrence=occurrences.find(x=>x.employee_id===employee.id&&x.occurrence_date===date);
    const holiday=holidays.find(h=>h.holiday_date===date&&["national","organization"].includes(h.holiday_scope));
    if(active.length>1){results.push({date,employee:employee.full_name,employeeCode:employee.employee_code,issue:"Escalas sobrepostas",detail:"Mais de uma escala cobre esta data."});continue;}
    if(active.length===0){if(occurrence)results.push({date,employee:employee.full_name,employeeCode:employee.employee_code,issue:"Ocorrência sem escala vigente",detail:"O apontamento existe, mas não há escala vigente na data."});continue;}
    const schedule=active[0];
    if(schedule.dsr_rule_status!=="validated"||!schedule.dsr_rule_id)results.push({date,employee:employee.full_name,employeeCode:employee.employee_code,issue:"Escala/regra pendente",detail:"A escala não possui regra normativa vinculada e validada."});
    let scheduledDay:boolean|null=null;
    if(schedule.schedule_type==="fixed_weekly"){
     const weekday=new Date(date+"T12:00:00").getDay();
     if((schedule.work_days||[]).includes(weekday))scheduledDay=true;
     else if((schedule.weekly_rest_days||[]).includes(weekday))scheduledDay=false;
    }else if(schedule.cycle_days&&schedule.cycle_days>0&&(schedule.cycle_pattern||[]).length===schedule.cycle_days){
     const offset=Math.floor((Date.parse(date+"T00:00:00Z")-Date.parse(schedule.effective_from+"T00:00:00Z"))/86400000);
     const pattern=schedule.cycle_pattern[((offset%schedule.cycle_days)+schedule.cycle_days)%schedule.cycle_days];
     if(pattern==="work")scheduledDay=true;else if(pattern==="rest")scheduledDay=false;
    }
    if(!occurrence){
     if(holiday)results.push({date,employee:employee.full_name,employeeCode:employee.employee_code,issue:"Feriado sem classificação",detail:"Feriado cadastrado: "+holiday.name+". "+(holiday.is_optional_workday?"Ponto facultativo/dia opcional; confirmar a jornada efetivamente praticada.":"Conferir a escala, o funcionamento e o apontamento aplicável.")+" A ausência de registro não gera falta ou desconto automático."});
     else if(scheduledDay===true)results.push({date,employee:employee.full_name,employeeCode:employee.employee_code,issue:"Dia previsto sem apontamento",detail:"Pendência de registro/conferência; não é classificada automaticamente como falta."});
     else if(scheduledDay===null)results.push({date,employee:employee.full_name,employeeCode:employee.employee_code,issue:"Dia sem classificação",detail:"O padrão cadastrado não permite determinar trabalho ou repouso com segurança."});
     continue;
    }
    if(occurrence.record_status==="draft")results.push({date,employee:employee.full_name,employeeCode:employee.employee_code,issue:"Ocorrência em rascunho",detail:"O apontamento ainda depende de validação."});
    if(occurrence.record_status==="rejected")results.push({date,employee:employee.full_name,employeeCode:employee.employee_code,issue:"Ocorrência rejeitada",detail:"Revisar e registrar a correção por procedimento auditável."});
    const restTypes=["weekly_rest","compensatory_rest"];
    if(scheduledDay===true&&restTypes.includes(occurrence.occurrence_type))results.push({date,employee:employee.full_name,employeeCode:employee.employee_code,issue:"Divergência de jornada",detail:"A escala prevê trabalho, mas o apontamento informa repouso/folga."});
    if(scheduledDay===false&&occurrence.occurrence_type==="workday")results.push({date,employee:employee.full_name,employeeCode:employee.employee_code,issue:"Trabalho em repouso previsto",detail:"Conferir autorização, registro de horas e tratamento aplicável."});
   }
  }
  return results.sort((a,b)=>a.date.localeCompare(b.date)||a.employee.localeCompare(b.employee));
 },[month,employees,schedules,occurrences,holidays]);
 const auditCounts=useMemo(()=>({holidays:competenceAudit.filter(x=>x.issue==="Feriado sem classificação").length,missing:competenceAudit.filter(x=>x.issue==="Dia previsto sem apontamento").length,unresolved:competenceAudit.filter(x=>["Ocorrência em rascunho","Ocorrência rejeitada"].includes(x.issue)).length,conflicts:competenceAudit.filter(x=>["Escalas sobrepostas","Divergência de jornada","Trabalho em repouso previsto","Ocorrência sem escala vigente"].includes(x.issue)).length,unvalidated:competenceAudit.filter(x=>x.issue==="Escala/regra pendente").length,unclassified:competenceAudit.filter(x=>x.issue==="Dia sem classificação").length}),[competenceAudit]);
 const canReview=["owner","admin","hr_manager","payroll"].includes(currentRole);
 const reviewChecks=useMemo(()=>{
  const start=month+"-01",end=new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).toISOString().slice(0,10);
  const activeEmployeeIds=new Set(employees.filter(employee=>employee.employment_status==="active").map(employee=>employee.id));
  const activeSchedules=schedules.filter(s=>activeEmployeeIds.has(s.employee_id)&&s.effective_from<=end&&(!s.effective_to||s.effective_to>=start));
  const rulesOk=activeSchedules.length>0&&activeSchedules.every(s=>{const rule=dsrRules.find(r=>r.id===s.dsr_rule_id);return s.dsr_rule_status==="validated"&&Boolean(rule&&rule.status==="validated"&&rule.validity_from&&rule.validity_from<=start&&(!rule.validity_to||rule.validity_to>=end));});
  const eventAudits=events.map(eventAudit);
  const eventOriginsOk=eventAudits.every(x=>x==="Rubrica e parâmetro normativo conferidos");
  const pendingEvents=events.filter(x=>x.status==="pending").length;
  const checks=[
   {label:"Cobertura diária, feriados e consistência dos apontamentos",ok:competenceAudit.length===0,detail:competenceAudit.length+" pendência(s) identificada(s)"},
   {label:"Escalas e regras normativas válidas na competência",ok:rulesOk,detail:activeSchedules.length+" escala(s) no período"},
   {label:"Origem das rubricas e parâmetros DSR",ok:eventOriginsOk,detail:events.length+" evento(s) conferido(s)"},
   {label:"Aprovação dos eventos variáveis",ok:pendingEvents===0,detail:pendingEvents+" evento(s) aguardando aprovação"}
  ];
  return {checks,blockers:checks.filter(x=>!x.ok).length};
 },[month,employees,schedules,dsrRules,events,competenceAudit,rubrics,categoryParameters]);
 const categoryLabel=(v:string)=>dsrCategoryName(v);
 function eventAudit(event:VariableEvent){
  const rubric=rubrics.find(item=>item.id===event.rubric_id);
  if(!rubric)return "Rubrica de origem não localizada entre as ativas";
  if(!rubric.active||!rubric.affects_dsr||rubric.item_type!=="earning"||rubric.dsr_category!==event.dsr_category||rubric.code!==event.code||rubric.description!==event.description||event.item_type!==rubric.item_type)return "Divergência entre evento e cadastro da rubrica";
  const eventDate=event.event_date||month+"-01";
  const linkedSchedules=schedules.filter(schedule=>schedule.employee_id===event.employee_id&&schedule.dsr_rule_id&&schedule.dsr_rule_status==="validated"&&schedule.effective_from<=eventDate&&(!schedule.effective_to||schedule.effective_to>=eventDate));
  const validatedRuleIds=dsrRules.filter(rule=>rule.status==="validated"&&rule.validity_from&&rule.validity_from<=eventDate&&(!rule.validity_to||rule.validity_to>=eventDate)).map(rule=>rule.id);
  const applicableRuleIds=linkedSchedules.map(schedule=>schedule.dsr_rule_id).filter((id):id is string=>id!==null&&validatedRuleIds.includes(id));
  if(!applicableRuleIds.length)return "Sem escala e regra normativa validadas na data do evento";
  const hasParameter=categoryParameters.some(parameter=>applicableRuleIds.includes(parameter.dsr_rule_id)&&parameter.category===event.dsr_category&&parameter.status==="validated"&&parameter.effective_from<=eventDate&&(!parameter.effective_to||parameter.effective_to>=eventDate));
  return hasParameter?"Rubrica e parâmetro normativo conferidos":"Sem parâmetro normativo validado para a categoria";
 }
 const registerReview=async()=>{
  if(!canReview){setError("Seu perfil não possui permissão para registrar a conferência do DSR.");return;}
  if(reviewNote.trim().length<20){setError("Informe uma observação de conferência com pelo menos 20 caracteres.");return;}
  if(!organizationId||!currentUserId){setError("Não foi possível identificar a organização ou o responsável.");return;}
  setSavingReview(true);setError("");
  const blocked=reviewChecks.blockers>0;
  const s=createClient();
  const {error:saveError}=await s.from("audit_logs").insert({organization_id:organizationId,actor_user_id:currentUserId,action:blocked?"dsr_competence_review_blocked":"dsr_competence_review_ready_for_manual_approval",resource_type:"dsr_competence_review",resource_id:month+"-01",metadata:{competence:month,status:blocked?"blocked":"ready_for_manual_approval",blockers:reviewChecks.blockers,checks:reviewChecks.checks,note:reviewNote.trim(),financial_calculation_released:false}});
  if(saveError)setError("Não foi possível registrar a conferência: "+saveError.message);
  else{setReviewNote("");await load();}
  setSavingReview(false);
 };
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
   <div className="employee-stats payroll-stats">
    <div><span>Feriados sem classificação</span><b>{auditCounts.holidays}</b></div>
    <div><span>Dias previstos sem apontamento</span><b>{auditCounts.missing}</b></div>
    <div><span>Rascunhos/rejeitadas</span><b>{auditCounts.unresolved}</b></div>
    <div><span>Conflitos/divergências</span><b>{auditCounts.conflicts}</b></div>
    <div><span>Escalas sem regra validada</span><b>{auditCounts.unvalidated}</b></div>
    <div><span>Dias sem classificação</span><b>{auditCounts.unclassified}</b></div>
   </div>
   <div className="employee-list-card payroll-list">
    <div className="employee-list-head"><div><h2>Checklist técnico para conferência</h2><p>Os critérios abaixo controlam a prontidão documental. Mesmo sem pendências, a aprovação final do DP e o cálculo financeiro continuam separados.</p></div><span>{reviewChecks.blockers===0?"Sem bloqueios identificados":reviewChecks.blockers+" bloqueio(s)"}</span></div>
    <div className="table-scroll"><table className="employee-table"><thead><tr><th>Critério</th><th>Resultado</th><th>Detalhe</th></tr></thead><tbody>{reviewChecks.checks.map(check=><tr key={check.label}><td>{check.label}</td><td><span className="status-pill">{check.ok?"Conferido":"Pendente"}</span></td><td>{check.detail}</td></tr>)}</tbody></table></div>
    <p className="form-hint">Perfil atual: <b>{currentRole||"não identificado"}</b> · {canReview?"Pode registrar conferência.":"Apenas consulta; registro restrito a owner, admin, gerente de RH ou folha."}</p>
    <label className="review-note-label">Observação do responsável pela conferência<textarea value={reviewNote} onChange={e=>setReviewNote(e.target.value)} minLength={20} placeholder="Registre a análise realizada, documentos verificados e providências..." rows={3}/></label>
    <button className="employee-primary" onClick={()=>void registerReview()} disabled={savingReview||!canReview}>{savingReview?"Registrando...":"Registrar conferência da competência"}</button>
    <p className="form-hint">O registro cria histórico de auditoria com responsável, data/hora, checklist e observação. Não fecha a competência, não aprova automaticamente regras e não libera o cálculo financeiro.</p>
    {reviewHistory.length>0&&<><h3>Histórico de conferências</h3><div className="table-scroll"><table className="employee-table"><thead><tr><th>Data/hora</th><th>Responsável (ID)</th><th>Resultado</th><th>Observação</th></tr></thead><tbody>{reviewHistory.map((log,index)=><tr key={log.created_at+"-"+index}><td>{new Date(log.created_at).toLocaleString("pt-BR")}</td><td>{log.actor_user_id||"—"}</td><td><span className="status-pill">{log.action==="dsr_competence_review_blocked"?"Registrado com bloqueios":log.action==="dsr_competence_review_ready_for_manual_approval"?"Pronto para aprovação manual":log.action}</span></td><td>{String(log.metadata?.note||"—")}</td></tr>)}</tbody></table></div></>}
   </div>
   <div className="employee-list-card payroll-list">
    <div className="employee-list-head"><div><h2>Pendências da competência</h2><p>Conferência de todos os colaboradores ativos, considerando somente datas até hoje. Pendências não são convertidas automaticamente em faltas ou descontos.</p></div><span>{competenceAudit.length} pendência(s)</span></div>
    {!competenceAudit.length?<div className="employee-empty"><ClipboardList size={22}/><b>Nenhuma pendência identificada pelas regras atuais</b><p>Isso não substitui a conferência documental do DP nem valida automaticamente a competência.</p></div>:<div className="table-scroll"><table className="employee-table"><thead><tr><th>Data</th><th>Colaborador</th><th>Pendência</th><th>Detalhe / providência</th></tr></thead><tbody>{competenceAudit.map((item,index)=><tr key={item.date+"-"+item.employeeCode+"-"+item.issue+"-"+index}><td>{new Date(item.date+"T12:00:00").toLocaleDateString("pt-BR")}</td><td><b>{item.employee}</b><br/><small>{item.employeeCode}</small></td><td><span className="status-pill">{item.issue}</span></td><td>{item.detail}</td></tr>)}</tbody></table></div>}
   </div>
   <div className="employee-list-card payroll-list">
    <div className="employee-list-head"><div><h2>Conferência diária da jornada</h2><p>Compara o padrão da escala vigente com o apontamento de cada data. Dia sem registro não é classificado automaticamente como falta.</p></div><label>Colaborador<select value={selectedDailyEmployee} onChange={e=>setDailyEmployee(e.target.value)}><option value="">Selecione</option>{employees.map(x=><option key={x.id} value={x.id}>{x.employee_code} · {x.full_name}</option>)}</select></label></div>
    {!selectedDailyEmployee?<div className="employee-empty"><CalendarDays size={22}/><b>Selecione um colaborador</b></div>:<div className="table-scroll"><table className="employee-table"><thead><tr><th>Data</th><th>Escala</th><th>Dia previsto</th><th>Apontamento</th><th>Horas trabalhadas</th><th>Situação</th></tr></thead><tbody>{dailyRows.map(row=><tr key={row.date}><td>{row.dayLabel}</td><td>{row.scheduleLabel}</td><td>{row.dayType}</td><td>{row.occurrenceLabel}</td><td>{row.hoursLabel}</td><td><span className="status-pill">{row.statusLabel}{row.alert?" · conferir":""}</span></td></tr>)}</tbody></table></div>}
   </div>
   <div className="employee-list-card payroll-list">
    <div className="employee-list-head"><div><h2>Matriz de incidência das rubricas</h2><p>Conferência cadastral das rubricas ativas. A marcação de incidência não substitui a validação da norma aplicável.</p></div><span>{rubrics.length} rubrica(s)</span></div>
    {!rubrics.length?<div className="employee-empty"><ClipboardList size={22}/><b>Nenhuma rubrica ativa cadastrada</b><p>Cadastre e classifique as rubricas antes de habilitar eventos variáveis.</p></div>:
    <div className="table-scroll"><table className="employee-table"><thead><tr><th>Código / Rubrica</th><th>Tipo</th><th>Incidência cadastrada</th><th>Categoria DSR</th><th>Conferência</th></tr></thead><tbody>{rubrics.map(r=><tr key={r.id}><td><b>{r.code}</b><br/><small>{r.description}</small></td><td>{r.item_type==="earning"?"Provento":r.item_type==="deduction"?"Desconto":"Encargo patronal"}</td><td>{r.affects_dsr?"Sim":"Não"}</td><td>{categoryLabel(r.dsr_category)}</td><td>{r.affects_dsr&&r.item_type!=="earning"?"Inconsistência: incidência exige provento":r.affects_dsr&&r.dsr_category==="not_applicable"?"Categoria não definida":r.affects_dsr?"Exige parâmetro normativo validado":"Fora da base variável de DSR"}</td></tr>)}</tbody></table></div>}
   </div>
   <div className="employee-list-card payroll-list">
    <div className="employee-list-head"><div><h2>Regras normativas vinculadas às escalas</h2><p>Exibe a situação da regra e dos parâmetros por categoria, sem presumir direito ou fórmula universal.</p></div><span>{rulesInUse.length} regra(s) em uso</span></div>
    {!rulesInUse.length?<div className="employee-empty"><ShieldAlert size={22}/><b>Nenhuma regra normativa vinculada às escalas do período</b><p>Vincule a escala a uma regra validada e vigente para a competência.</p></div>:
    <div className="table-scroll"><table className="employee-table"><thead><tr><th>Regra / Fonte</th><th>Categoria profissional</th><th>Vigência na competência</th><th>Status</th><th>Parâmetros de parcelas variáveis</th></tr></thead><tbody>{rulesInUse.map(rule=>{
      const competenceStart=month+"-01";
      const competenceEnd=new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).toISOString().slice(0,10);
      const validFrom=Boolean(rule.validity_from&&rule.validity_from<=competenceStart);
      const validTo=!rule.validity_to||rule.validity_to>=competenceEnd;
      const ruleCurrent=validFrom&&validTo;
      const params=categoryParameters.filter(p=>p.dsr_rule_id===rule.id&&p.effective_from<=new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).toISOString().slice(0,10)&&(!p.effective_to||p.effective_to>=month+"-01"));
      const parameterText=["overtime","commission","additional","bonus","other"].map(cat=>{
       const p=params.filter(x=>x.category===cat&&x.status==="validated").sort((a,b)=>b.version-a.version)[0];
       return categoryLabel(cat)+": "+(p?(p.unit==="days"?"por dias":"por horas")+" · divisor "+Number(p.denominator).toLocaleString("pt-BR")+" · repousos "+Number(p.rest_units).toLocaleString("pt-BR"):"sem parâmetro validado");
      });
      return <tr key={rule.id}><td><b>{rule.rule_name}</b><br/><small>{rule.source_type.toUpperCase()} · {rule.union_name||"Entidade não informada"}</small></td><td>{rule.professional_category||"Não informada"}</td><td>{!rule.validity_from?"Vigência inicial não informada":ruleCurrent?"Vigente no período":"Fora da vigência"}</td><td>{rule.status==="suspended"?"Suspensa":rule.status!=="validated"?"Pendente de validação":!rule.validity_from?"Validade incompleta":ruleCurrent?"Validada e vigente":"Validada, fora da vigência"}</td><td>{parameterText.map(t=><div key={t}><small>{t}</small></div>)}</td></tr>;
    })}</tbody></table></div>}
   </div>
   <div className="employee-list-card payroll-list">
    <div className="employee-list-head"><div><h2>Eventos variáveis com incidência de DSR</h2><p>Valores são exibidos apenas para conferência da base informativa; não representam DSR calculado.</p></div><span>{events.length} evento(s)</span></div>
    {!events.length?<div className="employee-empty"><Clock size={22}/><b>Nenhum evento com incidência de DSR</b><p>Eventos aprovados serão listados aqui para compor a futura memória de cálculo.</p></div>:
    <div className="table-scroll"><table className="employee-table"><thead><tr><th>Colaborador</th><th>Data</th><th>Rubrica</th><th>Classificação DSR</th><th>Valor do evento</th><th>Conferência da origem</th><th>Situação</th></tr></thead><tbody>{events.map(x=><tr key={x.id}><td>{employees.find(e=>e.id===x.employee_id)?.full_name||"Colaborador"}</td><td>{x.event_date?new Date(x.event_date+"T12:00:00").toLocaleDateString("pt-BR"):"—"}</td><td>{x.code} · {x.description}</td><td>{dsrCategoryName(x.dsr_category)}</td><td>{money(eventAmount(x))}</td><td>{eventAudit(x)}</td><td>{x.status==="approved"?"Aprovado":x.status==="processed"?"Já processado na folha":"Pendente de aprovação"}</td></tr>)}</tbody></table></div>}
   </div>
   <div className="dependent-privacy"><Clock size={16}/><span>Atualizado em {refreshed||"—"}. Próxima etapa: vincular a regra do DSR à convenção/acordo coletivo aplicável e ao regime de jornada, validar a cobertura diária e somente então liberar o cálculo financeiro e a integração atômica com a folha.</span></div>
  </section>
 </main>;
}
