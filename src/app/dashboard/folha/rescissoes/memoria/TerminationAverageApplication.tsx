"use client";

import { useState } from "react";
import { ArrowDownToLine, ShieldCheck, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Item = {
  id: string; item_code: string; description: string; item_type: string;
  amount: number; calculation_status: string; calculation_snapshot: Record<string, unknown> | null;
  legal_basis: string | null; reference_period: string | null; reference_quantity: number | null;
  reference_unit: string | null; calculation_base: number | null; rate: number | null;
  source_calculation_item_id: string | null;
};
type Props = {
  organizationId: string; terminationCaseId: string; userId: string;
  items: Item[]; onSaved: () => Promise<void> | void;
};
const money=(v:number)=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const destinations=[
  {value:"thirteenth",label:"13º salário"},
  {value:"vacation",label:"Férias"},
  {value:"notice",label:"Aviso-prévio"},
  {value:"other",label:"Outra verba (especificar)"}
] as const;

export default function TerminationAverageApplication({organizationId,terminationCaseId,userId,items,onSaved}:Props){
  const [destination,setDestination]=useState<Record<string,string>>({});
  const [otherLabel,setOtherLabel]=useState<Record<string,string>>({});
  const [basis,setBasis]=useState<Record<string,string>>({});
  const [confirmed,setConfirmed]=useState<Record<string,boolean>>({});
  const [saving,setSaving]=useState<string|null>(null);
  const [error,setError]=useState("");
  const [success,setSuccess]=useState("");

  const averages=items.filter(x=>x.item_type==="information" && x.item_code.startsWith("MEDIA_"));
  const appliedIds=new Set(items.map(x=>x.source_calculation_item_id).filter((x):x is string=>!!x));

  async function apply(item:Item){
    setError("");setSuccess("");
    const review=(item.calculation_snapshot?.review||{}) as {destination?:string;destination_label?:string;legal_basis?:string};
    const target=destination[item.id]??(item.calculation_status==="reviewed"?review.destination||"": "");
    const targetLabel=target==="other"?(otherLabel[item.id]??review.destination_label??"").trim():destinations.find(x=>x.value===target)?.label||"";
    const legal=(basis[item.id]??(item.calculation_status==="reviewed"?review.legal_basis||"": "")).trim();
    const operatorConfirmed=confirmed[item.id]??item.calculation_status==="reviewed";
    if(!target||!targetLabel||!legal||!operatorConfirmed){
      setError("Defina a verba de destino, informe o fundamento legal/coletivo e confirme a conferência antes de encaminhar a média.");
      return;
    }
    if(item.calculation_status!=="reviewed" && item.calculation_status!=="pending_review"){
      setError("Somente médias informativas pendentes ou revisadas podem ser encaminhadas.");
      return;
    }
    if(appliedIds.has(item.id)){
      setError("Esta média já foi encaminhada para uma verba de destino.");
      return;
    }
    setSaving(item.id);
    const s=createClient();
    if(item.calculation_status!=="reviewed"){
      const previous=item.calculation_snapshot||{};
      const {error:updateError}=await s.from("payroll_termination_calculation_items")
        .update({
          calculation_status:"reviewed",
          review_notes:"Média conferida pelo DP para encaminhamento. A verba derivada permanece pendente de revisão.",
          calculation_snapshot:{
            ...previous,
            review:{status:"reviewed_for_routing",reviewed_by:userId,reviewed_at:new Date().toISOString(),destination:target,destination_label:targetLabel,legal_basis:legal}
          },
          updated_by:userId
        })
        .eq("id",item.id).eq("organization_id",organizationId)
        .eq("termination_case_id",terminationCaseId).eq("item_type","information")
        .eq("calculation_status","pending_review");
      if(updateError){setError(updateError.message);setSaving(null);return;}
    }
    const childCode="MEDIA_INTEGRADA_"+target.toUpperCase()+"_"+item.id.replaceAll("-","").slice(0,12).toUpperCase();
    const {error:insertError}=await s.from("payroll_termination_calculation_items").insert({
      organization_id:organizationId,
      termination_case_id:terminationCaseId,
      source_calculation_item_id:item.id,
      item_code:childCode,
      description:"Média encaminhada para "+targetLabel+" — "+item.description,
      item_type:"earning",
      reference_period:item.reference_period,
      reference_quantity:item.reference_quantity,
      reference_unit:item.reference_unit,
      calculation_base:Number(item.amount),
      rate:null,
      amount:Number(item.amount),
      calculation_method:"formula_pending",
      calculation_status:"pending_review",
      source_parameter_snapshot:{source_item_id:item.id,source_item_code:item.item_code,source_average_amount:Number(item.amount),destination:target,destination_label:targetLabel,legal_basis:legal},
      calculation_snapshot:{
        integration_version:1,
        source:{item_id:item.id,item_code:item.item_code,description:item.description,amount:Number(item.amount),calculation_status:"reviewed"},
        destination:{kind:target,label:targetLabel},
        operator:{user_id:userId,confirmed:true,legal_basis:legal,created_at:new Date().toISOString()},
        controls:[
          "A origem é uma média informativa revisada; não é uma verba definitiva.",
          "O valor foi copiado sem recalcular a verba de destino.",
          "O item derivado permanece pendente de revisão e não pode ser tratado como validado.",
          "A integração jurídica, o período, a base e o critério de cálculo da verba de destino exigem conferência específica."
        ]
      },
      legal_basis:legal,
      review_notes:"Valor encaminhado da média de origem, sem recálculo. Conferir elegibilidade, período, base, divisor e regra legal/coletiva da verba de destino.",
      sort_order:80,
      created_by:userId,
      updated_by:userId
    });
    if(insertError){
      setError(insertError.message);
      setSaving(null);
      return;
    }
    setSuccess("Média encaminhada. Foi criado um provento separado, ainda pendente de revisão; nenhum cálculo de destino foi validado automaticamente.");
    await onSaved();
    setSaving(null);
  }

  if(!averages.length)return null;
  return <section className="payroll-create">
    <div>
      <div className="form-kicker">ETAPA 7 · INTEGRAÇÃO CONTROLADA</div>
      <h2><ArrowDownToLine size={18}/> Encaminhar médias revisadas</h2>
      <p>Uma média informativa nunca entra automaticamente no cálculo. Após conferência, escolha expressamente a verba de destino; o sistema cria um novo provento vinculado à origem e mantém a situação pendente de revisão.</p>
    </div>
    <div className="dependent-privacy"><ShieldAlert size={17}/><span>O encaminhamento não confirma que a média seja juridicamente devida, não recalcula 13º, férias ou aviso-prévio e não altera os pré-cálculos existentes. A verba derivada exige conferência independente.</span></div>
    <div className="form-stack">
      {averages.map(item=>{
        const alreadyApplied=appliedIds.has(item.id);
        const canRoute=item.calculation_status==="reviewed"||item.calculation_status==="pending_review";
        return <article className="employee-list-card payroll-list" key={item.id}>
          <div className="employee-list-head">
            <div><h3>{item.description}</h3><p>{item.item_code} · {item.reference_period||"Período não informado"}</p></div>
            <b>{money(Number(item.amount))}</b>
          </div>
          <div className="dependent-privacy"><ShieldCheck size={16}/><span>Situação da origem: {item.calculation_status==="reviewed"?"Revisada pelo DP":"Pendente de revisão"}</span></div>
          {alreadyApplied?<div className="notice success">Média já encaminhada. A verba de destino continua sujeita à revisão.</div>:
            !canRoute?<div className="notice error">Esta média não está em situação elegível para encaminhamento.</div>:
            <>
              <div className="form-two">
                <label>Verba de destino<select value={destination[item.id]??((item.calculation_snapshot?.review as {destination?:string}|undefined)?.destination||"")} onChange={e=>setDestination(old=>({...old,[item.id]:e.target.value}))}>
                  <option value="">Selecione...</option>{destinations.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}
                </select></label>
                {(destination[item.id]??((item.calculation_snapshot?.review as {destination?:string}|undefined)?.destination||""))==="other"&&<label>Identifique a verba<input value={otherLabel[item.id]??((item.calculation_snapshot?.review as {destination_label?:string}|undefined)?.destination_label||"")} onChange={e=>setOtherLabel(old=>({...old,[item.id]:e.target.value}))} placeholder="Descrição da verba"/></label>}
              </div>
              <label>Fundamento legal ou coletivo específico da verba de destino<input value={basis[item.id]??((item.calculation_snapshot?.review as {legal_basis?:string}|undefined)?.legal_basis||"")} onChange={e=>setBasis(old=>({...old,[item.id]:e.target.value}))} placeholder="Artigo, cláusula CCT/ACT e vigência"/></label>
              <label className="dependent-privacy" style={{alignItems:"center"}}><input type="checkbox" checked={confirmed[item.id]??item.calculation_status==="reviewed"} onChange={e=>setConfirmed(old=>({...old,[item.id]:e.target.checked}))}/><span>Confirmo que conferi a média de origem, a verba de destino, o fundamento aplicável e que o valor encaminhado ainda exige validação independente.</span></label>
              <button className="employee-primary" disabled={saving!==null||!canRoute} onClick={()=>void apply(item)}>{saving===item.id?"Encaminhando...":"Confirmar revisão e criar verba pendente"}</button>
            </>}
        </article>;
      })}
    </div>
    {error&&<div className="notice error">{error}</div>}{success&&<div className="notice success">{success}</div>}
  </section>;
}
