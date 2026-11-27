"use client";
import {useCallback,useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {ArrowLeft,Building2,Check,LockKeyhole,Save,ShieldCheck,Users} from "lucide-react";
import {createClient} from "@/lib/supabase/client";

type Org={id:string;name:string};
type Role={id:string;organization_id:string;role_key:string;name:string;description:string|null;is_system:boolean};
type Member={id:string;user_id:string;role_id:string|null;role:string;status:string;full_name?:string|null};
type Permission={id:string;role_id:string;permission_key:string;allowed:boolean};
const catalog=[
 {group:"Painel e relatórios",items:[["dashboard.view","Visualizar painel"],["reports.view","Visualizar relatórios"],["reports.export","Exportar relatórios"]]},
 {group:"Colaboradores",items:[["employees.view","Visualizar colaboradores"],["employees.create","Cadastrar colaboradores"],["employees.update","Editar colaboradores"],["employees.delete","Excluir colaboradores"],["employees.manage","Gerenciar operações de colaboradores"]]},
 {group:"Estrutura organizacional",items:[["departments.view","Visualizar departamentos"],["departments.manage","Gerenciar departamentos"],["positions.view","Visualizar cargos"],["positions.manage","Gerenciar cargos"]]},
 {group:"Rotinas de RH",items:[["admissions.view","Visualizar admissões"],["admissions.manage","Gerenciar admissões"],["vacations.view","Visualizar férias"],["vacations.manage","Gerenciar férias"],["absences.view","Visualizar afastamentos"],["absences.manage","Gerenciar afastamentos"],["benefits.view","Visualizar benefícios"],["benefits.manage","Gerenciar benefícios"],["documents.view","Visualizar documentos"],["documents.manage","Gerenciar documentos"],["training.view","Visualizar treinamentos"],["training.manage","Gerenciar treinamentos"],["performance.view","Visualizar avaliações"],["performance.manage","Gerenciar avaliações"],["occupational_health.view","Visualizar saúde ocupacional"],["occupational_health.manage","Gerenciar saúde ocupacional"],["attendance.view","Visualizar frequência"],["attendance.manage","Gerenciar frequência"]]},
 {group:"Departamento pessoal",items:[["payroll.view","Visualizar folha"],["payroll.calculate","Calcular folha"],["payroll.close","Fechar folha"],["payroll.events.manage","Gerenciar eventos"],["payroll.termination.manage","Gerenciar rescisões"],["payroll.charges.view","Visualizar encargos"],["payroll.charges.manage","Gerenciar encargos"],["payroll.manage","Gerenciar operações de folha e DP"]]},
 {group:"Administração",items:[["users.view","Visualizar usuários"],["users.manage","Gerenciar usuários"],["audit.view","Visualizar trilha de auditoria"],["roles.manage","Gerenciar perfis e permissões"],["organization.settings","Configurar empresa"]]}
] as const;
export default function AccessManagementPage(){
 const router=useRouter();
 const [orgs,setOrgs]=useState<Org[]>([]);
 const [orgId,setOrgId]=useState("");
 const [roles,setRoles]=useState<Role[]>([]);
 const [members,setMembers]=useState<Member[]>([]);
 const [permissions,setPermissions]=useState<Permission[]>([]);
 const [roleId,setRoleId]=useState("");
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const selectedRole=roles.find(r=>r.id===roleId);
 const load=useCallback(async()=>{
  setLoading(true);setError("");
  const s=createClient();
  const {data:{user}}=await s.auth.getUser();
  if(!user){router.replace("/");return;}
  const {data:ms,error:me}=await s.from("organization_memberships").select("organization_id,role,organizations(id,trade_name,legal_name)").eq("user_id",user.id).eq("status","active");
  if(me){setError(me.message);setLoading(false);return;}
  const os=(ms||[]).map((m:any)=>({id:m.organization_id,name:m.organizations?.trade_name||m.organizations?.legal_name||"Empresa"}));
  setOrgs(os);
  if(!os.length){router.replace("/onboarding");return;}
  const preferred=typeof window!=="undefined"?window.localStorage.getItem("esc_selected_org_id"):null;
  const chosen=os.find(o=>o.id===preferred)||os[0];setOrgId(chosen.id);
  const [rr,mm]=await Promise.all([
   s.from("organization_roles").select("id,organization_id,role_key,name,description,is_system").eq("organization_id",chosen.id).order("name"),
   s.from("organization_memberships").select("id,user_id,role_id,role,status").eq("organization_id",chosen.id).order("created_at")
  ]);
  if(rr.error||mm.error){setError(rr.error?.message||mm.error?.message||"Falha ao carregar permissões.");setLoading(false);return;}
  setRoles(rr.data||[]);
  const memberRows=(mm.data||[]) as unknown as Member[];
  const userIds=[...new Set(memberRows.map(m=>m.user_id))];
  const {data:profiles}=userIds.length?await s.from("user_profiles").select("id,full_name").in("id",userIds):{data:[] as any[]};
  const profileMap=new Map((profiles||[]).map((p:any)=>[p.id,p.full_name]));
  setMembers(memberRows.map(m=>({...m,full_name:profileMap.get(m.user_id)||null})));
  const nextRole=(rr.data||[])[0];
  setRoleId(nextRole?.id||"");
  if(nextRole){const {data:pp,error:pe}=await s.from("organization_role_permissions").select("id,role_id,permission_key,allowed").eq("role_id",nextRole.id);if(pe)setError(pe.message);setPermissions(pp||[]);}
  else setPermissions([]);
  setLoading(false);
 },[router]);
 useEffect(()=>{void load()},[load]);
 async function changeOrg(value:string){
  setOrgId(value);if(typeof window!=="undefined")window.localStorage.setItem("esc_selected_org_id",value);setRoleId("");setPermissions([]);
  const s=createClient();
  const [rr,mm]=await Promise.all([
   s.from("organization_roles").select("id,organization_id,role_key,name,description,is_system").eq("organization_id",value).order("name"),
   s.from("organization_memberships").select("id,user_id,role_id,role,status").eq("organization_id",value).order("created_at")
  ]);
  if(rr.error||mm.error){setError(rr.error?.message||mm.error?.message||"Falha ao trocar empresa.");return;}
  setRoles(rr.data||[]);
  const memberRows=(mm.data||[]) as unknown as Member[];
  const userIds=[...new Set(memberRows.map(m=>m.user_id))];
  const {data:profiles}=userIds.length?await s.from("user_profiles").select("id,full_name").in("id",userIds):{data:[] as any[]};
  const profileMap=new Map((profiles||[]).map((p:any)=>[p.id,p.full_name]));
  setMembers(memberRows.map(m=>({...m,full_name:profileMap.get(m.user_id)||null})));
  const first=rr.data?.[0];if(first){setRoleId(first.id);const p=await s.from("organization_role_permissions").select("id,role_id,permission_key,allowed").eq("role_id",first.id);setPermissions(p.data||[]);}
 }
 async function chooseRole(id:string){
  setRoleId(id);setNotice("");const s=createClient();
  const {data,error}=await s.from("organization_role_permissions").select("id,role_id,permission_key,allowed").eq("role_id",id);
  if(error)setError(error.message);else setPermissions(data||[]);
 }
 function togglePermission(key:string,allowed:boolean){
  if(!selectedRole)return;
  setPermissions(current=>{
   const old=current.find(p=>p.permission_key===key);
   if(old)return current.map(p=>p.permission_key===key?{...p,allowed}:p);
   return [...current,{id:"",role_id:selectedRole.id,permission_key:key,allowed}];
  });
 }
 async function savePermissions(){
  if(!selectedRole)return;setSaving(true);setError("");setNotice("");
  const s=createClient();
  for(const p of permissions){
   const {error}=await s.from("organization_role_permissions").upsert({role_id:selectedRole.id,permission_key:p.permission_key,allowed:p.allowed},{onConflict:"role_id,permission_key"});
   if(error){setError(error.message);setSaving(false);return;}
  }
  setNotice("Permissões do perfil atualizadas para este CNPJ.");setSaving(false);
 }
 async function assign(memberId:string,nextRoleId:string){
  const selected=roles.find(r=>r.id===nextRoleId);if(!selected)return;
  setError("");setNotice("");
  const s=createClient();
  const {error}=await s.from("organization_memberships").update({role_id:selected.id,role:selected.role_key}).eq("id",memberId).eq("organization_id",orgId);
  if(error)setError(error.message);else{setMembers(current=>current.map(m=>m.id===memberId?{...m,role_id:selected.id,role:selected.role_key}:m));setNotice("Perfil atualizado somente para este CNPJ.");}
 }
 const memberCount=members.length;
 if(loading)return <div className="loading-screen">Carregando usuários e permissões...</div>;
 return <main className="dash-content" style={{maxWidth:1120,margin:"0 auto",padding:28}}>
  <header className="module-top" style={{margin:"-28px -28px 28px",width:"calc(100% + 56px)"}}>
   <a href="/dashboard"><ArrowLeft size={16}/> Painel</a>
   <b><span className="brand-mark">ESC</span> Gestão de RH e DP</b>
   <span>Acessos e permissões</span>
  </header>
  <div className="welcome-row"><div><div className="form-kicker">ADMINISTRAÇÃO DO AMBIENTE</div><h1>Acessos e permissões</h1><p>Defina o que cada usuário pode visualizar e executar em cada CNPJ.</p></div><span className="role-chip"><LockKeyhole size={14}/> Controle por empresa</span></div>
  {error&&<div className="notice error">{error}</div>}{notice&&<div className="notice success">{notice}</div>}
  <section className="dashboard-panel" style={{marginBottom:20}}>
   <div className="panel-heading"><div><span>CONTEXTO DE TRABALHO</span><h3><Building2 size={17}/> Empresa / CNPJ</h3></div><span className="role-chip">{memberCount} usuário(s)</span></div>
   <select value={orgId} onChange={e=>void changeOrg(e.target.value)} style={{width:"100%",padding:12,borderRadius:9,border:"1px solid #d8e2ee",background:"#fff"}}>{orgs.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select>
   <p className="alert-disclaimer">As permissões configuradas abaixo valem somente para a empresa selecionada. O mesmo login pode ter outro perfil em outro CNPJ.</p>
  </section>
  <section className="dashboard-panel" style={{marginBottom:20}}>
   <div className="panel-heading"><div><span>USUÁRIOS VINCULADOS</span><h3><Users size={17}/> Perfis por usuário</h3></div><ShieldCheck size={18}/></div>
   {members.length?members.map(m=><div key={m.id} style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(170px,260px)",gap:12,alignItems:"center",padding:"12px 0",borderBottom:"1px solid #edf1f6"}}>
    <div><b>{m.full_name||"Usuário sem nome cadastrado"}</b><div style={{fontSize:11,color:"#718096"}}>{m.user_id.slice(0,8)}… · {m.status}</div></div>
    <select value={m.role_id||""} onChange={e=>void assign(m.id,e.target.value)} style={{padding:10,borderRadius:8,border:"1px solid #d8e2ee",background:"#fff"}}><option value="" disabled>Selecione um perfil</option>{roles.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select>
   </div>):<div className="panel-empty">Nenhum usuário vinculado a esta empresa.</div>}
  </section>
  <section className="dashboard-panel">
   <div className="panel-heading"><div><span>CONTROLE GRANULAR</span><h3><ShieldCheck size={17}/> Permissões por perfil</h3></div><button className="submit" style={{width:"auto",padding:"10px 16px"}} disabled={saving||!selectedRole} onClick={()=>void savePermissions()}><Save size={15}/>{saving?"Salvando...":"Salvar permissões"}</button></div>
   <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:12}}>Perfil que será configurado</label>
   <select value={roleId} onChange={e=>void chooseRole(e.target.value)} style={{width:"100%",padding:12,borderRadius:9,border:"1px solid #d8e2ee",background:"#fff",marginBottom:16}}>{roles.map(r=><option key={r.id} value={r.id}>{r.name}{r.is_system?" · padrão":""}</option>)}</select>
   {selectedRole&&<p className="alert-disclaimer">{selectedRole.description||"Ajuste as permissões deste perfil para a empresa selecionada."} As alterações afetam todos os usuários deste CNPJ que utilizam este perfil.</p>}
   {catalog.map(group=><div key={group.group} style={{padding:"15px 0",borderTop:"1px solid #edf1f6"}}><b>{group.group}</b><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:9,marginTop:10}}>{group.items.map(([key,label])=>{const checked=permissions.find(p=>p.permission_key===key)?.allowed||false;return <label key={key} style={{display:"flex",alignItems:"center",gap:9,fontSize:12,padding:"8px 10px",border:"1px solid #e5ebf2",borderRadius:8}}><input type="checkbox" checked={checked} onChange={e=>togglePermission(key,e.target.checked)}/>{label}</label>})}</div></div>)}
  </section>
  <p className="alert-disclaimer" style={{marginTop:14}}>A tela administrativa já grava perfis e permissões no banco. A aplicação das permissões em todas as rotas e operações exige políticas RLS e verificações nos módulos correspondentes; não trate esta configuração como homologada até concluir essa integração.</p>
 </main>;
}
