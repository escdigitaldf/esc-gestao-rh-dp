"use client";

import { useState } from "react";
import { Activity, ArrowRight, BriefcaseBusiness, CalendarDays, CheckCircle2, ClipboardList, FileText, LockKeyhole, ShieldCheck, Users, WalletCards, ChartNoAxesCombined } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function Home() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const supabase = createClient();
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } });
        if (error) throw error;
        setMessage("Cadastro iniciado. Verifique seu e-mail para confirmar o acesso.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        window.location.href = "/dashboard";
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível concluir a operação."); }
    finally { setBusy(false); }
  }

  return <main className="shell">
    <section className="hero">
      <header className="topbar">
        <div className="brand"><div className="brand-mark">ESC</div><div><strong>ESC</strong><span>GESTÃO DE RH E DP</span></div></div>
        <div className="top-tag"><span className="pulse" /> Plataforma de gestão de pessoas</div>
      </header>
      <div className="hero-content">
        <div className="eyebrow"><ShieldCheck size={15}/> GESTÃO INTELIGENTE • PESSOAS NO CENTRO</div>
        <h1>Gestão de pessoas<br/><em>com clareza e controle.</em></h1>
        <p className="lead">Centralize rotinas de RH e Departamento Pessoal em uma plataforma segura, organizada e preparada para crescer com sua empresa.</p>
        <div className="feature-grid">
          <div className="feature"><Users/><div><b>Cadastro de colaboradores</b><span>Dados e estrutura organizacional</span></div></div>
          <div className="feature"><CalendarDays/><div><b>Rotinas de RH</b><span>Férias, exames e treinamentos</span></div></div>
          <div className="feature"><WalletCards/><div><b>Departamento pessoal</b><span>Eventos e controles trabalhistas</span></div></div>
          <div className="feature"><ChartNoAxesCombined/><div><b>Indicadores gerenciais</b><span>Painéis e relatórios de gestão</span></div></div>
        </div>
        <div className="trust"><LockKeyhole size={15}/> Acesso protegido • Dados segregados por organização • Auditoria</div>
      </div>
      <div className="hero-foot"><span>ESC DIGITAL</span><span>TECNOLOGIA PARA UMA GESTÃO MAIS HUMANA</span></div>
    </section>
    <section className="auth-side">
      <div className="auth-card">
        <div className="mobile-brand"><div className="brand-mark">ESC</div><b>ESC Gestão de RH e DP</b></div>
        <div className="form-kicker">ÁREA RESTRITA</div>
        <h2>{mode === "login" ? "Bem-vindo de volta" : "Crie seu acesso"}</h2>
        <p className="form-sub">{mode === "login" ? "Entre para acessar seu ambiente de gestão." : "Informe seus dados para iniciar seu cadastro."}</p>
        <div className="tabs"><button className={mode === "login" ? "active" : ""} onClick={() => {setMode("login");setMessage("");setError("");}}>Entrar</button><button className={mode === "signup" ? "active" : ""} onClick={() => {setMode("signup");setMessage("");setError("");}}>Criar acesso</button></div>
        <form onSubmit={submit}>
          {mode === "signup" && <label>Nome completo<input value={name} onChange={e=>setName(e.target.value)} placeholder="Seu nome" required autoComplete="name"/></label>}
          <label>E-mail corporativo<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="voce@empresa.com.br" required autoComplete="email"/></label>
          <label>Senha<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Mínimo de 8 caracteres" required minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"}/></label>
          {error && <div className="notice error">{error}</div>}
          {message && <div className="notice success"><CheckCircle2 size={16}/>{message}</div>}
          <button className="submit" disabled={busy}>{busy ? "Aguarde..." : mode === "login" ? "Acessar plataforma" : "Criar meu acesso"} <ArrowRight size={17}/></button>
        </form>
        <div className="secure-note"><LockKeyhole size={14}/> Seus dados são tratados em ambiente protegido.</div>
        <div className="copyright">© {new Date().getFullYear()} ESC Gestão de RH e DP. Todos os direitos reservados.</div>
      </div>
    </section>
  </main>;
}