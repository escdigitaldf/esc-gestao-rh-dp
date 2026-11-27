"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CheckCircle2, Edit3, Plus, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Company = {
  id: string;
  legal_name: string;
  trade_name: string | null;
  cnpj: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  tax_regime: string | null;
  status: string;
};

const emptyForm = {
  legal_name: "", trade_name: "", cnpj: "", email: "", phone: "",
  city: "", state: "DF", tax_regime: ""
};

const digits = (value: string) => value.replace(/\\D/g, "");
const formatCnpj = (value: string) => {
  const v = digits(value).slice(0, 14);
  return v.replace(/^(\\d{2})(\\d)/, "$1.$2")
    .replace(/^(\\d{2})\\.(\\d{3})(\\d)/, "$1.$2.$3")
    .replace(/\\.(\\d{3})(\\d)/, ".$1/$2")
    .replace(/(\\d{4})(\\d)/, "$1-$2");
};

export default function CompaniesPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [activeId, setActiveId] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) { router.replace("/"); return; }

    const { data, error: queryError } = await supabase
      .from("organization_memberships")
      .select("organization_id, organizations(id,legal_name,trade_name,cnpj,email,phone,city,state,tax_regime,status)")
      .eq("user_id", user.id)
      .eq("status", "active");

    if (queryError) {
      setError("Não foi possível carregar as empresas vinculadas. " + queryError.message);
      setLoading(false);
      return;
    }

    const rows = (data || []).map((item: any) => item.organizations).filter(Boolean) as Company[];
    setCompanies(rows);
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("esc_selected_org_id") : null;
    setActiveId(rows.some((row) => row.id === saved) ? saved! : rows[0]?.id || "");
    setLoading(false);
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  function update(field: keyof typeof emptyForm, value: string) {
    setForm((current) => ({ ...current, [field]: field === "cnpj" ? formatCnpj(value) : value }));
  }

  function edit(company: Company) {
    setEditingId(company.id);
    setForm({
      legal_name: company.legal_name || "",
      trade_name: company.trade_name || "",
      cnpj: formatCnpj(company.cnpj || ""),
      email: company.email || "",
      phone: company.phone || "",
      city: company.city || "",
      state: company.state || "DF",
      tax_regime: company.tax_regime || ""
    });
    setError("");
    setNotice("");
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const supabase = createClient();
      if (!form.legal_name.trim()) throw new Error("Informe a razão social.");
      const cnpj = digits(form.cnpj);
      if (cnpj && cnpj.length !== 14) throw new Error("O CNPJ deve conter 14 dígitos.");

      if (editingId) {
        const { error: updateError } = await supabase.from("organizations").update({
          legal_name: form.legal_name.trim(),
          trade_name: form.trade_name.trim() || null,
          cnpj: cnpj || null,
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          city: form.city.trim() || null,
          state: form.state || null,
          tax_regime: form.tax_regime || null
        }).eq("id", editingId);
        if (updateError) throw updateError;
        setNotice("Dados da empresa atualizados.");
      } else {
        const { data, error: createError } = await supabase.rpc("create_organization", {
          p_legal_name: form.legal_name.trim(),
          p_trade_name: form.trade_name.trim() || null,
          p_cnpj: cnpj || null,
          p_email: form.email.trim() || null,
          p_phone: form.phone.trim() || null,
          p_city: form.city.trim() || null,
          p_state: form.state || null,
          p_tax_regime: form.tax_regime || null,
          p_full_name: null
        });
        if (createError) throw createError;
        if (!data) throw new Error("O banco não retornou o identificador da nova empresa.");
        if (typeof window !== "undefined") {
          window.localStorage.setItem("esc_selected_org_id", data);
          window.dispatchEvent(new Event("esc:organization-changed"));
        }
        setActiveId(data);
        setNotice("Empresa cadastrada. Os perfis e as permissões iniciais foram preparados.");
      }

      setEditingId(null);
      setForm(emptyForm);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar a empresa.");
    } finally {
      setSaving(false);
    }
  }

  function activate(companyId: string) {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("esc_selected_org_id", companyId);
      window.dispatchEvent(new Event("esc:organization-changed"));
    }
    setActiveId(companyId);
    router.push("/dashboard");
    router.refresh();
  }

  if (loading) return <div className="loading-screen">Carregando empresas vinculadas...</div>;

  return (
    <main className="dash-content" style={{ maxWidth: 1180, margin: "0 auto", padding: 28 }}>
      <div className="welcome-row">
        <div>
          <div className="form-kicker">ADMINISTRAÇÃO DO AMBIENTE</div>
          <h1>Empresas e CNPJs</h1>
          <p>Cadastre estabelecimentos, organize seus CNPJs e alterne o contexto de trabalho sem misturar dados.</p>
        </div>
        <span className="role-chip"><ShieldCheck size={14} /> Acesso por empresa</span>
      </div>

      {error && <div className="notice error" role="alert">{error}</div>}
      {notice && <div className="notice success" role="status">{notice}</div>}

      <section className="dashboard-panel" style={{ marginBottom: 20 }}>
        <div className="panel-heading">
          <div><span>EMPRESAS VINCULADAS</span><h3><Building2 size={17} /> Seus ambientes</h3></div>
          <span className="role-chip">{companies.length} CNPJ(s)</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12 }}>
          {companies.map((company) => (
            <article key={company.id} style={{ border: activeId === company.id ? "2px solid #4778d0" : "1px solid #e3eaf2", borderRadius: 12, padding: 16, background: activeId === company.id ? "#f5f8ff" : "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "start" }}>
                <div style={{ minWidth: 0 }}>
                  <b style={{ display: "block", overflowWrap: "anywhere" }}>{company.trade_name || company.legal_name}</b>
                  <small style={{ color: "#64748b" }}>{company.legal_name}</small>
                </div>
                {activeId === company.id && <span className="status-pill"><CheckCircle2 size={12} /> ATIVA</span>}
              </div>
              <p style={{ margin: "12px 0 4px", fontSize: 13 }}>CNPJ: {company.cnpj ? formatCnpj(company.cnpj) : "Não informado"}</p>
              <p style={{ margin: "0 0 14px", fontSize: 12, color: "#64748b" }}>{[company.city, company.state].filter(Boolean).join(" / ") || "Localização não informada"}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {activeId !== company.id && <button type="button" className="submit" style={{ width: "auto", padding: "9px 12px" }} onClick={() => activate(company.id)}>Acessar empresa</button>}
                <button type="button" className="role-chip" onClick={() => edit(company)}><Edit3 size={13} /> Editar dados</button>
              </div>
            </article>
          ))}
          {!companies.length && <div className="panel-empty">Nenhuma empresa vinculada a este usuário.</div>}
        </div>
      </section>

      <section className="dashboard-panel">
        <div className="panel-heading">
          <div><span>{editingId ? "ATUALIZAÇÃO CADASTRAL" : "EXPANSÃO DO AMBIENTE"}</span><h3><Plus size={17} /> {editingId ? "Editar empresa" : "Cadastrar novo CNPJ"}</h3></div>
          <button type="button" className="role-chip" onClick={() => void load()}><RefreshCw size={13} /> Atualizar lista</button>
        </div>
        <form onSubmit={submit} className="onboard-form">
          <div className="form-section-title">Identificação da empresa</div>
          <label>Razão social *<input required value={form.legal_name} onChange={(e) => update("legal_name", e.target.value)} placeholder="Nome empresarial" /></label>
          <label>Nome fantasia<input value={form.trade_name} onChange={(e) => update("trade_name", e.target.value)} placeholder="Nome utilizado comercialmente" /></label>
          <div className="form-two">
            <label>CNPJ<input inputMode="numeric" maxLength={18} value={form.cnpj} onChange={(e) => update("cnpj", e.target.value)} placeholder="00.000.000/0000-00" /></label>
            <label>Regime tributário<select value={form.tax_regime} onChange={(e) => update("tax_regime", e.target.value)}><option value="">Selecione</option><option>Simples Nacional</option><option>Lucro Presumido</option><option>Lucro Real</option><option>Imune/Isenta</option><option>Outro</option></select></label>
          </div>
          <div className="form-section-title">Contato e localização</div>
          <div className="form-two">
            <label>E-mail<input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} placeholder="rh@empresa.com.br" /></label>
            <label>Telefone<input value={form.phone} onChange={(e) => update("phone", e.target.value)} placeholder="(61) 00000-0000" /></label>
          </div>
          <div className="form-two">
            <label>Cidade<input value={form.city} onChange={(e) => update("city", e.target.value)} placeholder="Brasília" /></label>
            <label>UF<select value={form.state} onChange={(e) => update("state", e.target.value)}>{["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"].map((uf) => <option key={uf}>{uf}</option>)}</select></label>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="submit" disabled={saving} style={{ width: "auto", minWidth: 190 }}><Save size={15} /> {saving ? "Salvando..." : editingId ? "Salvar alterações" : "Cadastrar empresa"}</button>
            {editingId && <button type="button" className="role-chip" onClick={resetForm}>Cancelar edição</button>}
          </div>
        </form>
        <p className="alert-disclaimer" style={{ marginTop: 14 }}>Cada CNPJ mantém seus próprios colaboradores, folha, documentos, parâmetros e permissões. O usuário só consegue alternar entre empresas às quais possui vínculo ativo.</p>
      </section>
    </main>
  );
}
