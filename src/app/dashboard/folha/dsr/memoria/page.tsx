"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import {ArrowLeft,CalendarDays,Clock,ShieldAlert,ClipboardList,RefreshCw} from "lucide-react";
import {createClient} from "@/lib/supabase/client";
import {calculateDsrPreview} from "@/lib/payroll/dsr-calculator.mjs";
import {summarizeDsrRemuneration} from "@/lib/payroll/dsr-remuneration.mjs";
import {calculateDsrCategoryPreviews} from "@/lib/payroll/dsr-category-preview.mjs";

type Employee={id:string;employee_code:string;full_name:string;employment_status:string};
type Schedule={id:string;employee_id:string;schedule_name:string;schedule_type:string;effective_from:string;effective_to:string|null;dsr_rule_status:string;dsr_rule_id:string|null;weekly_hours:number|null;cycle_days:number|null};
type DsrRule={id:string;rule_name:string;status:string;validity_from:string|null;validity_to:string|null;calculation_method:string|null;calculation_parameters:{divisor?:number}|null};
type Occurrence={id:string;employee_id:string;work_schedule_id:string;occurrence_date:string;occurrence_type:string;scheduled_hours:number;worked_hours:number;record_status:string};
type VariableEvent={id:string;employee_id:string;rubric_id:string|null;code:string;description:string;item_type:"earning"|"deduction"|"employer_charge";dsr_category:string;affects_dsr:boolean;amount:number|null;quantity:number;unit_value:number;status:string;event_date:string|null};
type Summary={employee:Employee;schedules:Schedule[];occurrences:Occurrence[];events:VariableEvent[];scheduled:number;worked:number;draft:number;validated:number;rejected:number;missingDays:number;ruleOk:boolean;overlapDays:number;pendingEvents:number;ready:boolean;blockers:string[]};

const monthEndDate=(v:string)=>new Date(Date.UTC(Number(v.slice(0,4)),Number(v.slice(5,7)),0)).toISOString().slice(0,10);
const monthName=(v:string)=>new Date(v+"-15T12:00:00").toLocaleDateString("pt-BR",{month:"long",year:"numeric"});
const money=(v:number)=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const hours=(v:number)=>Number(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})+" h";
const typeName=(v:string)=>({fixed_weekly:"Semanal fixa",rotating:"Revezamento",twelve_by_thirty_six:"12x36",custom:"Personalizada"} as Record<string,string>)[v]||v;

