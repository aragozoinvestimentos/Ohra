import { Fragment, useMemo } from "react";
import { useEscada } from "../hooks/useEscada.js";
import { useCatalogo } from "../hooks/useCatalogo.js";
import { useAnunciosGrupo } from "../hooks/useAnunciosGrupo.js";
import { gruposPorItem } from "../lib/anunciosGrupo.js";
import { custoProdutoPorPeca } from "../lib/calc.js";
import { impressoraDoProduto } from "../lib/farm.js";
import { linhasDoKit } from "../lib/planoKit.js";
import { estadoDoAlerta } from "../lib/estados.js";
import { irParaAba } from "../lib/navegar.js";
import { pedirPasso } from "../lib/passosPreco.js";
import { BRL, PCT } from "../lib/format.js";
import CanalTag from "./CanalTag.jsx";
import Estado from "./Estado.jsx";
import QuandoVende from "./QuandoVende.jsx";

// Detalhe de um item do catálogo (custo de hoje com a composição + preço alvo
// e agora por canal + Quando vende + ações). Era o detalhe embaixo da linha do
// Catálogo; desde o remap (21/10/2026) fica na Página do produto.
const num = (v) => {
  const x = Number(v);
  return isFinite(x) ? x : 0;
};
const g = (v) => (v ? `${Math.round(v)} g` : "—");

