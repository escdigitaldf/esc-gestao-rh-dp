"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, History, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Props={organizationId:string;employeeId:string;terminationDate:string};
type EmployeeBase={admission_date:string|null;salary_amount:number|null;salary_type:string|null;employment_type:string|null;weekly_hours:number|null};
type SalaryRow={id:string;salary_amount:number;salary_type:string;effective_from:string;effective_to:string|null;change_reason:string|null};
const brl=(v:number)=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const date=(v:string|null)=>v?new Date(v+"T12:00:00").toLocaleDateString("pt-BR"):"Em aberto";

export default function TerminationCaseDataPanel({organizationId,employeeId,terminationDate}:Props){
 const [base,setBase]=useState<EmployeeBase|null>(null);
 const [history,setHistory]=useState<SalaryRow[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 useEffect(()=>{let active=true;async function load(){
  setLoading(true);setError("");
  const s=createClient();
  const [employeeResult,historyResult]=await Promise.all([
   s.from("employees").select("admission_date,salary_amount,salary_type,employment_type,weekly_hours").eq("organization_id",organizationId).eq("id",employeeId).maybeSingle(),
   s.from("employee_salary_history").select("id,salary_amount,salary_type,effective_from,effective_to,change_reason").eq("organization_id",organizationId).eq("employee_id",employeeId).lte("effective_from",terminationDate).order("effective_from",{ascending:false})
  ]);
  if(!active)return;
  if(employeeResult.error||historyResult.error){setError(employeeResult.error?.message||historyResult.error?.message||"Não foi possível carregar os dados contratuais.");}
  setBase((employeeResult.data||null) as EmployeeBase|null);
  setHistory((historyResult.data||[]) as SalaryRow[]);
  setLoading(false);
 }void load();return()=>{active=false};},[organizationId,employeeId,terminationDate]);
 if(loading)return <section className="payroll-create"><p>Carregando dados-base e histórico salarial...</p></section>;
 if(error)return <div className="notice error">{error}</div>;
 const salaryAtDate=history.find(x=>x.effective_from<=terminationDate&&(!x.effective_to||x.effective_to>=terminationDate));
 const warnings:string[]=[];
 if(!base?.admission_date)warnings.push("Data de admissão não cadastrada.");
 if(!salaryAtDate)warnings.push("Não há faixa do histórico salarial que comprove o salário vigente na data do desligamento.");
 if(!history.length)warnings.push("Histórico salarial não localizado; conferir cadastro e documentos contratuais.");
 if(base?.salary_type&&base.salary_type!=="monthly")warnings.push("Tipo salarial diferente de mensal; médias e critérios específicos precisam de revisão.");
 return <section className="payroll-create">
  <div><div className="form-kicker">CONFERÊNCIA PRELIMINAR</div><h2>Dados contratuais e histórico salarial</h2><p>Informações consultadas no cadastro e no histórico até a data do desligamento. Nenhuma verba é calculada nesta etapa.</p></div>
  <div className="employee-stats payroll-stats">
   <div><span>Admissão</span><b>{date(base?.admission_date||null)}</b></div>
   <div><span>Salário comprovado na data</span><b>{salaryAtDate?brl(Number(salaryAtDate.salary_amount)):"Sem faixa histórica"}</b></div>
   <div><span>Salário no cadastro atual</span><b>{base?.salary_amount!==null&&base?.salary_amount!==undefined?brl(Number(base.salary_amount)):"Não informado"}</b></div>
   <div><span>Jornada semanal</span><b>{base?.weekly_hours?Number(base.weekly_hours)+" horas":"Não informada"}</b></div>
  </div>
  {warnings.length>0?<div className="dependent-privacy"><AlertTriangle size={17}/><div><b>Pontos que exigem conferência</b><ul>{warnings.map(x=><li key={x}>{x}</li>)}</ul></div></div>:<div className="dependent-privacy"><ShieldCheck size={17}/><span>Dados cadastrais básicos localizados. Ainda é necessária a conferência documental e de médias variáveis.</span></div>}
  <div className="employee-list-head"><div><h3><History size={16}/> Histórico salarial</h3><p>{history.length} alteração(ões) registrada(s) até a data de desligamento.</p></div></div>
  {!history.length?<div className="employee-empty">Sem histórico salarial registrado para este colaborador.</div>:<div className="table-scroll"><table className="employee-table"><thead><tr><th>Vigência inicial</th><th>Vigência final</th><th>Salário</th><th>Tipo</th><th>Motivo</th><th>Vigente no desligamento</th></tr></thead><tbody>{history.map(x=><tr key={x.id}><td>{date(x.effective_from)}</td><td>{date(x.effective_to)}</td><td><b>{brl(Number(x.salary_amount))}</b></td><td>{x.salary_type}</td><td>{x.change_reason||"—"}</td><td>{salaryAtDate?.id===x.id?"Sim":"—"}</td></tr>)}</tbody></table></div>}
  <div className="dependent-privacy"><CalendarClock size={16}/><span>O salário cadastral atual não é tratado como salário histórico. A remuneração da data só é considerada identificada quando existe faixa de vigência compatível no histórico. Médias, adicionais, comissões, variáveis, reajustes retroativos e normas coletivas exigem conferência própria.</span></div>
 </section>;
}
