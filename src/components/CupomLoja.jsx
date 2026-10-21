import { useMemo, useState } from "react";
import { useEscada } from "../hooks/useEscada.js";
import { usePreferencia } from "../hooks/usePreferencia.js";
import { canalDireto } from "../lib/canais.js";
import { rampaNoCanal } from "../lib/rampaCanal.js";
import { cupomMaximo, simularCupom, comparaComLive } from "../lib/cupomLoja.js";
import { BRL } from "../lib/format.js";
import { normalizarTexto } from "../lib/texto.js";
import CanalTag from "./CanalTag.jsx";
import Kpis from "./Kpis.jsx";
import Ajuda from "./Ajuda.jsx";

// Cupom da loja FORA da live (19/10/2026): simula um cupom na loja toda de um
// canal e mostra, item a item no preço salvo, se cabe (lucro ≥ mínimo). Conta
// em lib/cupomLoja.js. Só simulação — o cupom é criado na plataforma.
const TIPO_ITEM = { p: "produto", v: "variacao", k: "kit" };
const ESTADO = {
  cabe: { cls: "st st-oportunidade", txt: "✓ cabe" },
  abaixo: { cls: "st st-atencao", txt: "⚠ abaixo do mínimo" },
  prejuizo: { cls: "st st-resolver", txt: "! prejuízo" },
  "nao-alcanca": { cls: "st st-info", txt: "sozinho não alcança o pedido mínimo" },
  "sem-dado": { cls: "st st-info", txt: "—" },
};
const num = (v) => Number(String(v ?? "").replace(",", ".")) || 0;

