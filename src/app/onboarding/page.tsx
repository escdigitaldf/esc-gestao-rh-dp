"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CheckCircle2, ChevronLeft, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [emailUser, setEmailUser] = useState("");
  const [form, setForm] = useState({ legal_name:"", trade_name:"", cnpj:"", email:"", phone:"", city:"", state:"DF", tax_regime:"", full_name:"" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({data,error}) => {
      if (error || !data.user) { router.replace("/"); return; }
      setEmailUser(data.user.email ?? "");
      setForm(v => ({...v,email:data.user.email ?? "",full_name:String(data.user.user_metadata?.full_name ?? "")}));
      const {data: memberships} = await supabase.from("organization_memberships").select("organization_id").eq("user_id",data.user.id).eq("status","active").limit(1);
      if (memberships?.length) { router.replace("/dashboard"); return; }
      setLoading(false);
    });
  }, [router]);

  function update(field: keyof typeof form, value: string) { setForm(v => ({...v,[field]:value})); }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError(""); setSuccess("");
    try {
      const supabase = createClient();
      const {data,error} = await supabase.rpc("create_organization", {
        p_legal_name:form.legal_name, p_trade_name:form.trade_name || null,
        p_cnpj:form.cnpj || null, p_email:form.email || null, p_phone:form.phone || null,
        p_city:form.city || null, p_state:form.state || null,
        p_tax_regime:form.tax_regime || null, p_full_name:form.full_name || null
      });
      if (error) throw error;
      if (!data) throw new Error("O banco não retornou o identificador da organização.");
      setSuccess("Empresa cadastrada. Seu usuário foi definido como proprietário.");
      router.replace("/dashboard");
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível cadastrar a empresa."); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="loading-screen">Verificando seu acesso...</div>;
  return <main className="onboard-shell">
    <header className="onboard-top"><a href="/"><span className="brand-mark">ESC</span><b>ESC Gestão de RH e DP</b></a><span><ShieldCheck size={15}/> Ambiente protegido</span></header>
    <section className="onboard-card">
      <div className="onboard-icon"><Building2 size={23}/></div>
      <div className="form-kicker">CONFIGURAÇÃO INICIAL • 01/03</div>
      <h1>Cadastre sua empresa</h1>
      <p>Essas informações criarão seu ambiente exclusivo. Você será o proprietário e poderá convidar os demais usuários depois.</p>
      <div className="account-line"><CheckCircle2 size={16}/> Acesso autenticado: {emailUser}</div>
      <form onSubmit={submit} className="onboard-form">
        <div className="form-section-title">Identificação da empresa</div>
        <label>Razão social *<input required value={form.legal_name} onChange={e=>update("legal_name",e.target.value)} placeholder="Nome empresarial"/></label>
        <label>Nome fantasia<input value={form.trade_name} onChange={e=>update("trade_name",e.target.value)} placeholder="Nome utilizado comercialmente"/></label>
        <div className="form-two"><label>CNPJ<input inputMode="numeric" maxLength={18} value={form.cnpj} onChange={e=>update("cnpj",e.target.value)} placeholder="00.000.000/0000-00"/></label><label>Regime tributário<select value={form.tax_regime} onChange={e=>update("tax_regime",e.target.value)}><option value="">Selecione</option><option>Simples Nacional</option><option>Lucro Presumido</option><option>Lucro Real</option><option>Imune/Isenta</option><option>Outro</option></select></label></div>
        <div className="form-section-title">Contato e localização</div>
        <div className="form-two"><label>E-mail<input type="email" value={form.email} onChange={e=>update("email",e.target.value)} placeholder="rh@empresa.com.br"/></label><label>Telefone<input value={form.phone} onChange={e=>update("phone",e.target.value)} placeholder="(61) 00000-0000"/></label></div>
        <div className="form-two"><label>Cidade<input value={form.city} onChange={e=>update("city",e.target.value)} placeholder="Brasília"/></label><label>UF<select value={form.state} onChange={e=>update("state",e.target.value)}>{["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"].map(uf=><option key={uf}>{uf}</option>)}</select></label></div>
        <div className="form-section-title">Responsável pelo ambiente</div>
        <label>Nome completo do administrador *<input required value={form.full_name} onChange={e=>update("full_name",e.target.value)} placeholder="Nome do responsável"/></label>
        {error && <div className="notice error">{error}</div>}
        {success && <div className="notice success">{success}</div>}
        <button className="submit" disabled={saving}>{saving?"Salvando empresa...":"Criar ambiente da empresa"} <Building2 size={17}/></button>
      </form>
      <div className="onboard-foot"><a href="/"><ChevronLeft size={14}/> Voltar ao acesso</a><span>Período inicial de avaliação: 14 dias</span></div>
    </section>
  </main>;
}