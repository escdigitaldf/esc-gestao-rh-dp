"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, CheckCircle2, Edit3, Plus, RefreshCw, Save, Search, ShieldCheck, X } from "lucide-react";
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

const digits = (value: string) => value.replace(/\D/g, "");
const formatCnpj = (value: string) => {
  const v = digits(value).slice(0, 14);
  return v
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
};

export default function CompaniesPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [activeId, setActiveId] = useState("");
  const [activeCompanyName, setActiveCompanyName] = useState("Empresa");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      router.replace("/");
      return;
    }

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
    const selected = rows.find((row) => row.id === saved) || rows[0];
    setActiveId(selected?.id || "");
    setActiveCompanyName(selected?.trade_name || selected?.legal_name || "Empresa");
    setLoading(false);
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  const filteredCompanies = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    if (!term) return companies;
    return companies.filter((company) =>
      [company.legal_name, company.trade_name || "", company.cnpj || "", company.city || "", company.state || ""]
        .join(" ").toLocaleLowerCase("pt-BR").includes(term)
    );
  }, [companies, search]);

  function update(field: keyof typeof emptyForm, value: string) {
    setForm((current) => ({ ...current, [field]: field === "cnpj" ? formatCnpj(value) : value }));
  }

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
    setNotice("");
    setOpen(true);
  }

  function startEdit(company: Company) {
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
    setOpen(true);
  }

  function closeForm() {
    if (saving) return;
    setOpen(false);
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
      }

      setOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      await load();
      setNotice(editingId ? "Dados da empresa atualizados." : "Empresa cadastrada. Os perfis e as permissões iniciais foram preparados.");
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
    const selected = companies.find((company) => company.id === companyId);
    setActiveCompanyName(selected?.trade_name || selected?.legal_name || "Empresa");
    router.push("/dashboard");
    router.refresh();
  }

  if (loading) return <div className="loading-screen">Carregando empresas vinculadas...</div>;

  return (
    <main className="module-shell">
      <header className="module-top">
        <a href="/dashboard"><ArrowLeft size={16} /> Painel</a>
        <b><span className="brand-mark">ESC</span> Gestão de RH e DP</b>
        <span>{activeCompanyName}</span>
      </header>

      <section className="module-content">
        <div className="module-heading">
          <div>
            <div className="form-kicker">ADMINISTRAÇÃO DO AMBIENTE</div>
            <h1>Empresas e CNPJs</h1>
            <p>Gerencie as empresas vinculadas, cadastre novos CNPJs e alterne o ambiente de trabalho.</p>
          </div>
          <button className="employee-primary" onClick={startCreate}><Plus size={16} /> Nova empresa</button>
        </div>

        {error && !open && <div className="notice error" role="alert">{error}</div>}
        {notice && <div className="notice success" role="status">{notice}</div>}

        <div className="module-toolbar">
          <div className="employee-search">
            <Search size={16} />
            <input
              aria-label="Pesquisar empresas"
              placeholder="Pesquisar por razão social, nome fantasia ou CNPJ..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <span>{companies.length} empresa(s) vinculada(s)</span>
          <button className="employee-secondary" type="button" onClick={() => void load()}><RefreshCw size={14} /> Atualizar</button>
        </div>

        <div className="module-grid">
          {filteredCompanies.map((company) => (
            <article className="module-item company-item" key={company.id}>
              <div className="module-item-icon"><Building2 /></div>
              <div className="module-item-main">
                <b>{company.trade_name || company.legal_name}</b>
                <span>{company.legal_name}</span>
                <p>CNPJ: {company.cnpj ? formatCnpj(company.cnpj) : "Não informado"}</p>
                <p>{[company.city, company.state].filter(Boolean).join(" / ") || "Localização não informada"} · {company.tax_regime || "Regime não informado"}</p>
                {activeId === company.id && <span className="status-pill"><CheckCircle2 size={12} /> Empresa ativa</span>}
              </div>
              <div className="module-item-actions company-actions">
                {activeId !== company.id && <button type="button" onClick={() => activate(company.id)} aria-label="Acessar empresa" title="Acessar empresa"><CheckCircle2 size={16} /></button>}
                <button type="button" onClick={() => startEdit(company)} aria-label="Editar empresa" title="Editar empresa"><Edit3 size={16} /></button>
              </div>
            </article>
          ))}
          {!filteredCompanies.length && (
            <div className="module-empty">
              {companies.length ? "Nenhuma empresa corresponde à pesquisa." : "Nenhuma empresa vinculada a este usuário."}
            </div>
          )}
        </div>
      </section>

      {open && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeForm(); }}>
          <section className="employee-modal company-modal" role="dialog" aria-modal="true" aria-labelledby="company-modal-title">
            <div className="modal-heading">
              <div>
                <div className="form-kicker">CADASTRO ORGANIZACIONAL</div>
                <h2 id="company-modal-title">{editingId ? "Editar empresa" : "Cadastrar nova empresa"}</h2>
              </div>
              <button type="button" onClick={closeForm} aria-label="Fechar formulário"><X /></button>
            </div>
            <form onSubmit={submit}>
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
              {error && <div className="notice error" role="alert">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="employee-secondary" onClick={closeForm} disabled={saving}>Cancelar</button>
                <button className="employee-primary" disabled={saving}><Save size={15} /> {saving ? "Salvando..." : editingId ? "Salvar alterações" : "Cadastrar empresa"}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