export default function CupomLoja() {
  const dados = useEscada();
  const { itens, canais, precos, cfgDoProduto, cfgLoja, cobraNoCanal, itemNoCanal } = dados;
  const opcoesCanal = useMemo(() => canais.filter((c) => !canalDireto(c)), [canais]);
  const padraoCanal = (opcoesCanal.find((c) => !rampaNoCanal(c, cfgLoja)) || opcoesCanal.find((c) => c.tipo === "tiktok") || opcoesCanal[0])?.id || "";
  const [pref, setPref] = usePreferencia("promocoes:cupom-loja", {});
  const canalId = pref.canalId && opcoesCanal.some((c) => c.id === pref.canalId) ? pref.canalId : padraoCanal;
  const canal = opcoesCanal.find((c) => c.id === canalId) || null;
  const cupom = { tipo: pref.tipo === "valor" ? "valor" : "pct", valor: num(pref.valor ?? "5"), minimo: num(pref.minimo) };
  const pctLive = pref.live ?? "10";
  const set = (k) => (e) => setPref({ ...pref, canalId, [k]: e.target.value });
  const [busca, setBusca] = useState("");

  const linhas = useMemo(() => {
    if (!canal) return [];
    const out = [];
    for (const p of precos) {
      if (p.canal_id !== canal.id) continue;
      const pref0 = { produto: "p", variacao: "v", kit: "k" }[p.item_tipo];
      const item0 = itens.find((i) => i.id === `${pref0}:${p.item_id}`);
      if (!item0 || (cobraNoCanal && !cobraNoCanal(item0, canal))) continue;
      const item = itemNoCanal ? itemNoCanal(item0, canal) : item0;
      const tipo = TIPO_ITEM[item.id[0]];
      const cfg = cfgDoProduto(item.produtoId || (tipo === "produto" ? item.id.slice(2) : null));
      const x = { canal, preco: Number(p.preco), custo: Number(item.custoTotal) || 0, peso: Number(item.peso) || 0, cfg };
      const max = cupomMaximo(x);
      if (!max) continue;
      out.push({ item, preco: x.preco, max, sim: simularCupom(x, cupom) });
    }
    return out.sort((a, b) => a.item.nome.localeCompare(b.item.nome));
    // cupom é recriado a cada render: depende dos valores
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canal, precos, itens, cfgDoProduto, cobraNoCanal, itemNoCanal, cupom.tipo, cupom.valor, cupom.minimo]);

  const filtradas = busca ? linhas.filter((l) => normalizarTexto(`${l.item.nome} ${l.item.sku || ""}`).includes(normalizarTexto(busca))) : linhas;
  const contam = linhas.filter((l) => l.sim?.alcanca);
  const cabem = contam.filter((l) => l.sim.estado === "cabe").length;
  const naoCabem = contam.length - cabem;
  const menorMax = linhas.length ? Math.min(...linhas.map((l) => l.max.pct)) : null;
  const vsLive = comparaComLive(cupom, num(pctLive));

  if (!opcoesCanal.length) return <div className="panel"><p className="hint">Cadastre um canal em Configuração → Canais.</p></div>;

  return (
    <div>
      <div className="panel">
        <h3 className="section-title">
          <span>
            Cupom da loja (fora da live)
            <Ajuda texto="No canal da live (ex.: TikTok) o produto fica no preço pela margem e o desconto é só por cupom. Aqui você testa um cupom na loja toda: o app mostra, item a item no preço salvo, se o lucro continua acima do seu mínimo (margem mínima ou lucro mínimo em R$). A conta olha 1 unidade — o pior caso, porque o pedido de 1 peça paga a taxa fixa inteira. Sugestão: fora da live até metade do cupom máximo; na live até 80% — a live tem que ser sempre o melhor negócio. Nada é gravado no anúncio: o cupom é criado na plataforma." />
          </span>
        </h3>
        <div className="grid-auto">
          <div className="field">
            <label>Canal</label>
            <select value={canalId} onChange={set("canalId")}>
              {opcoesCanal.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                  {rampaNoCanal(c, cfgLoja) ? "" : " · sem rampa (cupom)"}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Tipo do cupom</label>
            <select value={cupom.tipo} onChange={set("tipo")}>
              <option value="pct">% de desconto</option>
              <option value="valor">R$ de desconto</option>
            </select>
          </div>
          <div className="field">
            <label>{cupom.tipo === "pct" ? "Desconto (%)" : "Desconto (R$)"}</label>
            <input type="text" inputMode="decimal" value={pref.valor ?? "5"} onChange={set("valor")} />
          </div>
          <div className="field">
            <label>Pedido mínimo (R$, opcional)</label>
            <input type="text" inputMode="decimal" value={pref.minimo ?? ""} placeholder="sem mínimo" onChange={set("minimo")} />
          </div>
          <div className="field">
            <label>Cupom da live (%) — referência</label>
            <input type="text" inputMode="decimal" value={pctLive} onChange={set("live")} />
          </div>
        </div>
        {vsLive === "igual-ou-maior" && (
          <div className="aviso-cel atencao" style={{ marginTop: 8 }}>
            ⚠ O cupom de fora ({cupom.valor}%) está igual ou maior que o da live ({num(pctLive)}%) — ninguém espera a live. Deixe o de fora menor (ou só pra seguidor novo / primeira compra / acima de um valor).
          </div>
        )}
      </div>

      {canal && (
        <Kpis
          itens={[
            { label: "Itens com preço salvo", valor: linhas.length, sub: <CanalTag canal={canal} /> },
            { label: "Cabem no cupom", valor: cabem, sub: contam.length < linhas.length ? `${linhas.length - contam.length} não alcançam o pedido mínimo sozinhos` : "lucro ≥ seu mínimo" },
            { label: "Não cabem", valor: naoCabem, tom: naoCabem ? "warn" : undefined, sub: naoCabem ? "abaixo do mínimo ou prejuízo" : "nenhum" },
            { label: "Menor cupom máximo", valor: menorMax == null ? "—" : `${menorMax}%`, sub: "o item mais apertado" },
          ]}
        />
      )}

      <div className="panel">
        <div className="toolbar">
          <input type="search" placeholder="Buscar produto ou SKU" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        {!filtradas.length ? (
          <p className="vazio">{linhas.length ? "Nada com essa busca." : "Nenhum item com preço salvo neste canal."}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Preço salvo</th>
                  <th className="num">Lucro hoje</th>
                  <th className="num">Cupom máximo</th>
                  <th className="num">Sugestão</th>
                  <th className="num">Com este cupom</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((l) => (
                  <tr key={l.item.id}>
                    <td>
                      {l.item.nome}
                      {l.item.sku && <div className="sub-num">{l.item.sku}</div>}
                    </td>
                    <td className="num">{BRL(l.preco)}</td>
                    <td className="num">
                      {BRL(l.max.lucroSem)}
                      <div className="sub-num">mínimo {BRL(l.max.minimoSem)}</div>
                    </td>
                    <td className="num">
                      {l.max.semEspaco ? (
                        <span className="st st-atencao">sem espaço</span>
                      ) : (
                        <>
                          <b>{l.max.pct}%</b>
                          <div className="sub-num">{BRL(l.max.valor)} · sobra {BRL(l.max.lucroNoMax)}</div>
                        </>
                      )}
                    </td>
                    <td className="num">
                      {l.max.semEspaco ? "—" : (
                        <>
                          fora até {l.max.foraLive}%
                          <div className="sub-num">na live até {l.max.live}%</div>
                        </>
                      )}
                    </td>
                    <td className="num">
                      {l.sim?.alcanca && l.sim.desconto > 0 ? (
                        <>
                          paga {BRL(l.sim.clientePaga)}
                          <div className="sub-num">lucro {BRL(l.sim.lucro)}</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <span className={ESTADO[l.sim?.estado || "sem-dado"].cls}>{ESTADO[l.sim?.estado || "sem-dado"].txt}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
