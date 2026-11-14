import { useState } from "react";
import { useLoja } from "../lib/LojaContext.jsx";
import { responderTesteAfiliado, subirComissaoAfiliado } from "../lib/afiliadoTesteAcoes.js";

// Botões do teste de 15 dias da comissão de afiliado, direto no cartão (Início e
// Vender mais → Hoje). a = afTeste do aviso (lib/comissaoLoja.js → avisosComissaoLoja).
export default function RespostaTesteAfiliado({ a, onToast }) {
  const { lojaId } = useLoja();
  const [ocupado, setOcupado] = useState(false);
  if (!a) return null;
  async function rodar(fn, ok) {
    setOcupado(true);
    const r = await fn();
    setOcupado(false);
    onToast?.(r?.ok === false ? `Não foi possível salvar: ${r.msg}` : ok);
  }
  if (a.estado === "avaliar")
    return (
      <>
        <button type="button" className="btn btn-mini" disabled={ocupado} onClick={() => rodar(() => responderTesteAfiliado(a.chave, "nao"), `${a.nome}: anotado — ninguém se afiliou com ${a.pct}%`)} title="Ninguém se afiliou nem vendeu nesses dias (confira em Shopee → Marketing → Afiliados)">
          Ninguém se afiliou nem vendeu
        </button>
        <button type="button" className="btn btn-mini" disabled={ocupado} onClick={() => rodar(() => responderTesteAfiliado(a.chave, "sim"), `${a.nome}: ${a.pct}% fica — o aviso some`)} title="Alguém se afiliou ou vendeu: o % fica como está">
          Teve afiliado ou venda
        </button>
      </>
    );
  if (a.estado === "subir")
    return (
      <>
        <button type="button" className="btn btn-mini primary" disabled={ocupado} onClick={() => rodar(() => subirComissaoAfiliado({ lojaId, afTeste: a, pct: a.proximo }), `${a.nome}: ${a.proximo}% registrado — novo teste de 15 dias. Ponha o mesmo % na Shopee.`)} title={`Registra ${a.proximo}% e recomeça o teste de 15 dias`}>
          Subi pra {a.proximo}% na Shopee
        </button>
        <button type="button" className="btn btn-mini" disabled={ocupado} onClick={() => rodar(() => responderTesteAfiliado(a.chave, "manter"), `${a.nome}: fica em ${a.pct}% — o app para de perguntar até você mudar o %`)} title="Fica nesse % e o app para de perguntar até você mudar a comissão">
          Manter {a.pct}%
        </button>
      </>
    );
  return null;
}
