"use client";
import {useCallback,useEffect,useState} from "react";
import {useParams,useRouter,useSearchParams} from "next/navigation";
import {ArrowLeft,FileText,Upload,Download,Trash2,ShieldCheck,FolderOpen,FileCheck2,Search,AlertCircle,Printer} from "lucide-react";
import {createClient} from "@/lib/supabase/client";
import {resolveActiveOrganization} from "@/lib/organization-context";
type Doc={id:string;category:string;title:string;description:string|null;original_filename:string;storage_path:string;mime_type:string;file_size:number;document_number:string|null;issue_date:string|null;expiry_date:string|null;is_confidential:boolean;created_at:string};
type Employee={id:string;full_name:string;employee_code:string;cpf:string};
const categories=[{value:"registro",label:"Documentos de registro"},{value:"identificacao",label:"Identificação pessoal"},{value:"contrato",label:"Contrato e aditivos"},{value:"admissao",label:"Documentos admissionais"},{value:"trabalhista",label:"Documentos trabalhistas"},{value:"saude_ocupacional",label:"Saúde ocupacional"},{value:"dependentes",label:"Dependentes"},{value:"remuneracao",label:"Remuneração"},{value:"certificados",label:"Certificados e treinamentos"},{value:"outros",label:"Outros documentos"}];
const allowed=["application/pdf","image/jpeg","image/png","image/webp","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","text/plain"];
function sizeLabel(n:number){return n<1024*1024?(n/1024).toFixed(0)+" KB":(n/1024/1024).toFixed(2)+" MB";}
export default function EmployeeDocumentsPage(){
 const params=useParams<{id:string}>();const employeeId=params.id;const router=useRouter();const searchParams=useSearchParams();
 const [orgId,setOrgId]=useState("");const [employee,setEmployee]=useState<Employee|null>(null);const [docs,setDocs]=useState<Doc[]>([]);const [loading,setLoading]=useState(true);const [uploading,setUploading]=useState(false);const [error,setError]=useState("");const [success,setSuccess]=useState("");const [search,setSearch]=useState("");const [category,setCategory]=useState("registro");const [title,setTitle]=useState("");const [description,setDescription]=useState("");const [docNumber,setDocNumber]=useState("");const [issueDate,setIssueDate]=useState("");const [expiryDate,setExpiryDate]=useState("");const [confidential,setConfidential]=useState(false);
 const load=useCallback(async()=>{const s=createClient();const {data:{user},error:auth}=await s.auth.getUser();if(auth||!user){router.replace("/");return;}const {membership:m,error:me}=await resolveActiveOrganization(s,user.id);if(me||!m){setError(me?.message||"Nenhuma empresa vinculada.");setLoading(false);return;}setOrgId(m.organization_id);const [{data:e,error:ee},{data:d,error:de}]=await Promise.all([s.from("employees").select("id,full_name,employee_code,cpf").eq("id",employeeId).eq("organization_id",m.organization_id).single(),s.from("employee_documents").select("*").eq("employee_id",employeeId).eq("organization_id",m.organization_id).order("created_at",{ascending:false})]);if(ee||de)setError(ee?.message||de?.message||"Falha ao carregar documentos.");setEmployee(e);setDocs(d||[]);setLoading(false);},[employeeId,router]);
 useEffect(()=>{void load()},[load]);
 useEffect(()=>{const requested=searchParams.get("categoria");if(requested&&categories.some(x=>x.value===requested))setCategory(requested);},[searchParams]);
 const visible=docs.filter(d=>(d.title+" "+d.original_filename+" "+d.category).toLowerCase().includes(search.toLowerCase()));
 async function upload(file?:File){
  if(!file)return;
  setError("");setSuccess("");
  if(!allowed.includes(file.type)){setError("Formato não permitido. Envie PDF, JPG, PNG, WEBP, DOC, DOCX, XLS, XLSX ou TXT.");return;}
  if(file.size>20*1024*1024){setError("O arquivo ultrapassa o limite de 20 MB.");return;}
  if(!title.trim()){setError("Informe um título para o documento.");return;}
  setUploading(true);
  const s=createClient();
  let path="";
  try{
   const {data:{user}}=await s.auth.getUser();
   if(!user)throw new Error("Sessão expirada. Entre novamente.");
   const ext=file.name.includes(".")?file.name.split(".").pop()!.toLowerCase():"bin";
   path=orgId+"/"+employeeId+"/"+crypto.randomUUID()+"."+ext;
   const documentRecord={organization_id:orgId,employee_id:employeeId,category,title:title.trim(),description:description||null,original_filename:file.name,storage_path:path,mime_type:file.type,file_size:file.size,document_number:docNumber||null,issue_date:issueDate||null,expiry_date:expiryDate||null,is_confidential:confidential,uploaded_by:user.id};
   // Register first so the Storage RLS policies can authorize both upload
   // and cleanup if the object upload fails.
   const {error:db}=await s.from("employee_documents").insert(documentRecord);
   if(db)throw db;
   const {error:up}=await s.storage.from("employee-documents").upload(path,file,{upsert:false,contentType:file.type});
   if(up){
    const {error:storageCleanup}=await s.storage.from("employee-documents").remove([path]);
    if(storageCleanup){
     throw new Error("O envio falhou e a limpeza do arquivo não foi confirmada. O registro foi mantido para permitir nova conferência e exclusão segura. Detalhe: "+up.message+" / "+storageCleanup.message);
    }
    const {error:recordCleanup}=await s.from("employee_documents").delete().eq("organization_id",orgId).eq("employee_id",employeeId).eq("storage_path",path);
    if(recordCleanup){
     throw new Error("O envio falhou e o arquivo foi removido, mas o registro de controle não pôde ser excluído. Atualize o prontuário e confira o item antes de tentar novamente.");
    }
    throw up;
   }
   setTitle("");setDescription("");setDocNumber("");setIssueDate("");setExpiryDate("");setConfidential(false);
   setSuccess("Documento arquivado no prontuário do colaborador.");
   await load();
  }catch(e){
   setError(e instanceof Error?e.message:"Não foi possível arquivar o documento.");
   await load();
  }finally{setUploading(false);}
 }
 async function download(doc:Doc){const s=createClient();const {data,error}=await s.storage.from("employee-documents").createSignedUrl(doc.storage_path,60);if(error){setError(error.message);return;}window.open(data.signedUrl,"_blank","noopener,noreferrer");}
 async function remove(doc:Doc){
  if(!confirm("Excluir definitivamente este documento do prontuário?"))return;
  setError("");setSuccess("");
  const s=createClient();
  const {error:st}=await s.storage.from("employee-documents").remove([doc.storage_path]);
  // Even if Storage reports an error (for example, an already absent object),
  // attempt the metadata delete. A database trigger verifies that the object
  // is truly absent; if it still exists, the trigger blocks the deletion.
  const {error:db}=await s.from("employee_documents").delete().eq("id",doc.id).eq("organization_id",orgId).eq("employee_id",employeeId);
  if(db){
   setError("A exclusão não foi concluída. O registro foi preservado; confirme as permissões e tente novamente. "+(st?"Storage: "+st.message+" / ":"")+"Banco: "+db.message);
   return;
  }
  setSuccess(st?"Registro removido; o arquivo já não estava disponível no Storage.":"Documento excluído.");
  await load();
 }
 if(loading)return <div className="loading-screen">Carregando prontuário digital...</div>;
 if(!employee)return <main className="module-shell"><div className="module-content"><div className="notice error">{error||"Colaborador não encontrado."}</div><button className="employee-secondary" onClick={()=>router.push("/dashboard/colaboradores")}>Voltar aos colaboradores</button></div></main>;
 return <main className="module-shell"><header className="module-top"><a href={"/dashboard/colaboradores"}><ArrowLeft size={16}/> Colaboradores</a><b><span className="brand-mark">ESC</span> Gestão de RH e DP</b><span>Prontuário digital</span></header><section className="module-content docs-content">
 <div className="module-heading"><div><div className="form-kicker">PRONTUÁRIO DIGITAL · {employee.employee_code}</div><h1>Documentos do colaborador</h1><p>{employee.full_name} · CPF {employee.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,"$1.$2.$3-$4")}</p></div><div className="docs-count"><FolderOpen size={18}/><b>{docs.length}</b><span>arquivado(s)</span></div></div>
 {error&&<div className="notice error">{error}</div>}{success&&<div className="notice success">{success}</div>}
 <div className="docs-layout"><section className="docs-upload-card"><div className="docs-card-heading"><div className="docs-heading-icon"><Upload size={18}/></div><div><h2>Arquivar novo documento</h2><p>O arquivo ficará vinculado à ficha funcional e poderá ser consultado por usuários autorizados.</p></div></div>
 <label>Título do documento *<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Ex.: RG frente e verso, contrato de trabalho"/></label>
 <label>Categoria<select value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
 <label>Descrição / observações<textarea rows={2} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Informações complementares (opcional)"/></label>
 <div className="form-two"><label>Número / referência<input value={docNumber} onChange={e=>setDocNumber(e.target.value)} placeholder="Opcional"/></label><label>Data de emissão<input type="date" value={issueDate} onChange={e=>setIssueDate(e.target.value)}/></label></div>
 <label>Validade / vencimento<input type="date" value={expiryDate} onChange={e=>setExpiryDate(e.target.value)}/></label>
 <label className="docs-check"><input type="checkbox" checked={confidential} onChange={e=>setConfidential(e.target.checked)}/> Documento confidencial</label>
 <label className="docs-file-picker"><input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.txt" disabled={uploading} onChange={e=>{void upload(e.target.files?.[0]);e.currentTarget.value="";}}/><span><Upload size={18}/><b>{uploading?"Enviando e arquivando...":"Selecionar arquivo e arquivar"}</b><small>PDF, imagens, Word, Excel ou TXT · Máximo 20 MB</small></span></label>
 <div className="docs-security"><ShieldCheck size={16}/><span>Armazenamento privado. Acesso restrito a usuários autorizados de RH e administradores da empresa.</span></div></section>
 <section className="docs-list-card"><div className="docs-list-head"><div><h2>Arquivo funcional</h2><p>Documentos vinculados ao cadastro do colaborador</p></div><div className="employee-search"><Search size={15}/><input placeholder="Pesquisar documento..." value={search} onChange={e=>setSearch(e.target.value)}/></div></div>
 {visible.length===0?<div className="module-empty"><FileText size={26}/><p>{search?"Nenhum documento corresponde à pesquisa.":"Nenhum documento arquivado. Comece incluindo documentos de registro e admissão."}</p></div>:<div className="docs-list">{visible.map(doc=><article className="docs-item" key={doc.id}><div className="docs-file-icon"><FileText size={19}/></div><div className="docs-item-info"><b>{doc.title}</b><span>{categories.find(c=>c.value===doc.category)?.label||doc.category} · {sizeLabel(Number(doc.file_size))}</span><small>{doc.original_filename} · {new Date(doc.created_at).toLocaleDateString("pt-BR")}</small>{doc.expiry_date&&<small className={new Date(doc.expiry_date+"T23:59:59")<new Date()?"docs-expired":"docs-valid"}>{new Date(doc.expiry_date+"T12:00:00").toLocaleDateString("pt-BR")} · validade</small>}</div><div className="docs-item-actions"><button onClick={()=>void download(doc)} title="Visualizar / baixar"><Download size={16}/></button><button onClick={()=>void remove(doc)} title="Excluir documento"><Trash2 size={16}/></button></div></article>)}</div>}</section></div>
 <div className="docs-bottom-note"><ShieldCheck size={16}/> Documentos são armazenados em bucket privado, com políticas de acesso por organização. Links de visualização expiram após 60 segundos.</div>
 </section></main>;
}