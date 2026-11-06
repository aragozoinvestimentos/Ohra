import { useMemo, useState } from "react";
import { BRL } from "../lib/format.js";
import { useCrescimento } from "../hooks/useCrescimento.js";
import { useRankingData } from "../hooks/useRankingData.js";
import { cascataDoPeriodo } from "../lib/resumoLoja.js";
import { reposicao, contasAte, proximosDias, partesDoTotal } from "../lib/dinheiroResumo.js";
import { rotuloMes, somarMeses, rotuloCategoria } from "../lib/fluxoCaixa.js";
import CanalTag from "./CanalTag.jsx";
import Ajuda from "./Ajuda.jsx";

// Dinheiro → Resumo (06/11/2026, aprovado pela prévia "Dinheiro — Resumo"):
// quanto a loja tem hoje (por carteira) → de quem é cada parte → lucro mês a
// mês → próximos 7 dias. Só LÊ; os botões abrem os mesmos diálogos do Caixa
// (saque, recarga de Ads, entrada/saída). Contas em lib/dinheiroResumo.js,
// lib/carteiras.js (resumoCarteiras) e lib/resumoLoja.js (cascataDoPeriodo).
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const diaSemana = (iso) => DIAS[new Date(`${iso}T12:00:00`).getDay()];

const PARTES = {
  material: { rot: "Repor material", cor: "var(--accent)", exp: "Material (filamento, falhas, consumíveis) e embalagem das peças vendidas desde o início, menos o que você já comprou. É o que precisa voltar pro estoque." },
  revenda: { rot: "Recompra de revenda", cor: "var(--c-tiktok)", exp: "Custo dos produtos de revenda vendidos (média das notas) menos as compras de mercadoria já lançadas." },
  contas: { rot: "Contas dos próximos 30 dias", cor: "var(--st-atencao)", exp: "Contas fixas, parcelas e contas a pagar até {limite} (atrasadas entram aqui)." },
  impostos: { rot: "Impostos e taxas", cor: "var(--ink-faint)", exp: "Lançamentos de impostos/taxas a pagar até {limite} (ex.: DAS)." },
};

