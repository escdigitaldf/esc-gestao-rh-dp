"use client";
import {useCallback,useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {ArrowLeft,BookOpen,Plus,ShieldAlert,FileText,RefreshCw,Upload,Download,FileCheck2} from "lucide-react";
import {createClient} from "@/lib/supabase/client";

type Rule={id:string;rule_name:string;professional_category:string|null;union_name:string|null;source_type:string;source_identifier:string|null;validity_from:string|null;validity_to:string|null;document_reference:string|null;rule_summary:string|null;calculation_method:string|null;calculation_parameters:{divisor?:number}|null;status:string;validation_notes:string|null;created_at:string};
type RuleDocument={id:string;organization_id:string;dsr_rule_id:string;file_name:string;storage_path:string;mime_type:string;file_size:number;document_version:number;uploaded_by:string;uploaded_at:string;notes:string|null};
type CategoryParameter={id:string;organization_id:string;dsr_rule_id:string;category:string;unit:"days"|"hours";denominator:number;rest_units:number;effective_from:string;effective_to:string|null;status:string;justification:string;source_document_id:string|null;source_reference:string|null;version:number;supersedes_id:string|null;created_by:string;validated_by:string|null;validated_at:string|null};
type ParameterInput={category:string;unit:"days"|"hours";denominator:string;restUnits:string;from:string;to:string;justification:string;sourceReference:string;sourceDocumentId:string};
const BUCKET="organization-dsr-documents";
const MAX_FILE_SIZE=15*1024*1024;
const sourceLabel=(v:string)=>({law:"Legislação",cct:"Convenção coletiva (CCT)",act:"Acordo coletivo (ACT)",internal_policy:"Norma interna"} as Record<string,string>)[v]||v;
const dateBR=(v:string|null)=>v?new Date(v+"T12:00:00").toLocaleDateString("pt-BR"):"Não informada";
const dateTimeBR=(v:string)=>new Date(v).toLocaleString("pt-BR");
const sizeBR=(n:number)=>n<1024*1024?Math.ceil(n/1024)+" KB":(n/(1024*1024)).toFixed(2).replace(".",",")+" MB";
export default function DsrRulesPage(){
 const router=useRouter();
 const [org,setOrg]=useState("");
 const [rules,setRules]=useState<Rule[]>([]);
 const [documents,setDocuments]=useState<RuleDocument[]>([]);
 const [categoryParameters,setCategoryParameters]=useState<CategoryParameter[]>([]);
 const [parameterInputs,setParameterInputs]=useState<Record<string,ParameterInput>>({});
 const [selectedFiles,setSelectedFiles]=useState<Record<string,File|null>>({});
 const [documentNotes,setDocumentNotes]=useState<Record<string,string>>({});
 const [uploading,setUploading]=useState("");
 const [opening,setOpening]=useState("");
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
 const [divisor,setDivisor]=useState("30");

 const load=useCallback(async()=>{
  setLoading(true);setError("");
  const s=createClient();
  const {data:{user},error:authError}=await s.auth.getUser();
  if(authError||!user){router.replace("/");return;}
  const {data:m,error:mError}=await s.from("organization_memberships").select("organization_id").eq("user_id",user.id).eq("status","active").limit(1).maybeSingle();
  if(mError||!m){setError(mError?.message||"Organização não encontrada.");setLoading(false);return;}
  setOrg(m.organization_id);
  const {data,error:queryError}=await s.from("organization_dsr_rules").select("*").eq("organization_id",m.organization_id).order("created_at",{ascending:false});
  if(queryError){setError(queryError.message);setLoading(false);return;}
  const rows=(data||[]) as Rule[];
  setRules(rows);
  const {data:docs,error:docsError}=await s.from("organization_dsr_rule_documents").select("*").eq("organization_id",m.organization_id).order("document_version",{ascending:false});
  if(docsError)setError("Referências carregadas, mas não foi possível consultar os anexos: "+docsError.message);
  setDocuments((docs||[]) as RuleDocument[]);
  const {data:params,error:paramsError}=await s.from("organization_dsr_rule_category_parameters").select("*").eq("organization_id",m.organization_id).order("version",{ascending:false});
  if(paramsError)setError("Referências e anexos carregados, mas houve falha ao consultar parâmetros por categoria: "+paramsError.message);
  setCategoryParameters((params||[]) as CategoryParameter[]);
  setLoading(false);
 },[router]);
 useEffect(()=>{void load()},[load]);

 async function save(e:React.FormEvent){
  e.preventDefault();setError("");setSuccess("");
  if(!name.trim()||!source){setError("Informe o nome da regra e sua origem.");return;}
  if(from&&to&&to<from){setError("A validade final não pode anteceder a inicial.");return;}
  const divisorValue=Number(divisor);
  if(!Number.isFinite(divisorValue)||divisorValue<=0||divisorValue>31){setError("O divisor deve ser maior que zero e não pode ultrapassar 31.");return;}
  setSaving(true);
  try{
   const s=createClient();const {data:{user}}=await s.auth.getUser();
   const {error:e}=await s.from("organization_dsr_rules").insert({
    organization_id:org,rule_name:name.trim(),professional_category:category.trim()||null,union_name:union.trim()||null,
    source_type:source,source_identifier:identifier.trim()||null,validity_from:from||null,validity_to:to||null,
    document_reference:document.trim()||null,rule_summary:summary.trim()||null,calculation_method:method||null,
    calculation_parameters:{divisor:divisorValue},status:"pending_validation",created_by:user?.id
   });
   if(e)throw e;
   setSuccess("Referência normativa cadastrada. A regra permanece pendente e não libera cálculo.");
   setName("");setCategory("");setUnion("");setIdentifier("");setFrom("");setTo("");setDocument("");setSummary("");setMethod("");setDivisor("30");
   await load();
  }catch(e){setError(e instanceof Error?e.message:"Não foi possível cadastrar a regra.");}
  finally{setSaving(false);}
 }

 async function uploadDocument(rule:Rule){
  setError("");setSuccess("");
  const file=selectedFiles[rule.id];
  if(!file){setError("Selecione um arquivo PDF para anexar à regra.");return;}
  if(!file.name.toLowerCase().endsWith(".pdf")||(file.type&&file.type!=="application/pdf")){setError("Formato não permitido. Envie somente arquivo PDF.");return;}
  if(file.size<1||file.size>MAX_FILE_SIZE){setError("O PDF deve ter até 15 MB.");return;}
  setUploading(rule.id);
  const s=createClient();
  const documentId=crypto.randomUUID();
  const safeName=file.name.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9._-]+/g,"_").slice(-180)||"documento.pdf";
  const storagePath=org+"/"+rule.id+"/"+documentId+".pdf";
  try{
   const {error:storageError}=await s.storage.from(BUCKET).upload(storagePath,file,{contentType:"application/pdf",upsert:false});
   if(storageError)throw storageError;
   const {data:{user}}=await s.auth.getUser();
   const {error:insertError}=await s.from("organization_dsr_rule_documents").insert({
    id:documentId,organization_id:org,dsr_rule_id:rule.id,file_name:safeName,mime_type:"application/pdf",
    file_size:file.size,document_version:1,uploaded_by:user?.id,storage_path:storagePath,notes:documentNotes[rule.id]?.trim()||null
   });
   if(insertError){
    const {error:cleanupError}=await s.storage.from(BUCKET).remove([storagePath]);
    if(cleanupError){
     throw new Error(insertError.message+" O cadastro falhou e a limpeza automática do arquivo também não foi confirmada. Solicite verificação técnica para evitar um arquivo órfão.");
    }
    throw insertError;
   }
   setSelectedFiles(current=>({...current,[rule.id]:null}));
   setDocumentNotes(current=>({...current,[rule.id]:""}));
   setSuccess("Documento anexado. A versão foi registrada no histórico e o arquivo permanece privado.");
   await load();
  }catch(e){setError(e instanceof Error?e.message:"Não foi possível anexar o documento.");}
  finally{setUploading("");}
 }


 function parameterInput(rule:Rule):ParameterInput{
  return parameterInputs[rule.id]||{category:"overtime",unit:"days",denominator:"",restUnits:"",from:rule.validity_from||"",to:rule.validity_to||"",justification:"",sourceReference:"",sourceDocumentId:""};
 }

 async function saveCategoryParameter(rule:Rule){
  setError("");setSuccess("");
  const input=parameterInput(rule);
  const denominator=Number(input.denominator),restUnits=Number(input.restUnits);
  if(!input.category||!input.from||!input.justification.trim()||input.justification.trim().length<10||!Number.isFinite(denominator)||denominator<=0||!Number.isFinite(restUnits)||restUnits<0){
   setError("Informe categoria, início da vigência, justificativa (mínimo 10 caracteres), denominador maior que zero e unidades de repouso iguais ou maiores que zero.");return;
  }
  if(input.to&&input.to<input.from){setError("A vigência final não pode anteceder a inicial.");return;}
  if(["cct","act"].includes(rule.source_type)&&!input.sourceDocumentId){setError("Para CCT/ACT, vincule o PDF do instrumento coletivo.");return;}
  if(!input.sourceDocumentId&&!input.sourceReference.trim()){setError("Informe o item, cláusula ou referência documental específica.");return;}
  setSaving(true);
  try{
   const s=createClient();const {data:{user},error:authError}=await s.auth.getUser();
   if(authError||!user)throw new Error("Sessão não encontrada. Entre novamente.");
   const {error:insertError}=await s.from("organization_dsr_rule_category_parameters").insert({
    organization_id:org,dsr_rule_id:rule.id,category:input.category,unit:input.unit,
    denominator,rest_units:restUnits,effective_from:input.from,effective_to:input.to||null,
    justification:input.justification.trim(),source_reference:input.sourceReference.trim()||null,
    source_document_id:input.sourceDocumentId||null,
    supersedes_id:categoryParameters.filter(p=>p.dsr_rule_id===rule.id&&p.category===input.category).sort((x,y)=>y.version-x.version)[0]?.id||null,
    status:"pending_validation",created_by:user.id
   });
   if(insertError)throw insertError;
   setSuccess("Parâmetro registrado como pendente. Ele ainda não será utilizado como referência validada.");
   await load();
  }catch(e){setError(e instanceof Error?e.message:"Não foi possível registrar o parâmetro.");}
  finally{setSaving(false);}
 }

 async function validateCategoryParameter(parameter:CategoryParameter){
  if(parameter.status!=="pending_validation")return;
  if(!window.confirm("Confirma que conferiu a cláusula/documento, categoria, unidade, denominador, repousos e vigência? O parâmetro ficará imutável; alterações exigirão nova versão."))return;
  setSaving(true);setError("");setSuccess("");
  try{
   const s=createClient();const {data:{user},error:authError}=await s.auth.getUser();
   if(authError||!user)throw new Error("Sessão não encontrada. Entre novamente.");
   const {data,error:updateError}=await s.from("organization_dsr_rule_category_parameters")
    .update({status:"validated",validated_by:user.id,validated_at:new Date().toISOString()})
    .eq("id",parameter.id).eq("organization_id",org).eq("status","pending_validation").select("id").maybeSingle();
   if(updateError)throw updateError;
   if(!data)throw new Error("O parâmetro não foi validado. Atualize a tela e confira se outro usuário já realizou a decisão.");
   setSuccess("Parâmetro validado com responsável e data. A versão foi bloqueada para edição.");
   await load();
  }catch(e){setError(e instanceof Error?e.message:"Não foi possível validar o parâmetro.");}
  finally{setSaving(false);}
 }

 async function validateRule(rule:Rule){
  setError("");setSuccess("");
  if(rule.status!=="pending_validation")return;
  const ruleDocs=documents.filter(d=>d.dsr_rule_id===rule.id);
  if(["cct","act"].includes(rule.source_type)&&!ruleDocs.length){
   setError("Antes de validar uma CCT/ACT, anexe o instrumento coletivo em PDF.");
   return;
  }
  if(["law","internal_policy"].includes(rule.source_type)&&!ruleDocs.length&&(!rule.document_reference?.trim()||!rule.rule_summary?.trim())){
   setError("Para validar esta referência, anexe o documento ou preencha a referência documental e o fundamento/resumo.");
   return;
  }
  if(!window.confirm("Confirma que conferiu o documento integral, a categoria abrangida, a vigência e o critério de DSR? Após validada, a regra ficará imutável; correções exigirão nova versão."))return;
  setSaving(true);
  try{
   const s=createClient();
   const {data:{user},error:authError}=await s.auth.getUser();
   if(authError||!user)throw new Error("Sessão não encontrada. Entre novamente.");
   const {data,error:updateError}=await s.from("organization_dsr_rules")
    .update({status:"validated",validated_by:user.id,validated_at:new Date().toISOString()})
    .eq("id",rule.id).eq("organization_id",org).eq("status","pending_validation")
    .select("id").maybeSingle();
   if(updateError)throw updateError;
   if(!data)throw new Error("A regra não foi alterada. Atualize a tela e confira se outro usuário já realizou a validação.");
   setSuccess("Regra validada com identificação do responsável e horário. O conteúdo agora está bloqueado para edição.");
   await load();
  }catch(e){setError(e instanceof Error?e.message:"Não foi possível validar a regra.");}
  finally{setSaving(false);}
 }

 async function openDocument(doc:RuleDocument){
  setError("");setOpening(doc.id);
  try{
   const s=createClient();
   const {data,error:e}=await s.storage.from(BUCKET).createSignedUrl(doc.storage_path,60);
   if(e)throw e;
   if(!data?.signedUrl)throw new Error("Não foi possível gerar o acesso temporário ao documento.");
   window.location.assign(data.signedUrl);
  }catch(e){setError(e instanceof Error?e.message:"Não foi possível abrir o documento.");setOpening("");}
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
     <label>Referência do documento<input value={document} onChange={e=>setDocument(e.target.value)} placeholder="Identificação ou referência do instrumento"/></label>
     <label>Resumo da cláusula / fundamento<textarea rows={4} value={summary} onChange={e=>setSummary(e.target.value)} placeholder="Indique a cláusula pertinente, número e página. Não inclua dados pessoais."/></label>
     <label>Critério de apuração identificado (opcional)<select value={method} onChange={e=>setMethod(e.target.value)}><option value="">Ainda não identificado / requer análise</option><option value="fixed_weekly">Regra por semana / repouso semanal</option><option value="hours_based">Base horária</option><option value="proportional_days">Proporcionalidade por dias</option><option value="custom">Critério específico descrito no instrumento</option></select></label>
     <label>Divisor de referência (padrão 30)<input type="number" min="1" max="31" step="0.01" value={divisor} onChange={e=>setDivisor(e.target.value)}/><small>Parâmetro registrado para a futura memória de cálculo. A aplicação dependerá do critério da regra validada.</small></label>
     <button className="employee-primary" disabled={saving}><Plus size={15}/>{saving?"Salvando...":"Cadastrar referência normativa"}</button>
    </form>
   </div>
   <div className="employee-list-card payroll-list"><div className="employee-list-head"><div><h2>Referências cadastradas</h2><p>Somente regras validadas poderão ser consideradas em etapa futura de cálculo.</p></div><button className="employee-secondary" onClick={()=>void load()}><RefreshCw size={14}/> Atualizar</button></div>
    {!rules.length?<div className="employee-empty"><FileText size={22}/><b>Nenhuma referência cadastrada</b><p>Cadastre a CCT, ACT ou fundamento legal aplicável à categoria.</p></div>:
    <div className="table-scroll"><table className="employee-table"><thead><tr><th>Regra</th><th>Categoria / sindicato</th><th>Origem</th><th>Vigência</th><th>Critério registrado</th><th>Status</th></tr></thead><tbody>{rules.map(r=><tr key={r.id}><td><b>{r.rule_name}</b><br/><small>{r.source_identifier||"Sem identificação"}</small>{r.document_reference&&<><br/><small>{r.document_reference}</small></>}</td><td>{r.professional_category||"Não informada"}<br/><small>{r.union_name||"Entidade não informada"}</small></td><td>{sourceLabel(r.source_type)}</td><td>{dateBR(r.validity_from)} até {dateBR(r.validity_to)}</td><td>{r.calculation_method||"A definir após análise documental"}<br/><small>Divisor: {Number(r.calculation_parameters?.divisor||30).toLocaleString("pt-BR")}</small></td><td><span className="status-pill">{r.status==="validated"?"Validada":r.status==="suspended"?"Suspensa":"Pendente de validação"}</span>{r.status==="pending_validation"&&<div style={{marginTop:8}}><button className="employee-secondary" disabled={saving} onClick={()=>void validateRule(r)}><FileCheck2 size={13}/> Validar regra</button></div>}</td></tr>)}</tbody></table></div>}
   </div>
   <section className="employee-list-card payroll-list dsr-category-parameters-panel">
    <div className="employee-list-head"><div><h2>Parâmetros normativos por categoria</h2><p>Cadastre versões separadas para horas extras, comissões, adicionais, prêmios e outros proventos. Cada versão exige vigência, fundamento e validação.</p></div><span className="dsr-private-tag">HISTÓRICO IMUTÁVEL</span></div>
    {!rules.length?<div className="employee-empty">Cadastre uma regra normativa antes de definir parâmetros por categoria.</div>:
    <div className="dsr-rule-doc-list">{rules.map(rule=>{
     const input=parameterInput(rule);
     const ruleParams=categoryParameters.filter(p=>p.dsr_rule_id===rule.id).sort((a,b)=>b.version-a.version);
     const docsForRule=documents.filter(d=>d.dsr_rule_id===rule.id);
     const categoryLabel=(v:string)=>({overtime:"Horas extras",commission:"Comissões",additional:"Adicionais",bonus:"Prêmios / gratificações",other:"Outros proventos"} as Record<string,string>)[v]||v;
     return <article className="dsr-rule-doc-card" key={rule.id}>
      <div className="dsr-rule-doc-title"><div><b>{rule.rule_name}</b><span>{sourceLabel(rule.source_type)} · {rule.status==="validated"?"Regra normativa validada":"Regra normativa pendente"}</span></div><span className="status-pill">{ruleParams.length} versão(ões)</span></div>
      {rule.status==="validated"?<div className="dsr-category-calculation-fields">
       <label>Categoria<select value={input.category} onChange={e=>setParameterInputs(v=>({...v,[rule.id]:{...input,category:e.target.value}}))}><option value="overtime">Horas extras</option><option value="commission">Comissões</option><option value="additional">Adicionais</option><option value="bonus">Prêmios / gratificações</option><option value="other">Outros proventos</option></select></label>
       <label>Unidade<select value={input.unit} onChange={e=>setParameterInputs(v=>({...v,[rule.id]:{...input,unit:e.target.value as "days"|"hours"}}))}><option value="days">Dias</option><option value="hours">Horas</option></select></label>
       <label>Denominador<input type="number" min="0.0001" step="0.0001" value={input.denominator} onChange={e=>setParameterInputs(v=>({...v,[rule.id]:{...input,denominator:e.target.value}}))} placeholder="Conforme o instrumento"/></label>
       <label>Repousos / unidades<input type="number" min="0" step="0.0001" value={input.restUnits} onChange={e=>setParameterInputs(v=>({...v,[rule.id]:{...input,restUnits:e.target.value}}))} placeholder="Conforme o instrumento"/></label>
       <label>Início da vigência<input type="date" value={input.from} onChange={e=>setParameterInputs(v=>({...v,[rule.id]:{...input,from:e.target.value}}))}/></label>
       <label>Fim da vigência<input type="date" value={input.to} onChange={e=>setParameterInputs(v=>({...v,[rule.id]:{...input,to:e.target.value}}))}/></label>
       <label>Documento normativo<select value={input.sourceDocumentId} onChange={e=>setParameterInputs(v=>({...v,[rule.id]:{...input,sourceDocumentId:e.target.value}}))}><option value="">Selecione o PDF de referência</option>{docsForRule.map(d=><option key={d.id} value={d.id}>V{d.document_version} · {d.file_name}</option>)}</select></label>
       <label>Cláusula / página / referência<input value={input.sourceReference} onChange={e=>setParameterInputs(v=>({...v,[rule.id]:{...input,sourceReference:e.target.value}}))} placeholder="Ex.: cláusula 12, item 3, página 8"/></label>
       <label className="dsr-category-justification">Justificativa técnica<textarea rows={3} value={input.justification} onChange={e=>setParameterInputs(v=>({...v,[rule.id]:{...input,justification:e.target.value}}))} placeholder="Descreva o fundamento documental que sustenta unidade, denominador e repousos."/></label>
       <button className="employee-primary" disabled={saving} onClick={()=>void saveCategoryParameter(rule)}><Plus size={14}/> Registrar nova versão pendente</button>
      </div>:<p className="dsr-no-docs">Valide primeiro a referência normativa principal para liberar os parâmetros desta regra.</p>}
      {!ruleParams.length?<p className="dsr-no-docs">Nenhum parâmetro cadastrado.</p>:<div className="dsr-doc-version-list">{ruleParams.map(p=><div className="dsr-doc-version" key={p.id}>
       <FileText size={17}/><div><b>{categoryLabel(p.category)} · versão {p.version}</b><span>{p.unit==="days"?"Dias":"Horas"} · {Number(p.denominator).toLocaleString("pt-BR")} de denominador · {Number(p.rest_units).toLocaleString("pt-BR")} repouso(s) · {dateBR(p.effective_from)} até {dateBR(p.effective_to)} · {p.status==="validated"?"Validado":p.status==="rejected"?"Rejeitado":"Pendente"}</span><span>{p.source_reference||"Documento vinculado"} · {p.validated_at?"Validado em "+dateTimeBR(p.validated_at):"Aguardando validação"}</span><span>{p.justification}</span></div>
       {p.status==="pending_validation"&&<button className="employee-secondary" disabled={saving||rule.status!=="validated"} onClick={()=>void validateCategoryParameter(p)}><FileCheck2 size={13}/> Validar</button>}
      </div>)}</div>}
     </article>;
    })}</div>}
   </section>
   <section className="employee-list-card dsr-documents-panel">
    <div className="employee-list-head"><div><h2>Gestão documental das regras</h2><p>Anexe o instrumento integral e mantenha versões históricas sem sobrescrever arquivos anteriores.</p></div><span className="dsr-private-tag">ARMAZENAMENTO PRIVADO</span></div>
    {!rules.length?<div className="employee-empty">Cadastre uma referência normativa antes de anexar documentos.</div>:
    <div className="dsr-rule-doc-list">{rules.map(rule=>{
      const ruleDocs=documents.filter(d=>d.dsr_rule_id===rule.id).sort((a,b)=>b.document_version-a.document_version);
      return <article className="dsr-rule-doc-card" key={rule.id}>
       <div className="dsr-rule-doc-title"><div><b>{rule.rule_name}</b><span>{sourceLabel(rule.source_type)} · {rule.professional_category||"Categoria não informada"}</span></div><span className="status-pill">{ruleDocs.length} {ruleDocs.length===1?"arquivo":"arquivos"}</span></div>
       <div className="dsr-upload-grid">
        <label className="dsr-file-picker">Arquivo PDF (máximo 15 MB)<input key={selectedFiles[rule.id]?.name||"empty"} type="file" accept="application/pdf,.pdf" onChange={e=>setSelectedFiles(current=>({...current,[rule.id]:e.target.files?.[0]||null}))}/></label>
        <label>Observação do anexo<input value={documentNotes[rule.id]||""} onChange={e=>setDocumentNotes(current=>({...current,[rule.id]:e.target.value}))} placeholder="Ex.: CCT 2026/2027 — íntegra assinada"/></label>
        <button className="employee-primary" disabled={uploading===rule.id||!selectedFiles[rule.id]} onClick={()=>void uploadDocument(rule)}><Upload size={14}/>{uploading===rule.id?"Enviando...":"Anexar nova versão"}</button>
       </div>
       {!ruleDocs.length?<p className="dsr-no-docs">Nenhum documento anexado a esta referência.</p>:
        <div className="dsr-doc-version-list">{ruleDocs.map(doc=><div className="dsr-doc-version" key={doc.id}>
         <FileCheck2 size={17}/><div><b>Versão {doc.document_version} · {doc.file_name}</b><span>{dateTimeBR(doc.uploaded_at)} · {sizeBR(Number(doc.file_size))}{doc.notes?" · "+doc.notes:""}</span></div>
         <button className="employee-secondary" disabled={opening===doc.id} onClick={()=>void openDocument(doc)}><Download size={13}/>{opening===doc.id?"Abrindo...":"Abrir PDF"}</button>
        </div>)}</div>}
      </article>;
    })}</div>}
   </section>
   <div className="dependent-privacy"><FileText size={16}/><span>Os PDFs ficam em bucket privado. O acesso é concedido por link temporário de 60 segundos, condicionado às permissões da organização. Os anexos são imutáveis: para corrigir ou atualizar, envie uma nova versão. A validação jurídica e trabalhista permanece manual.</span></div>
  </section>
 </main>;
}
