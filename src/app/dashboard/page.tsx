"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, Bell, CalendarDays, ChevronDown, ClipboardList, FileText, LayoutDashboard, LogOut, Search, Settings, Users, WalletCards } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function Dashboard() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("Minha organização");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const {data:{user},error} = await supabase.auth.getUser();
      if (error || !user) { router.replace("/"); return; }
      setEmail(user.email ?? "");
      const {data: memberships} = await supabase.from("organization_memberships").select("organization_id").eq("user_id",user.id).eq("status","active").limit(1);
      if (!memberships?.length) { router.replace("/onboarding"); return; }
      const orgId = memberships[0].organization_id;
      const {data:org} = await supabase.from("organizations").select("trade_name,legal_name").eq("id",orgId).single();
      if (org) setCompany(org.trade_name || org.legal_name);
      setLoading(false);
    }
    void load();
  }, [router]);
  async function logout() { const supabase = createClient(); await supabase.auth.signOut(); router.replace("/"); router.refresh(); }
  if (loading) return <div className="loading-screen">Carregando ambiente seguro...</div>;
  const items = [{icon:LayoutDashboard,label:"Visão geral",href:"/dashboard",active:true},{icon:Users,label:"Colaboradores",href:"/dashboard/colaboradores"},{icon:ClipboardList,label:"Admissões",href:"#"}, {icon:CalendarDays,label:"Férias e afastamentos",href:"#"},{icon:Activity,label:"Saúde ocupacional",href:"#"},{icon:FileText,label:"Treinamentos",href:"#"},{icon:WalletCards,label:"Departamento pessoal",href:"#"},{icon:Settings,label:"Configurações",href:"#"}];
  return <main className="dash-shell">
    <aside className="sidebar"><div className="brand side-brand"><div className="brand-mark">ESC</div><div><strong>ESC</strong><span>GESTÃO DE RH E DP</span></div></div><div className="side-label">MENU PRINCIPAL</div><nav>{items.map(item=><a key={item.label} className={item.active?"nav-item selected":"nav-item"} href={item.href}><item.icon size={18}/>{item.label}</a>)}</nav><div className="side-bottom"><div className="tenant-chip"><div className="tenant-avatar">{company.slice(0,1).toUpperCase()}</div><div><b>{company}</b><span>Ambiente da empresa</span></div><ChevronDown size={15}/></div><button className="logout" onClick={logout}><LogOut size={17}/> Sair da plataforma</button></div></aside>
    <section className="dash-main"><header className="dash-top"><div className="searchbox"><Search size={17}/><span>Buscar recursos...</span></div><div className="top-actions"><button aria-label="Notificações"><Bell size={19}/></button><div className="user-pill"><div className="user-avatar">{email.slice(0,1).toUpperCase()}</div><span>{email}</span></div></div></header>
      <div className="dash-content"><div className="welcome-row"><div><div className="form-kicker">PAINEL DE CONTROLE</div><h1>Visão geral</h1><p>Bem-vindo ao ambiente de gestão de {company}.</p></div><div className="date-chip"><CalendarDays size={16}/> {new Date().toLocaleDateString("pt-BR",{day:"2-digit",month:"long",year:"numeric"})}</div></div>
      <div className="setup-banner"><div className="setup-icon"><Activity/></div><div><b>Ambiente empresarial configurado</b><p>Comece cadastrando departamentos, cargos e colaboradores.</p></div><span className="status-pill">ATIVO</span></div>
      <div className="section-heading"><h2>Indicadores de RH</h2><span>Indicadores atualizados conforme os cadastros</span></div>
      <div className="metric-grid">{[{label:"Colaboradores ativos",value:"—",icon:Users},{label:"Férias programadas",value:"—",icon:CalendarDays},{label:"Exames pendentes",value:"—",icon:Activity},{label:"Treinamentos",value:"—",icon:FileText}].map(m=><div className="metric-card" key={m.label}><div className="metric-top"><span>{m.label}</span><m.icon size={19}/></div><strong>{m.value}</strong><small>Aguardando registros</small></div>)}</div>
      <div className="section-heading"><h2>Acesso rápido</h2><span>Atalhos para os módulos principais</span></div>
      <div className="quick-grid">{items.slice(1,7).map(item=><a href={item.href} className="quick-card" key={item.label}><div><item.icon size={20}/></div><b>{item.label}</b><span>Acessar módulo <span aria-hidden>→</span></span></a>)}</div>
      <div className="footer-note">ESC Gestão de RH e DP <span>•</span> Plataforma em implantação</div></div>
    </section>
  </main>;
}