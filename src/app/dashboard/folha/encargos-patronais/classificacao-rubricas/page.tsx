"use client";

import {useCallback,useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {ArrowLeft,RefreshCw,ShieldCheck,Save,CheckCircle2,AlertTriangle} from "lucide-react";
import {createClient} from "@/lib/supabase/client";

type Parameter={id:string;table_code:string;title:string;calculation_method:string;effective_from:string;effective_to:string|null;source_reference:string|null;status:string};
type Mapping={id:string;parameter_table_id:string;contribution_key:string;source_reference:string;status:string;created_by:string;validated_by:string|null;validated_at:string|null};
const options=[{value:"employer_inss",label:"INSS patronal"},{value:"rat",label:"RAT ajustado pelo FAP"},{value:"third_parties",label:"Terceiros"},{value:"payroll_pis",label:"PIS sobre folha"},{value:"other",label:"Outro encargo (não distribuir)"}];
export default function EmployerChargeClassificationPage(){
 const router=useRouter();
 const [org,setOrg]=useState("");
 const [parameters,setParameters]=useState<Parameter[]>([]);
 const [mappings,setMappings]=useState<Mapping[]>([]);
 const [keys,setKeys]=useState<Record<string,string>>({});
 const [sources,setSources]=useState<Record<string,string>>({});
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState("");
 const [error,setError]=useState("");
 const [success,setSuccess]=useState("");
 const load=useCallback(async()=>{
  setLoading(true);setError("");
  const s=createClient();const {data:{user},error:auth}=await s.auth.getUser();
  if(auth||!user){router.replace("/");return;}
  const {data:m,error:me}=await s.from("organization_memberships").select("organization_id").eq("user_id",user.id).eq("status","active").limit(1).maybeSingle();
  if(me||!m){setError(me?.message||"Organização ativa não encontrada.");setLoading(false);return;}
  setOrg(m.organization_id);
  const [p,mp]=await Promise.all([
   s.from("payroll_parameter_tables").select("id,table_code,title,calculation_method,effective_from,effective_to,source_reference,status").eq("organization_id",m.organization_id).order("effective_from",{ascending:false}),
   s.from("payroll_employer_charge_component_mappings").select("*").eq("organization_id",m.organization_id)
  ]);
  if(p.error||mp.error)setError(p.error?.message||mp.error?.message||"Não foi possível carregar os parâmetros.");
  setParameters((p.data||[]) as Parameter[]);setMappings((mp.data||[]) as Mapping[]);
  setLoading(false);
 },[router]);
 useEffect(()=>{void load()},[load]);
 async function save(parameter:Parameter){
  const existing=mappings.find(x=>x.parameter_table_id===parameter.id);
  if(existing?.status==="validated"){setError("O mapeamento validado é imutável. Crie uma nova versão de parâmetro para alterar a classificação.");return;}
  const key=keys[parameter.id]||existing?.contribution_key||"";
  const source=(sources[parameter.id]??existing?.source_reference??"").trim();
  if(!key||!source){setError("Selecione o tipo de encargo e informe a referência documental.");return;}
  setSaving(parameter.id);setError("");setSuccess("");
  try{
   const s=createClient();
   const payload={organization_id:org,parameter_table_id:parameter.id,contribution_key:key,source_reference:source,status:"pending"};
   const result=existing
    ? await s.from("payroll_employer_charge_component_mappings").update({contribution_key:key,source_reference:source}).eq("id",existing.id).eq("organization_id",org)
    : await s.from("payroll_employer_charge_component_mappings").insert(payload);
   if(result.error)throw result.error;
   setSuccess("Classificação salva como pendente. Outro responsável deverá validar.");
   await load();
  }catch(e){setError(e instanceof Error?e.message:"Não foi possível salvar a classificação.");}
  finally{setSaving("");}
 }
 async function validate(mapping:Mapping){
  if(!confirm("Confirmar a classificação documental deste parâmetro? A validação será definitiva e precisa ser realizada por pessoa diferente de quem cadastrou."))return;
  setSaving(mapping.id);setError("");setSuccess("");
  try{
   const s=createClient();
   const {error:e}=await s.from("payroll_employer_charge_component_mappings").update({status:"validated"}).eq("id",mapping.id).eq("organization_id",org);
   if(e)throw e;
   setSuccess("Classificação validada com usuário e data registrados.");
   await load();
  }catch(e){setError(e instanceof Error?e.message:"Não foi possível validar. A validação exige outro responsável autorizado.");}
  finally{setSaving("");}
 }
 if(loading)return <div className="loading-screen">Carregando classificação dos encargos...</div>;
 return <main className="module-shell">
  <header className="module-top"><a href="/dashboard/folha/encargos-patronais"><ArrowLeft size={16}/> Encargos patronais</a><b><span className="brand-mark">ESC</span> Gestão de RH e DP</b><span>Classificação de rubricas</span></header>
  <section className="module-content payroll-content">
   <div className="module-heading"><div><div className="form-kicker">DEPARTAMENTO PESSOAL · PARAMETRIZAÇÃO AUDITÁVEL</div><h1>Classificação dos encargos</h1><p>Associe cada parâmetro de folha a uma contribuição, com fundamento documental e validação por segundo responsável.</p></div><div className="salary-history-icon"><ShieldCheck size={24}/></div></div>
   <div className="dependent-privacy"><ShieldCheck size={17}/> O sistema não presume que uma tabela parametrizada seja INSS patronal, RAT, terceiros ou PIS. Até a validação documental, os valores permanecem identificados como não classificados e não entram na conciliação individual por contribuição.</div>
   {error&&<div className="notice error">{error}</div>}{success&&<div className="notice success">{success}</div>}
   <div className="employee-list-card payroll-list"><div className="employee-list-head"><div><h2>Parâmetros disponíveis</h2><p>Somente parâmetros da organização atual; confira código, vigência e fonte antes de classificar.</p></div><button className="employee-secondary" onClick={()=>void load()} disabled={saving!==""}><RefreshCw size={14}/> Atualizar</button></div>
    {!parameters.length?<div className="employee-empty"><AlertTriangle size={22}/><b>Nenhum parâmetro cadastrado</b><p>Cadastre os parâmetros patronais antes de realizar a classificação.</p></div>:<div className="table-scroll"><table className="employee-table"><thead><tr><th>Código / parâmetro</th><th>Vigência</th><th>Método</th><th>Classificação</th><th>Fundamento documental</th><th>Status</th><th></th></tr></thead><tbody>
     {parameters.map(p=>{const m=mappings.find(x=>x.parameter_table_id===p.id);const locked=m?.status==="validated";return <tr key={p.id}>
      <td><b>{p.table_code}</b><br/><small>{p.title}</small></td>
      <td>{new Date(p.effective_from+"T12:00:00").toLocaleDateString("pt-BR")}{p.effective_to?" a "+new Date(p.effective_to+"T12:00:00").toLocaleDateString("pt-BR"):" em aberto"}</td>
      <td>{p.calculation_method}</td>
      <td>{locked?options.find(x=>x.value===m?.contribution_key)?.label||m?.contribution_key:<select value={keys[p.id]??m?.contribution_key??""} onChange={e=>setKeys(v=>({...v,[p.id]:e.target.value}))}><option value="">Selecione</option>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>}</td>
      <td>{locked?m?.source_reference:<input value={sources[p.id]??m?.source_reference??p.source_reference??""} onChange={e=>setSources(v=>({...v,[p.id]:e.target.value}))} placeholder="Norma, enquadramento ou documento"/>}</td>
      <td><span className={locked?"dependent-active":"dependent-inactive"}>{locked?"Validado":m?"Pendente":"Não classificado"}</span>{m?.validated_at&&<small>{new Date(m.validated_at).toLocaleDateString("pt-BR")}</small>}</td>
      <td>{locked?<span>Imutável</span>:<><button className="employee-secondary" disabled={saving!==""} onClick={()=>void save(p)}><Save size={14}/> Salvar</button>{m&&<button className="employee-secondary" disabled={saving!==""} onClick={()=>void validate(m)}><CheckCircle2 size={14}/> Validar</button>}</>}</td>
     </tr>})}
    </tbody></table></div>}
   </div>
   <div className="dependent-privacy"><AlertTriangle size={16}/> A validação é feita por outro usuário autorizado. Para corrigir uma classificação já validada, encerre a vigência do parâmetro anterior e cadastre uma nova versão. Nenhuma folha histórica será recalculada.</div>
  </section>
 </main>;
}
