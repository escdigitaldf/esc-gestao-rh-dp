"use client";
import {useCallback,useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {ArrowLeft,BookOpen,Plus,ShieldAlert,FileText,RefreshCw} from "lucide-react";
import {createClient} from "@/lib/supabase/client";

type Rule={id:string;rule_name:string;professional_category:string|null;union_name:string|null;source_type:string;source_identifier:string|null;validity_from:string|null;validity_to:string|null;document_reference:string|null;rule_summary:string|null;calculation_method:string|null;status:string;validation_notes:string|null;created_at:string};
const sourceLabel=(v:string)=>({law:"Legislação",cct:"Convenção coletiva (CCT)",act:"Acordo coletivo (ACT)",internal_policy:"Norma interna"} as Record<string,string>)[v]||v;
const dateBR=(v:string|null)=>v?new Date(v+"T12:00:00").toLocaleDateString("pt-BR"):"Não informada";
export default function DsrRulesPage(){
 const router=useRouter();
 const [org,setOrg]=useState("");
 const [rules,setRules]=useState<Rule[]>([]);
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState("");
 const [success,setSuccess]=useState("");
 const [name,setName]=useState("");
 const [category,setCategory]=useState("");
 const [union,setUnion]=useState("");
 const [source,setSource]=useState("cct");
 const [identifier,setIdentifier]=useState("");
 const [from,setFrom]=useState("");
 const [to,setTo]=useState("");
 const [document,setDocument]=useState("");
 const [summary,setSummary]=useState("");
 const [method,setMethod]=useState("");

 const load=useCallback(async()=>{
  setLoading(true);setError("");
  const s=createClient();
  const {data:{user},error:authError}=await s.auth.getUser();
  if(authError||!user){router.replace("/");return;}
  const {data:m,error:mError}=await s.from("organization_memberships").select("organization_id").eq("user_id",user.id).eq("status","active").limit(1).maybeSingle();
  if(mError||!m){setError(mError?.message||"Organização não encontrada.");setLoading(false);return;}
  setOrg(m.organization_id);
  const {data,error:queryError}=await s.from("organization_dsr_rules").select("*").eq("organization_id",m.organization_id).order("created_at",{ascending:false});
  if(queryError)setError(queryError.message);
  setRules((data||[]) as Rule[]);
  setLoading(false);
 },[router]);
 useEffect(()=>{void load()},[load]);

 async function save(e:React.FormEvent){
  e.preventDefault();setError("");setSuccess("");
  if(!name.trim()||!source){setError("Informe o nome da regra e sua origem.");return;}
  if(from&&to&&to<from){setError("A validade final não pode anteceder a inicial.");return;}
  setSaving(true);
  try{
   const s=createClient();const {data:{user}}=await s.auth.getUser();
   const {error:e}=await s.from("organization_dsr_rules").insert({
    organization_id:org,rule_name:name.trim(),professional_category:category.trim()||null,union_name:union.trim()||null,
    source_type:source,source_identifier:identifier.trim()||null,validity_from:from||null,validity_to:to||null,
    document_reference:document.trim()||null,rule_summary:summary.trim()||null,calculation_method:method||null,
    calculation_parameters:{},status:"pending_validation",created_by:user?.id
   });
   if(e)throw e;
   setSuccess("Referência normativa cadastrada. A regra permanece pendente e não libera cálculo.");
   setName("");setCategory("");setUnion("");setIdentifier("");setFrom("");setTo("");setDocument("");setSummary("");setMethod("");
   await load();
  }catch(e){setError(e instanceof Error?e.message:"Não foi possível cadastrar a regra.");}
  finally{setSaving(false);}
 }

 if(loading)return <div className="loading-screen">Carregando regras de DSR...</div>;
 return <main className="module-shell">
  <header className="module-top"><a href="/dashboard/folha/dsr"><ArrowLeft size={16}/> Jornadas e DSR</a><b><span className="brand-mark">ESC</span> Gestão de RH e DP</b><span>Base normativa</span></header>
  <section className="module-content payroll-content">
   <div className="module-heading"><div><div className="form-kicker">DEPARTAMENTO PESSOAL · BASE NORMATIVA</div><h1>Regras legais e coletivas do DSR</h1><p>Cadastre a fonte normativa que deverá orientar a apuração por categoria e jornada.</p></div><div className="salary-history-icon"><BookOpen size={24}/></div></div>
   {error&&<div className="notice error">{error}</div>}{success&&<div className="notice success">{success}</div>}
   <div className="dependent-privacy"><ShieldAlert size={17}/><span><b>Validação obrigatória.</b> O cadastro registra a referência normativa, mas não interpreta automaticamente a CCT/ACT. Toda regra começa pendente; nenhuma fórmula financeira será ativada sem conferência do documento, vigência, categoria e regime de jornada.</span></div>
   <div className="payroll-create"><div><div className="form-kicker">CADASTRO NORMATIVO</div><h2>Nova referência de DSR</h2><p>Preencha com os dados do instrumento vigente. Não informe parâmetros presumidos.</p></div>
    <form onSubmit={save}>
     <label>Nome da regra<input required value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: DSR — categoria profissional"/></label>
     <div className="form-two"><label>Categoria profissional<input value={category} onChange={e=>setCategory(e.target.value)} placeholder="Categoria abrangida"/></label><label>Sindicato / entidade sindical<input value={union} onChange={e=>setUnion(e.target.value)} placeholder="Nome da entidade"/></label></div>
     <div className="form-two"><label>Origem normativa<select value={source} onChange={e=>setSource(e.target.value)}><option value="cct">Convenção coletiva (CCT)</option><option value="act">Acordo coletivo (ACT)</option><option value="law">Legislação</option><option value="internal_policy">Norma interna</option></select></label><label>Número / identificação do instrumento<input value={identifier} onChange={e=>setIdentifier(e.target.value)} placeholder="Número, ano ou cláusula"/></label></div>
     <div className="form-two"><label>Início da vigência<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Fim da vigência<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div>
     <label>Referência do documento<input value={document} onChange={e=>setDocument(e.target.value)} placeholder="Nome do arquivo, link interno ou identificação do documento"/></label>
     <label>Resumo da cláusula / fundamento<textarea rows={4} value={summary} onChange={e=>setSummary(e.target.value)} placeholder="Transcreva ou resuma a cláusula pertinente, indicando número e página. Não inclua dados pessoais."/></label>
     <label>Critério de apuração identificado (opcional)<select value={method} onChange={e=>setMethod(e.target.value)}><option value="">Ainda não identificado / requer análise</option><option value="fixed_weekly">Regra por semana / repouso semanal</option><option value="hours_based">Base horária</option><option value="proportional_days">Proporcionalidade por dias</option><option value="custom">Critério específico descrito no instrumento</option></select></label>
     <button className="employee-primary" disabled={saving}><Plus size={15}/>{saving?"Salvando...":"Cadastrar referência normativa"}</button>
    </form>
   </div>
   <div className="employee-list-card payroll-list"><div className="employee-list-head"><div><h2>Referências cadastradas</h2><p>Somente regras validadas poderão ser consideradas em etapa futura de cálculo.</p></div><button className="employee-secondary" onClick={()=>void load()}><RefreshCw size={14}/> Atualizar</button></div>
    {!rules.length?<div className="employee-empty"><FileText size={22}/><b>Nenhuma referência cadastrada</b><p>Cadastre a CCT, ACT ou fundamento legal aplicável à categoria.</p></div>:
    <div className="table-scroll"><table className="employee-table"><thead><tr><th>Regra</th><th>Categoria / sindicato</th><th>Origem</th><th>Vigência</th><th>Critério registrado</th><th>Status</th></tr></thead><tbody>{rules.map(r=><tr key={r.id}><td><b>{r.rule_name}</b><br/><small>{r.source_identifier||"Sem identificação"}</small>{r.document_reference&&<><br/><small>{r.document_reference}</small></>}</td><td>{r.professional_category||"Não informada"}<br/><small>{r.union_name||"Entidade não informada"}</small></td><td>{sourceLabel(r.source_type)}</td><td>{dateBR(r.validity_from)} até {dateBR(r.validity_to)}</td><td>{r.calculation_method||"A definir após análise documental"}</td><td><span className="status-pill">{r.status==="validated"?"Validada":r.status==="suspended"?"Suspensa":"Pendente de validação"}</span></td></tr>)}</tbody></table></div>}
   </div>
   <div className="dependent-privacy"><FileText size={16}/><span>A validação deve ser feita após conferência integral do instrumento e da aplicabilidade ao vínculo. A alteração posterior de uma regra validada exigirá o cadastro de nova versão, preservando o histórico.</span></div>
  </section>
 </main>;
}
