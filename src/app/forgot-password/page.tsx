"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email,setEmail]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  async function submit(e:React.FormEvent) {
    e.preventDefault(); setBusy(true); setMessage(""); setError("");
    try {
      const supabase=createClient();
      const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin+"/auth/callback?next=/reset-password"});
      if(error) throw error;
      setMessage("Se o e-mail estiver cadastrado, você receberá as instruções para redefinir a senha.");
    } catch(err) { setError(err instanceof Error?err.message:"Não foi possível solicitar a redefinição."); }
    finally { setBusy(false); }
  }
  return <main className="recovery-shell"><section className="recovery-card"><div className="brand-mark">ESC</div><div className="form-kicker">RECUPERAÇÃO DE ACESSO</div><h1>Esqueceu sua senha?</h1><p>Informe seu e-mail para receber um link seguro de redefinição.</p><form onSubmit={submit}><label>E-mail cadastrado<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="voce@empresa.com.br"/></label>{error&&<div className="notice error">{error}</div>}{message&&<div className="notice success">{message}</div>}<button className="submit" disabled={busy}>{busy?"Enviando...":"Enviar instruções"} <Mail size={17}/></button></form><a className="back-link" href="/"><ArrowLeft size={14}/> Voltar ao login</a></section></main>;
}