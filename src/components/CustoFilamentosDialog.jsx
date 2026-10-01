import { useMemo, useState } from "react";
import Portal from "./Portal.jsx";
import CanalTag from "./CanalTag.jsx";
import { BRL, PCT } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import { useEscada } from "../hooks/useEscada.js";
import { itemTipoDoId } from "../lib/variacoes.js";
import { lucroNoPreco, precoParaMargem, r90up } from "../lib/escada.js";
import { baseTrocaFilamento, ehFilamento, materiaisComFilamento } from "../lib/trocaFilamento.js";

// Janela "⇄ Filamentos": pra um item (produto, variação ou kit) — ou pra uma
// simulação do Custo de Produção (`base` pronta) — mostra em cada filamento
// cadastrado o custo do item, a diferença pro filamento atual, o preço
// sugerido no canal (margem desejada + taxas reais) e o lucro no preço já
// salvo. Não salva nada. Em produto avulso dá pra "criar como produto" com o
// filamento trocado.
export default function CustoFilamentosDialog({ itemId, base: baseExterna, canalIdInicial, onClose, onToast }) {
  const dados = useEscada();
  const { canais, precos, materiais, cfgDoProduto } = dados;
  const [canalId, setCanalId] = useState(() => canalIdInicial || canais.find((c) => c.tipo === "shopee")?.id || canais[0]?.id || "");
  const [criando, setCriando] = useState(null); // filamento confirmando "criar como produto"
  const [salvando, setSalvando] = useState(false);

  const base = useMemo(() => baseExterna || (itemId ? baseTrocaFilamento(itemId, dados) : null), [baseExterna, itemId, dados]);
  const canal = canais.find((c) => c.id === canalId) || null;
  const cfg = useMemo(() => cfgDoProduto(base?.produtoId || null), [base, cfgDoProduto]);

  const salvo = useMemo(() => {
    if (!base?.itemId || !canalId) return null;
    const tipo = itemTipoDoId(base.itemId);
    const id = base.itemId.split(":")[1];
    return precos.find((p) => p.item_tipo === tipo && p.item_id === id && p.canal_id === canalId) || null;
  }, [base, canalId, precos]);

  const filamentos = useMemo(() => materiais.filter(ehFilamento).slice().sort((a, b) => Number(a.preco) - Number(b.preco)), [materiais]);

  const linhas = useMemo(() => {
    if (!base) return [];
    const extras = base.custoAtual - base.producaoAtual; // embalagem + frete (+ ajuste) não mudam
    return filamentos.map((fil) => {
      const producao = base.producaoCom(materiaisComFilamento(materiais, fil), fil);
      const custo = Math.round((extras + producao) * 100) / 100;
      const pSug = canal && custo > 0 ? precoParaMargem(canal, cfg.margemDesejada, custo, base.peso, cfg) : null;
      const sugerido = pSug != null ? r90up(pSug) : null;
      const lucroSug = sugerido != null ? lucroNoPreco(canal, sugerido, custo, base.peso, cfg) : null;
      const precoSalvo = salvo ? Number(salvo.preco) : null;
      const lucroSalvo = precoSalvo > 0 ? lucroNoPreco(canal, precoSalvo, custo, base.peso, cfg) : null;
      return {
        fil,
        custo,
        diferenca: custo - base.custoAtual,
        sugerido,
        lucroSug,
        lucroSalvo,
        margemSalvo: lucroSalvo != null && precoSalvo > 0 ? lucroSalvo / precoSalvo : null,
        atual: base.materialAtual ? fil.nome === base.materialAtual : false,
      };
    });
  }, [base, filamentos, materiais, canal, cfg, salvo]);

  async function criarProduto(fil) {
    const produto = dados.produtos.find((p) => p.id === base?.produtoId);
    if (!supabase || !produto) return;
    setSalvando(true);
    // eslint-disable-next-line no-unused-vars
    const { id, criado_em, atualizado_em, sku, ...resto } = produto;
    const detalhe = { ...(produto.producao_detalhe || {}), materialNome: fil.nome };
    const novo = {
      ...resto,
      nome: `${produto.nome} — ${fil.nome}`,
      sku: null,
      material_nome: fil.nome,
      material_id: fil.id,
      producao_detalhe: detalhe,
      custo_producao: Math.round(base.producaoCom(materiaisComFilamento(materiais, fil), fil) * 100) / 100,
    };
    const { data, error } = await supabase.from("produtos_cadastro").insert(novo).select().single();
    if (error) {
      setSalvando(false);
      onToast?.(`Não foi possível criar: ${error.message}`);
      return;
    }
    const receita = dados.produtoEmbalagens.filter((r) => r.produto_id === produto.id);
    if (receita.length) {
      await supabase.from("produto_embalagens").insert(
        receita.map((r) => {
          // eslint-disable-next-line no-unused-vars
          const { id: _id, criado_em: _c, ...rr } = r;
          return { ...rr, produto_id: data.id };
        })
      );
    }
    setSalvando(false);
    setCriando(null);
    onToast?.(`Produto "${novo.nome}" criado — precifique ele no 1º Avulso (SKU em branco, preencha na Ficha).`);
  }

  const podeCriar = base?.itemId?.startsWith("p:") && !base?.semDetalhe && !base?.semCriar;

  return (
    <Portal>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-box modal-box-larga modal-box-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
          <h3>⇄ Filamentos{base?.titulo ? ` — ${base.titulo}` : ""}</h3>
          {!base ? (
            <div className="empty">Escolha um produto ou kit primeiro.</div>
          ) : (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", alignItems: "end" }}>
                <div className="field" style={{ marginBottom: 8, flex: "0 0 200px" }}>
                  <label>Canal</label>
                  <select value={canalId} onChange={(e) => setCanalId(e.target.value)}>
                    {canais.map((c) => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                  </select>
                </div>
                <div className="hint" style={{ margin: "0 0 12px", flex: "1 1 260px" }}>
                  Custo de hoje: <b>{BRL(base.custoAtual)}</b>
                  {base.materialAtual ? ` em ${base.materialAtual}` : base.materiaisDoKit?.length > 1 ? ` (peças em ${base.materiaisDoKit.join(", ")})` : ""}
                  {salvo ? (
                    <>
                      {" "}· salvo em {canal && <CanalTag canal={canal} />} <b>{BRL(salvo.preco)}</b>
                    </>
                  ) : (
                    " · sem preço salvo neste canal"
                  )}
                </div>
              </div>
              {base.semDetalhe ? (
                <div className="empty">
                  Este item tem o custo de produção digitado na mão (sem o detalhamento do Custo de Produção) — não dá pra saber quanto filamento ele gasta.
                  Calcule ele no Custo de Produção e salve pra liberar a comparação.
                </div>
              ) : filamentos.length === 0 ? (
                <div className="empty">Nenhum filamento cadastrado em Cadastros → Materiais.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Filamento</th>
                        <th className="num">R$ / kg</th>
                        <th className="num">Custo do item</th>
                        <th className="num">Diferença</th>
                        <th className="num" title={`Menor preço terminado em ,90 com margem de ${Math.round(cfg.margemDesejada * 100)}% e as taxas do canal`}>
                          Sugerido ({Math.round(cfg.margemDesejada * 100)}%)
                        </th>
                        <th className="num">{salvo ? `Lucro em ${BRL(salvo.preco)}` : "Lucro no salvo"}</th>
                        {podeCriar && <th></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {linhas.map((l) => (
                        <tr key={l.fil.id} className={l.atual ? "linha-atual" : ""}>
                          <td>
                            {l.fil.nome}
                            {l.atual && <span className="h3-contagem">atual</span>}
                          </td>
                          <td className="num">{BRL(l.fil.preco)}</td>
                          <td className="num" style={{ fontWeight: 600 }}>{BRL(l.custo)}</td>
                          <td className="num" style={{ color: Math.abs(l.diferenca) < 0.005 ? "var(--ink-faint)" : l.diferenca > 0 ? "var(--bad)" : "var(--good)" }}>
                            {Math.abs(l.diferenca) < 0.005 ? "—" : `${l.diferenca > 0 ? "+" : "−"}${BRL(Math.abs(l.diferenca))}`}
                          </td>
                          <td className="num" title={l.lucroSug != null ? `lucro ${BRL(l.lucroSug)}` : undefined}>
                            {BRL(l.sugerido)}
                          </td>
                          <td className="num" style={{ color: l.lucroSalvo == null ? undefined : l.lucroSalvo >= 0 ? "var(--good)" : "var(--bad)" }}>
                            {l.lucroSalvo == null ? "—" : (
                              <>
                                {BRL(l.lucroSalvo)} <span className="muted-cel">· {PCT(l.margemSalvo)}</span>
                              </>
                            )}
                          </td>
                          {podeCriar && (
                            <td className="num" style={{ whiteSpace: "nowrap" }}>
                              {!l.atual &&
                                (criando === l.fil.id ? (
                                  <>
                                    <button className="btn btn-mini primary" disabled={salvando} onClick={() => criarProduto(l.fil)}>
                                      {salvando ? "Criando…" : "Confirmar"}
                                    </button>{" "}
                                    <button className="btn btn-mini" disabled={salvando} onClick={() => setCriando(null)}>✕</button>
                                  </>
                                ) : (
                                  <button className="btn btn-mini" title={`Cria um produto novo igual a este, em ${l.fil.nome}`} onClick={() => setCriando(l.fil.id)}>
                                    + criar produto
                                  </button>
                                ))}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="hint" style={{ marginTop: 8 }}>
                Só simulação — nada é salvo. Embalagem e frete continuam os mesmos; muda só o preço/kg do filamento (o preço de cada filamento é a média das
                últimas compras quando você registra compras em Materiais).
              </p>
            </>
          )}
          <div className="modal-actions">
            <button className="btn" onClick={onClose}>Fechar</button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
