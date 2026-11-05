import { useState } from "react";
import Estado from "./Estado.jsx";

// Diagnóstico comercial (lib/diagnostico.js) — um cartão por diagnóstico:
// o que acontece · números · impacto · ação · como fazer · quando reavaliar ·
// o que acompanhar. Usado no Painel do anúncio e em Análise → Diagnóstico.
const TIPO = { problema: "Problema", hipotese: "Hipótese a investigar", oportunidade: "Oportunidade", insuficiente: "Dados insuficientes" };

export function CartaoDiagnostico({ d, onIr, aberto: abertoIni = false }) {
  const [aberto, setAberto] = useState(abertoIni);
  return (
    <div className={`diag-cartao st-borda-${d.estado}`}>
      <div className="diag-cab">
        <Estado tipo={d.estado}>{TIPO[d.tipo] || d.tipo}</Estado>
        <b>{d.titulo}</b>
        <button type="button" className="link-btn" onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>
          {aberto ? "menos" : "ver como fazer"}
        </button>
      </div>
      <div className="diag-evid">{d.evidencia.filter(Boolean).join(" · ")}</div>
      {aberto && (
        <dl className="diag-campos">
          <dt>Por que importa</dt>
          <dd>{d.impacto}</dd>
          <dt>O que fazer</dt>
          <dd>{d.acao}</dd>
          {d.como?.length > 0 && (
            <>
              <dt>Como</dt>
              <dd>
                <ul>
                  {d.como.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </dd>
            </>
          )}
          <dt>Reavaliar</dt>
          <dd>{d.reavaliar}</dd>
          <dt>Acompanhe</dt>
          <dd>{d.sucesso}</dd>
          {d.nota && (
            <>
              <dt>Atenção</dt>
              <dd className="muted-cel">{d.nota}</dd>
            </>
          )}
        </dl>
      )}
      {onIr && d.ir && (
        <button type="button" className="btn btn-mini" onClick={() => onIr(d.ir)}>
          {d.rotulo}
        </button>
      )}
    </div>
  );
}

/** Funil em 4 etapas (impressão → clique → carrinho → pagou), do Desempenho mais recente. */
export function FunilQuatro({ funil, d, referencia: ref }) {
  if (!funil) return null;
  const pct = (v) => (v == null ? "—" : `${(v * 100).toFixed(v < 0.1 ? 1 : 0).replace(".", ",")}%`);
  const etapas = [
    { rot: "Impressões", v: funil.impressoes },
    { rot: "Cliques", v: funil.cliques, taxa: funil.ctr, ref: ref?.ctr, nome: "CTR" },
    { rot: "Foram ao carrinho", v: funil.carrinho, taxa: funil.taxaCarrinho, ref: ref?.carrinho, nome: "dos visitantes" },
    { rot: "Pagaram", v: funil.pedidos, taxa: funil.taxaPagamento, ref: ref?.pagamento, nome: "do carrinho" },
  ];
  return (
    <div className="funil4">
      {etapas.map((e) => (
        <div key={e.rot} className={`funil4-etapa${e.taxa != null && e.ref != null && e.taxa < e.ref ? " baixo" : ""}`}>
          <small>{e.rot}</small>
          <b>{e.v == null ? "—" : Number(e.v).toLocaleString("pt-BR")}</b>
          {e.taxa !== undefined && (
            <span className="muted-cel">
              {pct(e.taxa)} {e.nome}
              {e.ref != null ? ` · ref. ${pct(e.ref)}` : ""}
            </span>
          )}
        </div>
      ))}
      <div className="funil4-rodape muted-cel">
        Desempenho {d ? `${String(d.de).slice(8, 10)}/${String(d.de).slice(5, 7)}–${String(d.ate).slice(8, 10)}/${String(d.ate).slice(5, 7)}` : ""}
        {funil.rejeicao != null ? ` · ${pct(funil.rejeicao)} saíram da página` : ""}
        {funil.busca != null ? ` · ${pct(funil.busca)} dos cliques vieram da busca` : ""}
        {funil.compradores != null ? ` · ${funil.compradores} comprador${funil.compradores === 1 ? "" : "es"}` : ""}
        {funil.recompra != null && funil.recompra > 0 ? ` · recompra ${pct(funil.recompra)}` : ""}
        {ref?.origem ? ` · referência: ${ref.origem}` : ""}
      </div>
    </div>
  );
}

/**
 * Carrinho × venda (05/11/2026, só acompanhamento — sem aviso no Início): quantos foram
 * ao carrinho e quantos pagaram no último Desempenho, × a referência, com uma leitura.
 * `campanha` = proximaCampanha(calendário da loja) — perto dela muita gente espera o preço.
 */
export function CarrinhoVenda({ funil, d, referencia: ref, campanha = null }) {
  if (!d || !funil) return <div className="carrinho-venda muted-cel">Carrinho × venda: suba o Desempenho da Shopee pra ver.</div>;
  if (funil.carrinho == null) return <div className="carrinho-venda muted-cel">Carrinho × venda: o Desempenho guardado não tem a coluna de carrinho — reenvie o arquivo.</div>;
  const pct = (v) => (v == null ? "—" : `${(v * 100).toFixed(v < 0.1 ? 1 : 0).replace(".", ",")}%`);
  const dm = (x) => `${String(x).slice(8, 10)}/${String(x).slice(5, 7)}`;
  const car = Number(funil.carrinho) || 0;
  const ped = Number(funil.pedidos) || 0;
  const taxa = funil.taxaPagamento;
  const refP = ref?.pagamento ?? null;
  const baixa = taxa != null && refP != null && taxa < refP;
  let leitura;
  if (car < 5) leitura = "Poucos carrinhos ainda — só acompanhar.";
  else if (!baixa) leitura = "✓ Dentro do normal — só acompanhar.";
  else if (campanha && campanha.dias >= 0 && campanha.dias <= 7)
    leitura = `Muita gente pode estar esperando a ${campanha.nome} (${campanha.dias === 0 ? "hoje" : `em ${campanha.dias} dia${campanha.dias === 1 ? "" : "s"}`}) — acompanhe, não mexa ainda.`;
  else leitura = "Pagamento baixo: confira o frete na finalização (muitas vezes é o frete caro pra região), o prazo de envio e se a variação que vai pro carrinho é a certa.";
  return (
    <div className={`carrinho-venda${baixa && car >= 5 ? " baixo" : ""}`}>
      <b>Carrinho × venda</b>{" "}
      <span>
        Desempenho {dm(d.de)} a {dm(d.ate)}: {car.toLocaleString("pt-BR")} no carrinho → {ped} pedido{ped === 1 ? "" : "s"} ({pct(taxa)})
        {refP != null ? ` · referência ${pct(refP)}` : ""}
      </span>
      <div className="muted-cel">{leitura}</div>
    </div>
  );
}
