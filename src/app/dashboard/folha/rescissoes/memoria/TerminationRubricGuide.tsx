import { AlertCircle, CheckCircle2, ClipboardCheck } from "lucide-react";

type Props={reason:string;noticeType:string};
type GuideItem={code:string;title:string;detail:string;level:"review"|"conditional"|"special"};
const common:GuideItem[]=[
 {code:"SALDO_SALARIO",title:"Saldo de salário",detail:"Conferir dias efetivamente devidos no mês, faltas, afastamentos e adiantamentos.",level:"review"},
 {code:"FERIAS_VENCIDAS",title:"Férias adquiridas/vencidas + 1/3",detail:"Verificar períodos aquisitivos, concessivos, pagamentos e eventual dobra por atraso.",level:"review"},
 {code:"FERIAS_PROP",title:"Férias proporcionais + 1/3",detail:"Conferir período aquisitivo incompleto, projeção do aviso e hipóteses legais de exclusão.",level:"review"},
 {code:"DECIMO_PROP",title:"13º salário proporcional",detail:"Conferir avos por competência, fração mínima de 15 dias, projeção do aviso e afastamentos com regra própria.",level:"review"},
 {code:"VARIAVEIS",title:"Médias e parcelas variáveis",detail:"Revisar comissões, horas extras, adicionais, DSR, gratificações e critérios da norma coletiva.",level:"review"},
 {code:"DESCONTOS",title:"Descontos e compensações",detail:"Validar adiantamentos, faltas, aviso, benefícios, consignações e limites legais de desconto.",level:"review"},
 {code:"FGTS",title:"FGTS e movimentação",detail:"Conferir depósitos devidos, competências pendentes e modalidade de saque aplicável.",level:"review"},
 {code:"DOCUMENTOS",title:"Documentos e obrigações",detail:"Conferir TRCT, evento de desligamento no eSocial, CTPS Digital, prazos e comprovantes.",level:"review"}
];
const guides:Record<string,GuideItem[]> = {
 employer_without_cause:[...common,{code:"AVISO",title:"Aviso-prévio e projeção",detail:"Definir aviso trabalhado ou indenizado, proporcionalidade por tempo de serviço e data projetada.",level:"review"},{code:"MULTA_FGTS",title:"Indenização do FGTS",detail:"Conferir base rescisória, depósitos e indenização de 40%, inclusive diferenças.",level:"review"}],
 employee_resignation:[...common,{code:"AVISO",title:"Aviso-prévio no pedido de demissão",detail:"Verificar cumprimento, dispensa pelo empregador ou eventual desconto juridicamente permitido.",level:"conditional"}],
 mutual_agreement:[...common,{code:"AVISO",title:"Aviso-prévio no acordo",detail:"Se indenizado, conferir a parcela devida pela metade; se trabalhado, validar o tratamento aplicável.",level:"review"},{code:"MULTA_FGTS",title:"Indenização do FGTS no acordo",detail:"Conferir a indenização de 20% e a modalidade de movimentação da conta vinculada.",level:"review"}],
 employer_with_cause:[...common.filter(x=>!["FERIAS_PROP","DECIMO_PROP"].includes(x.code)),{code:"JUSTA_CAUSA",title:"Enquadramento da justa causa",detail:"Exigir revisão jurídica/documental da falta grave, imediatidade, proporcionalidade e prova. Não presumir validade.",level:"special"}],
 fixed_term_end:[...common,{code:"CONTRATO",title:"Término normal do contrato a prazo",detail:"Conferir termo final, cláusulas, prorrogações e eventual cláusula assecuratória do direito recíproco de rescisão.",level:"special"},{code:"INDENIZACAO",title:"Indenização por ruptura antecipada",detail:"Analisar somente se houve encerramento antes do termo e a hipótese legal/contratual correspondente.",level:"conditional"}],
 indirect_termination:[...common,{code:"AVISO",title:"Aviso-prévio e projeção",detail:"Conferir efeitos rescisórios após reconhecimento da rescisão indireta; situação pode depender de decisão/acordo.",level:"special"},{code:"MULTA_FGTS",title:"Indenização do FGTS",detail:"Conferir tratamento equivalente à dispensa imotivada após validação do enquadramento.",level:"special"}],
 death:[...common,{code:"BENEFICIARIOS",title:"Pagamento a dependentes/sucessores",detail:"Confirmar habilitação e documentação dos beneficiários, observando a legislação específica.",level:"special"}],
 other:[...common,{code:"ENQUADRAMENTO",title:"Enquadramento jurídico da modalidade",detail:"Definir a hipótese legal e validar todas as parcelas antes de montar a memória.",level:"special"}]
};
const labels={review:"Conferência obrigatória",conditional:"Depende da hipótese",special:"Análise específica"};
export default function TerminationRubricGuide({reason,noticeType}:Props){
 const items=guides[reason]||guides.other;
 return <section className="payroll-create">
  <div><div className="form-kicker">ROTEIRO DE CONFERÊNCIA</div><h2><ClipboardCheck size={18}/> Verbas e pontos a revisar</h2><p>Roteiro orientativo por modalidade. A presença de um item não confirma direito automático nem define valor.</p></div>
  <div className="employee-list-card payroll-list"><div className="table-scroll"><table className="employee-table"><thead><tr><th>Rubrica/ponto</th><th>Conferência necessária</th><th>Tratamento</th></tr></thead><tbody>{items.map(x=><tr key={x.code}><td><b>{x.title}</b><br/><small>{x.code}</small></td><td>{x.detail}</td><td><span className="dependent-inactive">{labels[x.level]}</span></td></tr>)}</tbody></table></div></div>
  <div className="dependent-privacy"><AlertCircle size={16}/><span>Aviso informado: <b>{noticeType==="worked"?"Trabalhado":noticeType==="indemnified"?"Indenizado":noticeType==="waived"?"Dispensado":noticeType==="not_applicable"?"Não aplicável":"Pendente de definição"}</b>. A modalidade do aviso altera a análise de datas e parcelas; confirme a documentação antes de lançar valores.</span></div>
  <div className="dependent-privacy"><CheckCircle2 size={16}/><span>Esta matriz não calcula, não exclui direitos por conta própria e não substitui análise da CLT, jurisprudência, instrumento coletivo e documentos do caso.</span></div>
 </section>;
}
