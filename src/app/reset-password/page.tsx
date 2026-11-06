"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router=useRouter();
  const [password,setPassword]=useState("");
  const [confirm,setConfirm]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  async function submit(e:React.FormEvent) {
    e.preventDefault(); setError(""); setMessage("");
    if(password.length<8){setError("A senha precisa ter pelo menos 8 caracteres.");return;}
    if(password!==confirm){setError("As senhas não coincidem.");return;}
    setBusy(true);
    try {
      const supabase=createClient();
      const {error}=await supabase.auth.updateUser({password});
      if(error) throw error;
      setMessage("Senha atualizada com sucesso.");
      setTimeout(()=>router.replace("/"),1200);
    } catch(err){setError(err instanceof Error?err.message:"Não foi possível atualizar a senha.");}
    finally{setBusy(false);}
  }
  return <main className="recovery-shell"><section className="recovery-card"><div className="brand-mark">ESC</div><div className="form-kicker">SEGURANÇA DA CONTA</div><h1>Defina uma nova senha</h1><p>Escolha uma senha forte com pelo menos oito caracteres.</p><form onSubmit={submit}><label>Nova senha<input type="password" required minLength={8} value={password} onChange={e=>setPassword(e.target.value)} autoComplete="new-password"/></label><label>Confirme a nova senha<input type="password" required minLength={8} value={confirm} onChange={e=>setConfirm(e.target.value)} autoComplete="new-password"/></label>{error&&<div className="notice error">{error}</div>}{message&&<div className="notice success">{message}</div>}<button className="submit" disabled={busy}>{busy?"Atualizando...":"Atualizar senha"} <KeyRound size={17}/></button></form></section></main>;
}