export default function DetalheItem({ it, onEditar, onToast }) {
  const { itens, produtos, canais, precos, materiais, rampas, alertaDe, agoraDe } = useEscada();
  const { impressoras } = useCatalogo();
  const { grupos } = useAnunciosGrupo();
  const mapaGrupos = useMemo(() => gruposPorItem(grupos), [grupos]);
  if (!it) return null;
  const precoDe = (x, c) => {
    const t = x.id[0] === "k" ? "kit" : x.id[0] === "v" ? "variacao" : "produto";
    return precos.find((p) => p.item_tipo === t && p.item_id === x.id.slice(2) && p.canal_id === c.id) || null;
  };
  const canaisDo = (x) => canais.map((c) => ({ c, s: precoDe(x, c) })).filter((y) => y.s && num(y.s.preco) > 0);
    const prod = it.tipo !== "Kit" ? produtos.find((p) => p.id === (it.produtoId || it.id.slice(2))) : null;
    const r = it.tipo === "Produto" && prod?.producao_detalhe ? custoProdutoPorPeca(prod, materiais) : null;
    const kitLinhas = it.tipo === "Kit" ? linhasDoKit(it.componentes, produtos) : [];
    const emKits = it.tipo === "Produto" ? itens.filter((k) => k.tipo === "Kit" && (k.componentes || []).some((c) => c.produtoId === it.id.slice(2))) : [];
    const emGrupos = mapaGrupos.get(it.id) || [];
    const rampasDo = prod ? rampas.filter((x) => x.produto_id === prod.id) : [];
    const editarAlvo = it.tipo === "Kit" ? { tipo: "kit", id: it.id.slice(2) } : { tipo: "produto", id: prod?.id };
    // Composição do custo (barra + linhas): produção quebrada quando há detalhamento.
    const partes = [];
    if (r) {
      const base = [
        ["Material", r.material],
        ["Energia", r.energia],
        ["Máquina", r.roiPeca],
        ["Manutenção", r.manutencao],
        ["Falhas", r.falhas],
        ["Acabamento", r.acabamento],
      ];
      base.forEach(([n, v]) => partes.push({ nome: n, valor: v }));
      const resto = r.total - base.reduce((t, [, v]) => t + v, 0);
      if (resto > 0.005) partes.push({ nome: "Consumíveis e modelagem", valor: resto });
    } else if (kitLinhas.length) {
      kitLinhas.forEach((l) => partes.push({ nome: `${l.quantidade} × ${l.produto.nome}`, valor: l.subtotal, sub: `${BRL(l.custoPeca)}/peça${l.manual ? " · à mão" : ` · chapa de ${l.pecasChapa}`}` }));
    } else partes.push({ nome: "Produção", valor: it.custoProducao ?? 0 });
    if (num(it.embalagem) > 0) partes.push({ nome: "Embalagem", valor: num(it.embalagem) });
    const frete = num(it.freteProduto ?? it.frete);
    if (frete > 0) partes.push({ nome: "Frete", valor: frete });
    const total = partes.reduce((t, x) => t + x.valor, 0) || 1;
    const salvosDet = canaisDo(it);
    const imp = prod ? impressoraDoProduto(prod, impressoras) : null;
    const info = [
      `peso de envio ${g(it.peso)}`,
      prod && it.tipo === "Produto" ? `${imp?.nome || "sem impressora"} · chapa de ${Math.max(1, num(prod.pecas_por_impressao) || 1)}` : null,
      prod && !prod.producao_detalhe ? "custo de produção digitado à mão" : null,
    ].filter(Boolean);
    return (
          <div className="detalhe-cel catalogo-det">
            <div className="cat-card">
              <div className="cat-card-cab">
                <span className="ads-rotulo">Custo de hoje</span>
                <b className="cat-total">{BRL(it.custoTotal)}</b>
              </div>
              <div className="cat-barra" aria-hidden="true">
                {partes.map((x, k) => (
                  <span key={x.nome} className={`cat-cor-${k % 8}`} style={{ width: `${(x.valor / total) * 100}%` }} title={`${x.nome}: ${BRL(x.valor)}`} />
                ))}
              </div>
              <div className="cat-linhas">
                {partes.map((x, k) => (
                  <div key={x.nome} className="cat-linha">
                    <span className={`cat-ponto cat-cor-${k % 8}`} />
                    <span className="cat-nome">
                      {x.nome}
                      {x.sub && <small>{x.sub}</small>}
                    </span>
                    <span className="cat-pct">{Math.round((x.valor / total) * 100)}%</span>
                    <span className="cat-val">{BRL(x.valor)}</span>
                  </div>
                ))}
              </div>
              <div className="cat-info">{info.join(" · ")}</div>
            </div>

            <div className="cat-card">
              <div className="cat-card-cab">
                <span className="ads-rotulo">Preço alvo e preço agora por canal</span>
                {rampasDo.map((x) => (
                  <Estado key={x.id} tipo="decisao">em rampa · {canais.find((c) => c.id === x.canal_id)?.nome || "canal"}</Estado>
                ))}
              </div>
              {salvosDet.length ? (
                <table className="cat-precos">
                  <thead>
                    <tr>
                      <th>Canal</th>
                      <th className="num">Preço</th>
                      <th className="num" title="O que o canal repassa depois das taxas; dele sai o custo pra repor o produto">Recebe</th>
                      <th className="num" title="Recebe − repor o produto (custo de hoje)">Lucro</th>
                      <th className="num">Margem</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {salvosDet.map(({ c, s }) => {
                      const est = estadoDoAlerta(alertaDe(it, c));
                      // Em rampa (ou variação/kit derivado): alvo = preço salvo; agora = preço da Rampa.
                      const aa = agoraDe(it, c);
                      const ag = aa?.emRampa && Math.abs(aa.agora.preco - num(s.preco)) >= 0.005 ? aa.agora : null;
                      const agora = ag ? ag.preco : null;
                      const lucroAgora = ag ? ag.lucro : null;
                      return (
                        <Fragment key={c.id}>
                          <tr className={agora != null ? "cat-alvo" : undefined}>
                            <td>
                              <CanalTag canal={c} />
                              <small className="cat-rotulo">{agora != null ? "alvo (preço salvo)" : "alvo = agora"}</small>
                            </td>
                            <td className="num"><b>{BRL(s.preco)}</b></td>
                            <td className="num muted-cel">{aa?.alvo ? BRL(aa.alvo.recebe) : "—"}</td>
                            <td className="num" style={num(s.lucro) < 0 ? { color: "var(--bad)" } : undefined}>{BRL(s.lucro)}</td>
                            <td className="num">{PCT(s.margem)}</td>
                            <td>{est && <Estado tipo={est.tipo}>{est.motivo}</Estado>}</td>
                          </tr>
                          {agora != null && (
                            <tr className="cat-agora">
                              <td>
                                <span className="cat-seta">↳</span> <small className="cat-rotulo">agora · {aa.acima ? "testando acima do alvo" : "em rampa"}</small>
                              </td>
                              <td className="num"><b>{BRL(agora)}</b></td>
                              <td className="num muted-cel">{BRL(ag.recebe)}</td>
                              <td className="num" style={lucroAgora != null && lucroAgora < 0 ? { color: "var(--bad)" } : undefined}>{lucroAgora != null ? BRL(lucroAgora) : "—"}</td>
                              <td className="num">{lucroAgora != null && agora > 0 ? PCT(lucroAgora / agora) : "—"}</td>
                              <td><Estado tipo="decisao">até chegar no alvo</Estado></td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="muted-cel">Sem preço salvo em nenhum canal.</div>
              )}
              {(emKits.length > 0 || emGrupos.length > 0) && (
                <div className="cat-info">
                  {emKits.length > 0 && <div>Nos kits: {emKits.map((k) => k.nome).join(", ")}</div>}
                  {emGrupos.length > 0 && <div>Nos anúncios: {emGrupos.map((x) => x.grupo.nome).join(", ")}</div>}
                </div>
              )}
            </div>

            {it.tipo === "Produto" && prod && (
              <div className="cat-card cat-quando">
                <QuandoVende produtoId={prod.id} onToast={onToast} compacto />
              </div>
            )}

            <div className="catalogo-acoes">
              {editarAlvo.id && <button type="button" className="btn btn-mini" onClick={() => onEditar(editarAlvo)}>✎ editar cadastro</button>}
              {prod && it.tipo === "Produto" && <button type="button" className="btn btn-mini" onClick={() => irParaAba("producao", { produtoId: prod.id })}>Calcular custo</button>}
              {it.tipo !== "Variação" && (
                <button type="button" className="btn btn-mini" onClick={() => { pedirPasso("avulso", it.id, null); irParaAba("avulso"); }}>
                  Precificar
                </button>
              )}
              <button type="button" className="btn btn-mini" onClick={() => irParaAba("historico", { busca: (prod?.nome || it.nome) })}>Produtos precificados →</button>
            </div>
          </div>
    );
}