export default function DsrMemoryPage(){
 const router=useRouter();
 const [month,setMonth]=useState(new Date().toISOString().slice(0,7));
 const [employees,setEmployees]=useState<Employee[]>([]);
 const [schedules,setSchedules]=useState<Schedule[]>([]);
 const [occurrences,setOccurrences]=useState<Occurrence[]>([]);
 const [events,setEvents]=useState<VariableEvent[]>([]);
 const [rules,setRules]=useState<DsrRule[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [refreshed,setRefreshed]=useState("");
 const [previewEmployeeId,setPreviewEmployeeId]=useState("");
 const [categoryInputs,setCategoryInputs]=useState<Record<string,{denominator:string;restUnits:string;unit:"days"|"hours"}>>({});

 const load=useCallback(async()=>{
  setLoading(true);setError("");
  const s=createClient();
  const {data:{user},error:authError}=await s.auth.getUser();
  if(authError||!user){router.replace("/");return;}
  const {data:membership,error:membershipError}=await s.from("organization_memberships").select("organization_id").eq("user_id",user.id).eq("status","active").limit(1).maybeSingle();
  if(membershipError||!membership){setError(membershipError?.message||"Organização não encontrada.");setLoading(false);return;}
  const start=month+"-01";
  const end=monthEndDate(month);
  const [emp,sch,occ,ev,ruleRows]=await Promise.all([
   s.from("employees").select("id,employee_code,full_name,employment_status").eq("organization_id",membership.organization_id).order("full_name"),
   s.from("employee_work_schedules").select("id,employee_id,schedule_name,schedule_type,effective_from,effective_to,dsr_rule_status,dsr_rule_id,weekly_hours,cycle_days").eq("organization_id",membership.organization_id).lte("effective_from",end).or("effective_to.is.null,effective_to.gte."+start),
   s.from("employee_work_occurrences").select("id,employee_id,work_schedule_id,occurrence_date,occurrence_type,scheduled_hours,worked_hours,record_status").eq("organization_id",membership.organization_id).gte("occurrence_date",start).lte("occurrence_date",end).order("occurrence_date"),
   s.from("payroll_variable_events").select("id,employee_id,rubric_id,code,description,item_type,dsr_category,affects_dsr,amount,quantity,unit_value,status,event_date").eq("organization_id",membership.organization_id).eq("competence",start).eq("affects_dsr",true).order("event_date"),
   s.from("organization_dsr_rules").select("id,rule_name,status,validity_from,validity_to,calculation_method,calculation_parameters").eq("organization_id",membership.organization_id)
  ]);
  const issue=emp.error||sch.error||occ.error||ev.error||ruleRows.error;
  if(issue)setError(issue.message);
  setEmployees((emp.data||[]) as Employee[]);
  setSchedules((sch.data||[]) as Schedule[]);
  setOccurrences((occ.data||[]) as Occurrence[]);
  setEvents((ev.data||[]) as VariableEvent[]);
  setRules((ruleRows.data||[]) as DsrRule[]);
  setRefreshed(new Date().toLocaleString("pt-BR"));
  setLoading(false);
 },[router,month]);

 useEffect(()=>{void load()},[load]);
 const summaries=useMemo<Summary[]>(()=>employees.map(employee=>{
  const employeeSchedules=schedules.filter(x=>x.employee_id===employee.id);
  const employeeOccurrences=occurrences.filter(x=>x.employee_id===employee.id);
  const employeeEvents=events.filter(x=>x.employee_id===employee.id);
  const monthStart=month+"-01";
  const monthEnd=monthEndDate(month);
  const expectedByDate=new Map<string,string[]>();
  for(const schedule of employeeSchedules){
   const from=schedule.effective_from>monthStart?schedule.effective_from:monthStart;
   const to=schedule.effective_to&&schedule.effective_to<monthEnd?schedule.effective_to:monthEnd;
   if(to<from)continue;
   const cursor=new Date(from+"T12:00:00");
   const last=new Date(to+"T12:00:00");
   while(cursor<=last){
    const day=cursor.toISOString().slice(0,10);
    expectedByDate.set(day,[...(expectedByDate.get(day)||[]),schedule.id]);
    cursor.setDate(cursor.getDate()+1);
   }
  }
  const validatedByDate=new Map<string,Occurrence[]>();
  employeeOccurrences.filter(x=>x.record_status==="validated").forEach(x=>{
   validatedByDate.set(x.occurrence_date,[...(validatedByDate.get(x.occurrence_date)||[]),x]);
  });
  let missingDays=0,overlapDays=0;
  for(const [day,expectedSchedules] of expectedByDate){
   const validatedRows=validatedByDate.get(day)||[];
   if(expectedSchedules.length!==1){overlapDays++;continue;}
   if(validatedRows.length!==1||validatedRows[0].work_schedule_id!==expectedSchedules[0])missingDays++;
  }
  const ruleOk=employeeSchedules.length>0&&employeeSchedules.every(schedule=>{
   const rule=rules.find(x=>x.id===schedule.dsr_rule_id);
   const divisor=Number(rule?.calculation_parameters?.divisor??30);
   if(!rule||rule.status!=="validated"||schedule.dsr_rule_status!=="validated"||!rule.calculation_method||!Number.isFinite(divisor)||divisor<=0||divisor>31)return false;
   const from=schedule.effective_from>monthStart?schedule.effective_from:monthStart;
   const to=schedule.effective_to&&schedule.effective_to<monthEnd?schedule.effective_to:monthEnd;
   return (!rule.validity_from||from>=rule.validity_from)&&(!rule.validity_to||to<=rule.validity_to);
  });
  const pendingEvents=employeeEvents.filter(x=>x.status==="pending").length;
  const draft=employeeOccurrences.filter(x=>x.record_status==="draft").length;
  const rejected=employeeOccurrences.filter(x=>x.record_status==="rejected").length;
  const blockers:string[]=[];
  if(!employeeSchedules.length)blockers.push("Sem escala vigente");
  if(!ruleOk)blockers.push("Regra normativa ou critério de cálculo ausente, pendente ou fora da vigência");
  if(overlapDays)blockers.push(overlapDays+" dia(s) com sobreposição de escalas");
  if(missingDays)blockers.push(missingDays+" dia(s) sem apontamento diário validado");
  if(draft)blockers.push(draft+" ocorrência(s) em rascunho");
  if(rejected)blockers.push(rejected+" ocorrência(s) rejeitada(s) sem substituição validada");
  if(pendingEvents)blockers.push(pendingEvents+" evento(s) variável(is) pendente(s)");
  return {employee,schedules:employeeSchedules,occurrences:employeeOccurrences,events:employeeEvents,
   scheduled:employeeOccurrences.filter(x=>x.record_status==="validated").reduce((a,x)=>a+Number(x.scheduled_hours||0),0),
   worked:employeeOccurrences.filter(x=>x.record_status==="validated").reduce((a,x)=>a+Number(x.worked_hours||0),0),
   draft,validated:employeeOccurrences.filter(x=>x.record_status==="validated").length,rejected,
   missingDays,ruleOk,overlapDays,pendingEvents,ready:blockers.length===0,blockers};
 }),[employees,schedules,occurrences,events,rules,month]);
 const previewEmployee=summaries.find(x=>x.employee.id===(previewEmployeeId||employees[0]?.id));
 const eventValue=(x:VariableEvent)=>Number(x.amount??(Number(x.quantity||0)*Number(x.unit_value||0)));
 const remuneration=useMemo(()=>summarizeDsrRemuneration(previewEmployee?.events||[]),[previewEmployee?.events]);
 const previewEarnings=remuneration.earnings;
 const previewDeductions=remuneration.deductions;
 const previewEmployerCharges=remuneration.employerCharges;
 const dsrCategoryTotals=["overtime","commission","additional","bonus","other"].map(category=>({category,events:previewEarnings.filter(x=>x.dsr_category===category),amount:remuneration.categories[category as keyof typeof remuneration.categories].amount}));
 const previewBase=remuneration.earningsTotal;
 const categoryPreviews=useMemo(()=>calculateDsrCategoryPreviews({
  categories:Object.fromEntries(dsrCategoryTotals.map(group=>[group.category,{amount:group.amount,count:group.events.length}])),
  parameters:categoryInputs
 }),[dsrCategoryTotals,categoryInputs]);
 const populatedCategories=dsrCategoryTotals.filter(group=>group.amount>0);
 const categoryPreviewComplete=previewEmployee?.ready&&populatedCategories.length>0&&populatedCategories.every(group=>categoryPreviews[group.category as keyof typeof categoryPreviews]?.status==="calculated");
 const categoryPreviewTotal=categoryPreviewComplete?populatedCategories.reduce((sum,group)=>sum+Number(categoryPreviews[group.category as keyof typeof categoryPreviews].result?.amount||0),0):null;
 const totals=useMemo(()=>({draft:occurrences.filter(x=>x.record_status==="draft").length,validated:occurrences.filter(x=>x.record_status==="validated").length,rejected:occurrences.filter(x=>x.record_status==="rejected").length,unvalidatedSchedules:schedules.filter(x=>x.dsr_rule_status!=="validated").length,dsrEvents:events.length,approvedEvents:events.filter(x=>x.status==="approved"||x.status==="processed").length,pendingEvents:events.filter(x=>x.status==="pending").length,readyEmployees:summaries.filter(x=>x.ready).length,blockedEmployees:summaries.filter(x=>!x.ready).length}),[occurrences,schedules,events,summaries]);

 if(loading)return <div className="loading-screen">Preparando memória preliminar do DSR...</div>;
 return <main className="module-shell">
  <header className="module-top"><a href="/dashboard/folha/dsr"><ArrowLeft size={16}/> Jornadas e DSR</a><b><span className="brand-mark">ESC</span> Gestão de RH e DP</b><span>Memória preliminar</span></header>
  <section className="module-content payroll-content">
   <div className="module-heading"><div><div className="form-kicker">DEPARTAMENTO PESSOAL · CONFERÊNCIA</div><h1>Memória preliminar do DSR</h1><p>Conferência de cobertura diária, vigência normativa e eventos variáveis antes da apuração financeira.</p></div><div className="salary-history-icon"><ClipboardList size={24}/></div></div>
   {error&&<div className="notice error">{error}</div>}
   <div className="dependent-privacy"><ShieldAlert size={17}/><span><b>Prévia sem lançamento financeiro.</b> A tela identifica cobertura diária incompleta, sobreposição de escalas, regras sem validação e eventos pendentes. Ainda não calcula valores nem altera a folha. “Dados completos” significa apenas que os cadastros passaram pelas verificações operacionais; a fórmula do DSR ainda depende de parametrização normativa validada.</span></div>
   <div className="employee-list-card payroll-list"><div className="employee-list-head"><div><h2>Competência analisada</h2><p>{monthName(month)}</p></div><label>Competência<input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label><button className="employee-secondary" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/> Atualizar</button></div></div>
   <div className="employee-stats payroll-stats">
    <div><span>Ocorrências validadas</span><b>{totals.validated}</b></div>
    <div><span>Pendentes de validação</span><b>{totals.draft}</b></div>
    <div><span>Escalas sem regra validada</span><b>{totals.unvalidatedSchedules}</b></div>
    <div><span>Eventos com incidência DSR</span><b>{totals.dsrEvents}</b></div>
    <div><span>Prontos para análise técnica</span><b>{totals.readyEmployees}</b></div>
   </div>
   <section className="employee-list-card payroll-list dsr-preview-panel">
    <div className="employee-list-head"><div><h2>Simulação controlada do DSR</h2><p>Prévia matemática sobre eventos variáveis aprovados/processados, com parâmetros informados manualmente.</p></div><span className="dsr-private-tag">PREVIEW · NÃO INTEGRA A FOLHA</span></div>
    <div className="dsr-preview-body">
     <div className="dsr-preview-warning"><ShieldAlert size={16}/><span>O sistema não presume divisor legal, quantidade de repousos, feriados ou natureza de rubricas. Confirme os parâmetros na regra normativa validada antes de utilizar qualquer resultado.</span></div>
     <div className="dsr-category-calculation-intro">
      <b>Apuração individual por natureza da verba</b>
      <span>Cada categoria exige seus próprios parâmetros, informados conforme a regra normativa validada. O sistema não copia denominadores, repousos ou unidades de uma categoria para outra.</span>
     </div>
     <div className="dsr-preview-fields dsr-category-selector">
      <label>Colaborador<select value={previewEmployee?.employee.id||""} onChange={e=>setPreviewEmployeeId(e.target.value)}><option value="">Selecione</option>{employees.map(e=><option key={e.id} value={e.id}>{e.full_name} · {e.employee_code}</option>)}</select></label>
      <div className="dsr-category-readiness"><span>Condição operacional</span><b>{previewEmployee?.ready?"Dados operacionais completos":"Bloqueado para prévia"}</b><small>{previewEmployee?.ready?"Escala, regra e ocorrências passaram pelas verificações.":"Ajuste os bloqueios de escala, regra ou ocorrências antes de simular."}</small></div>
     </div>
     <div className="dsr-category-calculation-grid">
      {dsrCategoryTotals.map(group=>{
       const key=group.category;
       const input=categoryInputs[key]||{denominator:"",restUnits:"",unit:"days" as const};
       const result=categoryPreviews[key as keyof typeof categoryPreviews];
       const categoryName=({overtime:"Horas extras",commission:"Comissões",additional:"Adicionais",bonus:"Prêmios / gratificações",other:"Outros proventos"} as Record<string,string>)[key];
       return <article className="dsr-category-calculation-card" key={key}>
        <div className="dsr-category-calculation-head"><div><b>{categoryName}</b><small>{group.events.length} evento(s) aprovado(s)/processado(s)</small></div><strong>{money(group.amount)}</strong></div>
        {group.amount>0?<div className="dsr-category-calculation-fields">
         <label>Unidade<select value={input.unit} onChange={e=>setCategoryInputs(current=>({...current,[key]:{...input,unit:e.target.value as "days"|"hours"}}))}><option value="days">Dias</option><option value="hours">Horas</option></select></label>
         <label>Denominador<input type="number" min="0.01" step="0.01" value={input.denominator} onChange={e=>setCategoryInputs(current=>({...current,[key]:{...input,denominator:e.target.value}}))} placeholder="Conforme a regra"/></label>
         <label>Repousos / unidades<input type="number" min="0" step="0.01" value={input.restUnits} onChange={e=>setCategoryInputs(current=>({...current,[key]:{...input,restUnits:e.target.value}}))} placeholder="Conforme a regra"/></label>
        </div>:<p className="dsr-category-empty">Não há eventos aprovados nesta categoria nesta competência.</p>}
        <div className="dsr-category-result"><span>Prévia desta categoria</span><b>{!previewEmployee?.ready?"Bloqueada":result.status==="calculated"?money(Number(result.result?.amount||0)):result.status==="not_applicable"?"Não aplicável":"—"}</b><small>{!previewEmployee?.ready?"Conferência operacional pendente":result.message}</small></div>
        {result.status==="calculated"&&result.result?.audit&&<div className="dsr-category-audit"><code>{money(group.amount)} ÷ {Number(result.result.audit.denominator).toLocaleString("pt-BR")} × {Number(result.result.audit.restUnits).toLocaleString("pt-BR")} = {money(Number(result.result.amount||0))}</code><small>Unidade: {result.result.audit.unit==="days"?"dias":"horas"} · Arredondamento ao final</small></div>}
       </article>;
      })}
     </div>
     <div className="dsr-category-total"><div><span>Total das categorias calculadas</span><b>{categoryPreviewTotal===null?"Aguardando parâmetros completos":money(categoryPreviewTotal)}</b></div><small>O total só é apresentado quando todas as categorias com base possuem parâmetros válidos e a conferência operacional está liberada. Resultado exclusivamente informativo; não gera lançamento na folha.</small></div>
     <div className="dsr-preview-classification"><div><span>Descontos (fora da base)</span><b>{money(remuneration.deductionsTotal)}</b><small>{previewDeductions.length} evento(s) aprovado(s)</small></div><div><span>Encargos patronais (fora da base)</span><b>{money(remuneration.employerChargesTotal)}</b><small>{previewEmployerCharges.length} evento(s) aprovado(s)</small></div><div><span>Eventos pendentes de aprovação</span><b>{remuneration.pending.length}</b><small>Não compõem a prévia</small></div></div>
     {previewResult?.ok&&previewResult.audit&&<div className="dsr-preview-audit"><b>Memória da simulação</b><code>{money(Number(previewResult.audit.baseAmount??0))} ÷ {previewResult.audit.denominator.toLocaleString("pt-BR")} × {previewResult.audit.restUnits.toLocaleString("pt-BR")} = {money(Number(previewResult.amount??0))}</code><small>Arredondamento comercial ao final · Unidade: {previewResult.audit.unit==="days"?"dias":"horas"} · Precisão: 2 casas decimais</small></div>}
     {!previewEmployee&&<p className="dsr-preview-hint">Selecione um colaborador para visualizar a base variável disponível.</p>}
    </div>
   </section>
   <div className="employee-list-card payroll-list">
    <div className="employee-list-head"><div><h2>Consolidação por colaborador</h2><p>Horas abaixo consideram somente ocorrências validadas.</p></div><span>{summaries.length} colaborador(es)</span></div>
    {!summaries.length?<div className="employee-empty"><CalendarDays size={22}/><b>Nenhum colaborador cadastrado</b><p>Cadastre colaboradores para iniciar a conferência de jornadas.</p></div>:
    <div className="table-scroll"><table className="employee-table"><thead><tr><th>Colaborador</th><th>Escala vigente</th><th>Ocorrências</th><th>Horas previstas validadas</th><th>Horas trabalhadas validadas</th><th>Eventos DSR aprovados</th><th>Conferência de dados</th></tr></thead><tbody>
     {summaries.map(row=>{
      const approved=row.events.filter(x=>x.status==="approved"||x.status==="processed");
      const pending=row.events.filter(x=>x.status==="pending");
      const condition=row.ready?"Dados completos — aguarda fórmula validada":row.blockers.join(" · ");
      return <tr key={row.employee.id}>
       <td><b>{row.employee.full_name}</b><br/><small>{row.employee.employee_code}</small></td>
       <td>{row.schedules.length?row.schedules.map(x=><div key={x.id}>{x.schedule_name}<br/><small>{typeName(x.schedule_type)} · {x.dsr_rule_status==="validated"?"Regra validada":"Regra pendente"}</small></div>):"Sem escala"}</td>
       <td>{row.validated} validadas · {row.draft} rascunhos · {row.rejected} rejeitadas</td>
       <td>{hours(row.scheduled)}</td><td>{hours(row.worked)}</td>
       <td>{approved.length} aprovados{pending.length?" · "+pending.length+" pendentes":""}{approved.length>0&&<small><br/>Base informativa: {money(approved.reduce((a,x)=>a+Number(x.amount??(Number(x.quantity||0)*Number(x.unit_value||0))),0))}</small>}</td>
       <td><span className="status-pill">{condition}</span></td>
      </tr>;
     })}
    </tbody></table></div>}
   </div>
   <div className="employee-list-card payroll-list">
    <div className="employee-list-head"><div><h2>Eventos variáveis com incidência de DSR</h2><p>Valores são exibidos apenas para conferência da base informativa; não representam DSR calculado.</p></div><span>{events.length} evento(s)</span></div>
    {!events.length?<div className="employee-empty"><Clock size={22}/><b>Nenhum evento com incidência de DSR</b><p>Eventos aprovados serão listados aqui para compor a futura memória de cálculo.</p></div>:
    <div className="table-scroll"><table className="employee-table"><thead><tr><th>Colaborador</th><th>Data</th><th>Rubrica / classificação</th><th>Valor do evento</th><th>Situação</th></tr></thead><tbody>{events.map(x=><tr key={x.id}><td>{employees.find(e=>e.id===x.employee_id)?.full_name||"Colaborador"}</td><td>{x.event_date?new Date(x.event_date+"T12:00:00").toLocaleDateString("pt-BR"):"—"}</td><td>{x.code} · {x.description}<br/><small>{x.item_type==="earning"?"Provento":x.item_type==="deduction"?"Desconto":"Encargo patronal"} · {({overtime:"Horas extras",commission:"Comissões",additional:"Adicionais",bonus:"Prêmios/gratificações",other:"Outros proventos",not_applicable:"Não aplicável"} as Record<string,string>)[x.dsr_category]||"Sem classificação DSR"}</small></td><td>{money(eventValue(x))}</td><td>{({pending:"Pendente",approved:"Aprovado",rejected:"Rejeitado",processed:"Processado"} as Record<string,string>)[x.status]||x.status}</td></tr>)}</tbody></table></div>}
   </div>
   <div className="dependent-privacy"><Clock size={16}/><span>Atualizado em {refreshed||"—"}. A conferência considera um apontamento diário validado para cada data coberta pela escala. Isso não substitui a validação da fórmula legal/coletiva. Próxima etapa: definir critérios financeiros por regra validada, criar casos de teste e só depois integrar à folha.</span></div>
  </section>
 </main>;
}
