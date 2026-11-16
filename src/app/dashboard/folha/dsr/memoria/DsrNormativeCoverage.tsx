"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase/client";

type Employee={id:string;employee_code:string;full_name:string;work_regime:string|null;union_name:string|null;position_id:string|null;employment_status:string};
type Rule={id:string;rule_name:string;professional_category:string|null;union_name:string|null;source_type:string;status:string;validity_from:string|null;validity_to:string|null};
type Assignment={id:string;employee_id:string;dsr_rule_id:string;professional_category:string;collective_instrument:string;work_regime:string;validity_from:string;validity_to:string|null;source_reference:string;justification:string;status:string;created_by:string;validated_by:string|null;validated_at:string|null;validation_note:string|null};
type Props={month:string};
const today=()=>new Date().toISOString().slice(0,10);
export default function DsrNormativeCoverage({month}:Props){
 const [org,setOrg]=useState("");const [user,setUser]=useState("");const [role,setRole]=useState("");
 const [employees,setEmployees]=useState<Employee[]>([]);const [rules,setRules]=useState<Rule[]>([]);const [rows,setRows]=useState<Assignment[]>([]);
 const [employeeId,setEmployeeId]=useState("");const [ruleId,setRuleId]=useState("");const [category,setCategory]=useState("");const [instrument,setInstrument]=useState("");
 const [regime,setRegime]=useState("");const [from,setFrom]=useState(month+"-01");const [to,setTo]=useState("");
 const [source,setSource]=useState("");const [reason,setReason]=useState("");const [decisionNote,setDecisionNote]=useState("");
 const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false);const [error,setError]=useState("");const [info,setInfo]=useState("");
 const canManage=["owner","admin","hr_manager","payroll"].includes(role);
 const load=useCallback(async()=>{
  const s=createClient();setLoading(true);setError("");
  const {data:{user:u},error:authError}=await s.auth.getUser();if(authError||!u){setError("Sessão não identificada.");setLoading(false);return;}
  const {data:m,error:memberError}=await s.from("organization_memberships").select("organization_id,role").eq("user_id",u.id).eq("status","active").limit(1).maybeSingle();
  if(memberError||!m){setError(memberError?.message||"Organização não encontrada.");setLoading(false);return;}
  setOrg(m.organization_id);setUser(u.id);setRole(m.role||"");
  const [e,r,a]=await Promise.all([
   s.from("employees").select("id,employee_code,full_name,work_regime,union_name,position_id,employment_status").eq("organization_id",m.organization_id).eq("employment_status","active").order("full_name"),
   s.from("organization_dsr_rules").select("id,rule_name,professional_category,union_name,source_type,status,validity_from,validity_to").eq("organization_id",m.organization_id).order("rule_name"),
   s.from("employee_dsr_normative_assignments").select("id,employee_id,dsr_rule_id,professional_category,collective_instrument,work_regime,validity_from,validity_to,source_reference,justification,status,created_by,validated_by,validated_at,validation_note").eq("organization_id",m.organization_id).order("created_at",{ascending:false}).limit(500)
  ]);
  if(e.error||r.error||a.error)setError(e.error?.message||r.error?.message||a.error?.message||"Falha ao carregar cobertura normativa.");
  setEmployees((e.data||[]) as Employee[]);setRules((r.data||[]) as Rule[]);setRows((a.data||[]) as Assignment[]);
  setLoading(false);
 },[]);
 useEffect(()=>{void load()},[load]);
 useEffect(()=>{setFrom(month+"-01")},[month]);
 const employeeMap=useMemo(()=>new Map(employees.map(x=>[x.id,x])),[employees]);
 const ruleMap=useMemo(()=>new Map(rules.map(x=>[x.id,x])),[rules]);
 const coverage=useMemo(()=>employees.map(e=>{
  const matches=rows.filter(a=>a.employee_id===e.id&&a.status==="validated"&&a.validity_from<=month+"-01"&&(!a.validity_to||a.validity_to>=new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).toISOString().slice(0,10)));
  return {employee:e,assignment:matches.sort((a,b)=>b.validity_from.localeCompare(a.validity_from))[0]||null,count:matches.length};
 }),[employees,rows,month]);
 const submit=async()=>{
  if(!canManage||!employeeId||!ruleId||category.trim().length<2||instrument.trim().length<3||regime.trim().length<2||source.trim().length<3||reason.trim().length<20){setError("Preencha todos os campos obrigatórios. A justificativa deve conter ao menos 20 caracteres.");return;}
  setSaving(true);setError("");setInfo("");const s=createClient();
  const {error:e}=await s.rpc("request_employee_dsr_normative_assignment",{p_organization_id:org,p_employee_id:employeeId,p_dsr_rule_id:ruleId,p_professional_category:category.trim(),p_collective_instrument:instrument.trim(),p_work_regime:regime.trim(),p_validity_from:from,p_validity_to:to||null,p_source_reference:source.trim(),p_justification:reason.trim()});
  if(e)setError(e.message);else{setInfo("Solicitação registrada e aguardando validação por outro responsável.");setReason("");setSource("");await load();}
  setSaving(false);
 };
 const decide=async(id:string,decision:"validate"|"reject")=>{
  if(decisionNote.trim().length<20){setError("A justificativa da decisão deve conter ao menos 20 caracteres.");return;}
  setSaving(true);setError("");const s=createClient();const {error:e}=await s.rpc("decide_employee_dsr_normative_assignment",{p_assignment_id:id,p_decision:decision,p_note:decisionNote.trim()});
  if(e)setError(e.message);else{setInfo(decision==="validate"?"Enquadramento normativo validado.":"Solicitação rejeitada.");setDecisionNote("");await load();}
  setSaving(false);
 };
 return <section className="employee-list-card payroll-list">
  <div className="employee-list-head"><div><h2>Cobertura normativa por colaborador</h2><p>Relaciona categoria profissional, instrumento coletivo, regime de jornada e regra DSR com vigência documentada. A escala, isoladamente, não define o enquadramento jurídico.</p></div><span>{coverage.filter(x=>x.assignment).length}/{employees.length} enquadrados</span></div>
  {error&&<p className="form-error" role="alert">{error}</p>}{info&&<p className="form-hint">{info}</p>}
  {loading?<p>Carregando cobertura normativa...</p>:<>
   <div className="table-scroll"><table className="employee-table"><thead><tr><th>Colaborador</th><th>Categoria / instrumento</th><th>Regime de jornada</th><th>Regra vinculada</th><th>Cobertura na competência</th></tr></thead><tbody>{coverage.map(({employee,assignment,count})=><tr key={employee.id}><td><b>{employee.full_name}</b><br/><small>{employee.employee_code} · sindicato cadastrado: {employee.union_name||"não informado"}</small></td><td>{assignment?assignment.professional_category+" · "+assignment.collective_instrument:"Não enquadrado"}</td><td>{assignment?assignment.work_regime:"Não validado"}</td><td>{assignment?ruleMap.get(assignment.dsr_rule_id)?.rule_name||"Regra não localizada":"—"}</td><td><span className="status-pill">{count>1?"Conflito: múltiplos enquadramentos":assignment?"Validado":"Sem enquadramento validado"}</span>{assignment&&<small><br/>{assignment.validity_from} a {assignment.validity_to||"sem término"}</small>}</td></tr>)}</tbody></table></div>
   {canManage&&<><h3>Solicitar enquadramento normativo</h3><p className="form-hint">Use a categoria e o instrumento constantes dos documentos aplicáveis. O sistema não deduz categoria pelo cargo ou sindicato cadastrado.</p>
    <div className="form-grid">
     <label>Colaborador<select value={employeeId} onChange={e=>{const x=employees.find(v=>v.id===e.target.value);setEmployeeId(e.target.value);if(x?.work_regime)setRegime(x.work_regime);if(x?.union_name&&!instrument)setInstrument(x.union_name);}}><option value="">Selecione...</option>{employees.map(x=><option key={x.id} value={x.id}>{x.employee_code} · {x.full_name}</option>)}</select></label>
     <label>Regra DSR<select value={ruleId} onChange={e=>{const x=rules.find(v=>v.id===e.target.value);setRuleId(e.target.value);if(x?.professional_category)setCategory(x.professional_category);}}><option value="">Selecione...</option>{rules.map(x=><option key={x.id} value={x.id}>{x.rule_name} · {x.status}</option>)}</select></label>
     <label>Categoria profissional<input value={category} onChange={e=>setCategory(e.target.value)} placeholder="Conforme CCT/ACT ou enquadramento formal"/></label>
     <label>Instrumento coletivo<input value={instrument} onChange={e=>setInstrument(e.target.value)} placeholder="CCT/ACT, sindicato e período"/></label>
     <label>Regime de jornada<input value={regime} onChange={e=>setRegime(e.target.value)} placeholder="Ex.: jornada mista, 12x36, parcial"/></label>
     <label>Início da vigência<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
     <label>Fim da vigência (opcional)<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
     <label>Referência da fonte documental<input value={source} onChange={e=>setSource(e.target.value)} placeholder="Documento, cláusula, número e página"/></label>
    </div>
    <label className="review-note-label">Justificativa e documentos conferidos<textarea value={reason} onChange={e=>setReason(e.target.value)} minLength={20} rows={3} placeholder="Descreva o enquadramento e identifique a documentação que o sustenta."/></label>
    <button className="employee-primary" disabled={saving} onClick={()=>void submit()}>{saving?"Salvando...":"Registrar solicitação para validação independente"}</button>
   </>}
   <h3>Solicitações e decisões</h3>
   {!rows.length?<p>Nenhuma solicitação cadastrada.</p>:<div className="table-scroll"><table className="employee-table"><thead><tr><th>Colaborador / categoria</th><th>Instrumento / regime</th><th>Regra / vigência</th><th>Status / fonte</th><th>Decisão</th></tr></thead><tbody>{rows.map(a=><tr key={a.id}><td><b>{employeeMap.get(a.employee_id)?.full_name||"Colaborador"}</b><br/>{a.professional_category}</td><td>{a.collective_instrument}<br/><small>{a.work_regime}</small></td><td>{ruleMap.get(a.dsr_rule_id)?.rule_name||"Regra"}<br/><small>{a.validity_from} a {a.validity_to||"sem término"}</small></td><td>{a.status==="validated"?"Validado":a.status==="rejected"?"Rejeitado":"Pendente"}<br/><small>{a.source_reference}</small></td><td>{a.validation_note||"—"}{a.status==="pending"&&canManage&&a.created_by!==user&&<div style={{display:"grid",gap:6,marginTop:8}}><button className="employee-primary" disabled={saving||decisionNote.trim().length<20} onClick={()=>void decide(a.id,"validate")}>Validar</button><button className="employee-secondary" disabled={saving||decisionNote.trim().length<20} onClick={()=>void decide(a.id,"reject")}>Rejeitar</button></div>}</td></tr>)}</tbody></table></div>}
   {rows.some(a=>a.status==="pending"&&a.created_by!==user)&&<label className="review-note-label">Justificativa da validação ou rejeição<textarea value={decisionNote} onChange={e=>setDecisionNote(e.target.value)} minLength={20} rows={2} placeholder="Informe a conferência da fonte normativa e da vigência."/></label>}
  </>}
 </section>;
}