export default function ResumoDinheiro({ lancamentos, resumoCart, hoje, caixinhaAntiga = 0, onTransferir, onRecargaAds, onNovo, onVerLancamentos }) {
  const cres = useCrescimento();
  const { produtos, itens, materiais } = useRankingData();
  const [verConta, setVerConta] = useState(false);
  const pedidos = useMemo(() => cres.pedidosValidos || [], [cres.pedidosValidos]);

  const repor = useMemo(() => reposicao({ pedidos, lancamentos, produtos, itens, materiais, hoje }), [pedidos, lancamentos, produtos, itens, materiais, hoje]);
  const contas = useMemo(() => contasAte(lancamentos, hoje, 30), [lancamentos, hoje]);
  const prox = useMemo(() => proximosDias(lancamentos, hoje, 7), [lancamentos, hoje]);
  const total = resumoCart?.total || 0;
  const div = partesDoTotal({ total, repor, contas });

  // Lucro mês a mês (mesma conta do Resultado → Do mês), do 1º mês com pedido até agora.
  const meses = useMemo(() => {
    const primeiro = pedidos.reduce((m, p) => (p.valido && (!m || String(p.data) < m) ? String(p.data).slice(0, 10) : m), null);
    if (!primeiro) return [];
    const out = [];
    for (let m = primeiro.slice(0, 7); m <= hoje.slice(0, 7) && out.length < 24; m = somarMeses(m, 1)) {
      const [a, mm] = m.split("-").map(Number);
      const fim = `${m}-${String(new Date(a, mm, 0).getDate()).padStart(2, "0")}`;
      const c = cascataDoPeriodo({ pedidos, linhasAds: cres.linhasAds, lancamentos, de: `${m}-01`, ate: fim < hoje ? fim : hoje }).total;
      out.push({ mes: m, parcial: fim >= hoje, c });
    }
    return out;
  }, [pedidos, cres.linhasAds, lancamentos, hoje]);
  const soma = (k) => meses.reduce((t, x) => t + (x.c[k] || 0), 0);

  const carteiras = resumoCart?.carteiras || [];
  const ordem = [...carteiras].sort((a, b) => (a.plataforma ? 1 : 0) - (b.plataforma ? 1 : 0));
  const largura = (v) => (div.comprometido + Math.max(0, div.livre) > 0 ? (v / (div.comprometido + Math.max(0, div.livre))) * 100 : 0);
  const exp = (k) => PARTES[k].exp.replace("{limite}", dm(contas.limite));

  return (
    <div className="dr">
      <div className="panel">
        <h3 className="section-title h3-split">
          <span>Quanto dinheiro a loja tem hoje</span>
          <span className="faint">a soma das contas abaixo</span>
        </h3>
        <div className="dr-total">
          <div className="dr-grande">
            <span>Total da loja</span>
            <b className={total < 0 ? "neg" : ""}>{BRL(total)}</b>
            <p>É o dinheiro que já é seu — na conta da loja ou guardado dentro das plataformas. Sacar só troca de lugar, não muda o total.</p>
          </div>
          <div className="dr-carteiras">
            {ordem.map((c) => (
              <div key={c.id} className="dr-cart">
                <div className="dr-cart-nome">{c.plataforma ? <CanalTag tipo={c.tipo} nome={c.nome} /> : <b>Conta da loja</b>}</div>
                <b className="dr-cart-saldo">{BRL(c.saldo)}</b>
                <small>
                  {!c.plataforma
                    ? "o banco da loja — venda física e saques caem aqui"
                    : c.extrato
                      ? `liberado ${BRL(c.liberado)} · a liberar ${BRL(c.aLiberar)}`
                      : "pelos pedidos entregues (sem extrato)"}
                </small>
                <div className="dr-cart-acoes">
                  {c.plataforma ? (
                    <>
                      <button type="button" className="btn btn-mini primary" onClick={() => onTransferir(c.id)}>
                        ⇄ Sacar pra conta da loja
                      </button>
                      <button type="button" className="btn btn-mini" onClick={() => onRecargaAds(c)} title="Recarga/aporte de Ads nesta plataforma — vira uma saída (categoria Anúncios) no Caixa">
                        + Recarga de Ads
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn btn-mini" onClick={() => onNovo("entrada")}>+ Entrada</button>
                      <button type="button" className="btn btn-mini" onClick={() => onNovo("saida")}>− Saída</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
        {resumoCart?.aCaminho > 0 && (
          <div className="dr-caminho">
            Fora do total: <b>{BRL(resumoCart.aCaminho)} a caminho</b> — pedidos pagos que ainda não foram entregues (entram na plataforma na entrega).
          </div>
        )}
      </div>

      <div className="panel">
        <h3 className="section-title h3-split">
          <span>
            Desse total, de quem é cada parte
            <Ajuda texto="O app calcula sozinho, sem precisar separar: o que precisa voltar pro estoque (pelas vendas e pelas compras lançadas desde o início), as contas que vencem nos próximos 30 dias e os impostos. O resto é livre — é lucro, dá pra retirar ou reinvestir." />
          </span>
          <span className="faint">calculado pelas vendas e compras</span>
        </h3>
        <div className="dr-barra" role="img" aria-label="Divisão do total da loja">
          {div.partes.filter((p) => p.valor > 0).map((p) => (
            <span key={p.chave} style={{ width: `${largura(p.valor)}%`, background: PARTES[p.chave].cor }} title={`${PARTES[p.chave].rot}: ${BRL(p.valor)}`} />
          ))}
          {div.livre > 0 && <span style={{ width: `${largura(div.livre)}%`, background: "var(--st-oportunidade)" }} title={`Livre: ${BRL(div.livre)}`} />}
        </div>
        <table className="dr-partes">
          <tbody>
            {div.partes.map((p) =>
              p.chave === "revenda" && !(repor.revenda.vendido > 0 || repor.revenda.comprado > 0) ? null : p.chave === "impostos" && !contas.nImpostos ? null : (
                <tr key={p.chave}>
                  <td>
                    <div className="dr-rot">
                      <i style={{ background: PARTES[p.chave].cor }} />
                      {PARTES[p.chave].rot}
                    </div>
                    <div className="dr-exp">
                      {exp(p.chave)}
                      {p.chave === "material" && repor.material.falta < 0 && ` Você comprou ${BRL(-repor.material.falta)} a mais do que vendeu — material à frente, não tira nada do livre.`}
                      {p.chave === "revenda" && repor.revenda.falta < 0 && ` Mercadoria à frente: ${BRL(-repor.revenda.falta)}.`}
                      {p.chave === "contas" && contas.nContas > 0 && ` ${contas.nContas} conta${contas.nContas > 1 ? "s" : ""}.`}
                    </div>
                  </td>
                  <td className="num">{BRL(p.valor)}</td>
                </tr>
              )
            )}
            <tr className={div.livre >= 0 ? "dr-livre" : "dr-livre neg"}>
              <td>
                <div className="dr-rot">{div.livre >= 0 ? "Livre — é lucro" : "Falta dinheiro"}</div>
                <div className="dr-exp">{div.livre >= 0 ? "O que sobra depois de repor e pagar o que vence. Pode retirar ou reinvestir." : `Faltam ${BRL(div.falta)} pra cobrir a reposição e as contas dos próximos 30 dias.`}</div>
              </td>
              <td className="num">{BRL(div.livre >= 0 ? div.livre : -div.falta)}</td>
            </tr>
          </tbody>
        </table>
        <div className="dr-conta">
          <button type="button" className="link-btn" onClick={() => setVerConta((v) => !v)}>
            {verConta ? "esconder a conta" : "como o app chegou nesses números"}
          </button>
          {verConta && (
            <table className="dr-conta-tab">
              <tbody>
                <tr>
                  <td>Peças vendidas desde {repor.desde ? dm(repor.desde) + "/" + repor.desde.slice(0, 4) : "o início"}: material + embalagem</td>
                  <td className="num">{BRL(repor.material.vendido)}</td>
                </tr>
                <tr>
                  <td>− Compras de material e embalagem lançadas ({repor.material.n})</td>
                  <td className="num">− {BRL(repor.material.comprado)}</td>
                </tr>
                <tr>
                  <td><b>= {repor.material.falta >= 0 ? "Falta repor" : "Material à frente"}</b></td>
                  <td className="num"><b>{BRL(Math.abs(repor.material.falta))}</b></td>
                </tr>
                {(repor.revenda.vendido > 0 || repor.revenda.comprado > 0) && (
                  <>
                    <tr>
                      <td>Revenda vendida (custo de compra)</td>
                      <td className="num">{BRL(repor.revenda.vendido)}</td>
                    </tr>
                    <tr>
                      <td>− Compras de mercadoria lançadas ({repor.revenda.n})</td>
                      <td className="num">− {BRL(repor.revenda.comprado)}</td>
                    </tr>
                  </>
                )}
                <tr>
                  <td colSpan={2} className="faint">
                    Conta com o custo de hoje de cada produto. Energia, máquina, manutenção e acabamento não entram (energia já está nas contas; a máquina é o fundo da próxima impressora). Compra de material lançada como “outras saídas” não é reconhecida — lance como Filamento/material ou Embalagem.
                    {repor.semCusto > 0 ? ` ${repor.semCusto} venda${repor.semCusto > 1 ? "s" : ""} sem produto cadastrado ficaram de fora.` : ""}
                    {caixinhaAntiga > 0 ? ` Os ${BRL(caixinhaAntiga)} que você tinha separado na caixinha Insumos ficam no histórico, sem somar de novo.` : ""}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>

      {meses.length > 0 && (
        <div className="panel">
          <h3 className="section-title h3-split">
            <span>Lucro mês a mês</span>
            <span className="faint">mesma conta do Resultado → Do mês</span>
          </h3>
          <div className="table-wrap">
            <table className="dr-meses">
              <thead>
                <tr>
                  <th>Mês</th>
                  <th className="num">Faturado</th>
                  <th className="num">Plataformas e impostos</th>
                  <th className="num">Custo</th>
                  <th className="num">Ads</th>
                  <th className="num">Contas fixas</th>
                  <th className="num">Sobrou pra você</th>
                </tr>
              </thead>
              <tbody>
                {meses.map(({ mes, parcial, c }) => (
                  <tr key={mes}>
                    <td>
                      {rotuloMes(mes)}
                      {parcial && <span className="dr-parcial">parcial</span>}
                    </td>
                    <td className="num">{BRL(c.pago)}</td>
                    <td className="num faint">− {BRL(c.taxas + c.imposto)}</td>
                    <td className="num faint">− {BRL(c.custo)}</td>
                    <td className="num faint">− {BRL(c.ads)}</td>
                    <td className="num faint">− {BRL(c.fixas || 0)}</td>
                    <td className={`num dr-sobrou${(c.liquido || 0) < 0 ? " neg" : ""}`}>{BRL(c.liquido || 0)}</td>
                  </tr>
                ))}
                {meses.length > 1 && (
                  <tr className="dr-tot">
                    <td>Total</td>
                    <td className="num">{BRL(soma("pago"))}</td>
                    <td className="num">− {BRL(soma("taxas") + soma("imposto"))}</td>
                    <td className="num">− {BRL(soma("custo"))}</td>
                    <td className="num">− {BRL(soma("ads"))}</td>
                    <td className="num">− {BRL(soma("fixas"))}</td>
                    <td className={`num dr-sobrou${soma("liquido") < 0 ? " neg" : ""}`}>{BRL(soma("liquido"))}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="panel">
        <h3 className="section-title h3-split">
          <span>Próximos 7 dias</span>
          <button type="button" className="link-btn" onClick={onVerLancamentos}>ver todos os lançamentos →</button>
        </h3>
        {prox.length ? (
          <ul className="dr-prox">
            {prox.map((l) => (
              <li key={l.id}>
                <span className="faint">{diaSemana(l.data_prevista)}, {dm(l.data_prevista)}</span>
                <span>
                  {l.descricao || rotuloCategoria(l.tipo, l.categoria)}
                  <span className="faint"> · {rotuloCategoria(l.tipo, l.categoria)}</span>
                </span>
                <b className={l.tipo === "entrada" ? "dr-ent" : ""}>{l.tipo === "entrada" ? "+ " : "− "}{BRL(l.valor)}</b>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty">Nada previsto pra entrar ou sair nos próximos 7 dias.</div>
        )}
      </div>
    </div>
  );
}
