import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useEscada } from "../hooks/useEscada.js";
import { recarregarCatalogo } from "../lib/catalogoStore.js";
import { gravarPrecoNovo } from "../lib/estrategia.js";
import { gruposDoSeletor } from "../lib/variacoes.js";
import { LIMITE_NOME_OPCAO } from "../lib/anunciosGrupo.js";
import { MAX_ADICIONAIS, montarCombinacoes, regraDaPlataforma } from "../lib/combinacoes.js";
import { BRL, PCT } from "../lib/format.js";
import BuscaItem from "./BuscaItem.jsx";
import Ajuda from "./Ajuda.jsx";

// Ficha do anúncio → Anúncio com vários itens → "Montar combinações" (out/2026).
// Item base + adicionais → todas as combinações com custo, preço (salvo ou o
// sugerido de kit) e a regra da plataforma; "Usar" cria os kits que faltam
// (reaproveita kit com a mesma composição), salva o preço sugerido se marcado
// e devolve as opções pro anúncio. Conta em lib/combinacoes.js.
export default function MontarCombinacoes({ canalInicial, canais, nomeVariacao, onUsar, onCancelar, onToast }) {
  const { lojaId } = useLoja();
  const { itens, produtos, kits, embalagens, produtoEmbalagens, precos, publicacoesCanal, cfgDoProduto } = useEscada();
  const opcoesBusca = useMemo(() => gruposDoSeletor(itens), [itens]);
  const [canalId, setCanalId] = useState(canalInicial?.id || canais[0]?.id || "");
  const canal = canais.find((c) => c.id === canalId) || null;
  const [base, setBase] = useState("");
  const [adicionais, setAdicionais] = useState([{ itemId: "", quantidade: 1 }]);
  const [desmarcadas, setDesmarcadas] = useState(() => new Set());
  const [rotulos, setRotulos] = useState({});
  const [salvarPrecos, setSalvarPrecos] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const adicionaisValidos = adicionais.filter((a) => a.itemId && a.itemId !== base);
  // Chave da montagem: muda a base/adicionais → marcações e rótulos voltam ao padrão.
  const assinatura = `${base}|${adicionaisValidos.map((a) => `${a.itemId}×${a.quantidade}`).join(",")}`;
  const [assinaturaVista, setAssinaturaVista] = useState(assinatura);
  if (assinatura !== assinaturaVista) {
    setAssinaturaVista(assinatura);
    setDesmarcadas(new Set());
    setRotulos({});
  }

  const combos = useMemo(
    () =>
      base && canal
        ? montarCombinacoes({ base: { itemId: base }, adicionais: adicionaisValidos, canal, itens, produtos, kits, embalagens, produtoEmbalagens, precos, publicacoes: publicacoesCanal, cfgDoProduto })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assinatura, canal, itens, produtos, kits, embalagens, produtoEmbalagens, precos, publicacoesCanal, cfgDoProduto]
  );
  const marcadas = combos.filter((c) => !desmarcadas.has(c.chave));
  const regra = regraDaPlataforma(marcadas, canal, nomeVariacao);
  const rotuloDe = (c) => rotulos[c.chave] ?? c.rotulo;
  const alternar = (chave) =>
    setDesmarcadas((s) => {
      const n = new Set(s);
      if (n.has(chave)) n.delete(chave);
      else n.add(chave);
      return n;
    });
  const desmarcarFora = () => setDesmarcadas((s) => new Set([...s, ...(regra.quatroX?.fora || [])]));
  const novos = marcadas.filter((c) => c.novo);
  const precosASalvar = marcadas.filter((c) => c.origemPreco === "sugerido" && c.sugerido > 0);

  async function usar() {
    if (!supabase || marcadas.length < 2) return;
    setSalvando(true);
    const opcoes = [];
    let criados = 0;
    let precosSalvos = 0;
    for (const c of marcadas) {
      let itemId = c.item?.id || null;
      if (!itemId) {
        const r = await supabase
          .from("kits")
          .insert({ nome: c.nomeKit, sku: c.sku || null, observacao: "Criado em Montar combinações (Ficha do anúncio)", atualizado_em: new Date().toISOString(), ...(lojaId ? { loja_id: lojaId } : {}) })
          .select()
          .single();
        if (r.error || !r.data?.id) {
          setSalvando(false);
          onToast?.(`Não foi possível criar o kit “${c.nomeKit}”: ${r.error?.message || "sem resposta"}`);
          return;
        }
        const kitId = r.data.id;
        const { error: eP } = await supabase.from("kit_produtos").insert(c.pecas.map((p) => ({ kit_id: kitId, produto_id: p.produtoId, quantidade: p.quantidade })));
        if (eP) {
          setSalvando(false);
          onToast?.(`O kit “${c.nomeKit}” foi criado, mas as peças não foram gravadas: ${eP.message}. Confira em Produtos → Kits.`);
          return;
        }
        if (c.receita.length) await supabase.from("kit_embalagens").insert(c.receita.map((e) => ({ kit_id: kitId, embalagem_id: e.embalagem_id, quantidade: Number(e.quantidade) || 0 })));
        itemId = `k:${kitId}`;
        criados += 1;
      }
      if (salvarPrecos && c.origemPreco === "sugerido" && c.sugerido > 0 && itemId.startsWith("k:")) {
        const { error } = await gravarPrecoNovo((extra) =>
          supabase.from("precos_canal").upsert(
            {
              ...extra,
              loja_id: lojaId || null,
              item_tipo: "kit",
              item_id: itemId.slice(2),
              canal_id: canal.id,
              preco: Math.round(c.sugerido * 100) / 100,
              custo_total: Math.round(c.custo * 100) / 100,
              lucro: Math.round((c.lucro || 0) * 100) / 100,
              margem: c.margem,
              atualizado_em: new Date().toISOString(),
            },
            { onConflict: "item_tipo,item_id,canal_id" }
          )
        );
        if (!error) precosSalvos += 1;
      }
      opcoes.push({ rotulo: rotuloDe(c).slice(0, 60), itemId, sufixo: "" });
    }
    recarregarCatalogo();
    setSalvando(false);
    const partes = [`${opcoes.length} opções no anúncio`];
    if (criados) partes.push(`${criados} ${criados === 1 ? "kit criado" : "kits criados"} em Produtos → Kits`);
    if (precosSalvos) partes.push(`${precosSalvos} ${precosSalvos === 1 ? "preço salvo" : "preços salvos"} em ${canal.nome}`);
    onToast?.(partes.join(" · "));
    onUsar(opcoes, itens.find((i) => i.id === base)?.nome || "");
  }

  return (
    <div className="combinacoes">
      <div className="combinacoes-cab">
        <b>Montar combinações</b>
        <Ajuda texto="Escolha o item principal e os que podem ir junto. O app monta todas as combinações (só o principal, principal + cada adicional, todos juntos), mostra o preço — o salvo, ou o sugerido de kit, que dá desconto em relação às peças separadas — e confere a regra da plataforma. Ao usar, cada combinação com mais de um item vira um kit em Produtos → Kits (embalagem = a do item principal; ajuste lá se precisar)." />
      </div>
      <div className="combinacoes-topo">
        <div className="field">
          <label>Item principal</label>
          <BuscaItem grupos={opcoesBusca} value={base} onChange={setBase} vazio="— ex.: Letreiro —" />
        </div>
        <div className="field">
          <label>Plataforma do anúncio</label>
          <select value={canalId} onChange={(e) => setCanalId(e.target.value)}>
            {canais.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field" style={{ marginBottom: 4 }}>
        <label>Itens que podem ir junto</label>
      </div>
      <div className="combinacoes-adicionais">
        {adicionais.map((a, i) => (
          <div className="combinacoes-adicional" key={i}>
            <BuscaItem grupos={opcoesBusca} value={a.itemId} onChange={(id) => setAdicionais((l) => l.map((x, k) => (k === i ? { ...x, itemId: id } : x)))} vazio="— ex.: Suporte de guardanapo —" />
            <label className="combinacoes-qtd">
              qtd
              <input type="number" min="1" step="1" value={a.quantidade} onChange={(e) => setAdicionais((l) => l.map((x, k) => (k === i ? { ...x, quantidade: e.target.value } : x)))} />
            </label>
            <button type="button" className="btn-icone" title="Tirar" onClick={() => setAdicionais((l) => (l.length > 1 ? l.filter((_, k) => k !== i) : [{ itemId: "", quantidade: 1 }]))}>
              ×
            </button>
          </div>
        ))}
        {adicionais.length < MAX_ADICIONAIS && (
          <button type="button" className="btn btn-mini" onClick={() => setAdicionais((l) => [...l, { itemId: "", quantidade: 1 }])}>
            + Item que pode ir junto
          </button>
        )}
      </div>

      {base && !adicionaisValidos.length && <p className="hint">Escolha pelo menos um item que pode ir junto.</p>}
      {combos.length > 1 && (
        <>
          <div className="table-wrap combinacoes-tabela">
            <table>
              <thead>
                <tr>
                  <th />
                  <th>Opção no anúncio</th>
                  <th>O que leva</th>
                  <th className="num">Custo</th>
                  <th className="num">Preço em {canal?.nome}</th>
                  <th className="num">Lucro</th>
                  <th className="num">Cliente economiza</th>
                </tr>
              </thead>
              <tbody>
                {combos.map((c) => {
                  const marcada = !desmarcadas.has(c.chave);
                  const fora = regra.quatroX?.fora.includes(c.chave);
                  const rot = rotuloDe(c);
                  return (
                    <tr key={c.chave} className={marcada ? "" : "combinacao-off"}>
                      <td>
                        <input type="checkbox" checked={marcada} onChange={() => alternar(c.chave)} aria-label={`Usar ${c.rotulo}`} />
                      </td>
                      <td>
                        <input className="combinacao-rotulo" value={rot} maxLength={60} onChange={(e) => setRotulos((r) => ({ ...r, [c.chave]: e.target.value }))} />
                        {rot.length > LIMITE_NOME_OPCAO && <div className="hint" style={{ color: "var(--st-atencao)", margin: "2px 0 0" }}>{rot.length} caracteres — a Shopee aceita até {LIMITE_NOME_OPCAO}</div>}
                      </td>
                      <td className="combinacao-leva">
                        {c.nomeKit}
                        <div>{c.novo ? <span className="st st-info">kit novo</span> : <span className="muted-cel">{c.item?.id.startsWith("k:") ? "kit já cadastrado" : "item cadastrado"}</span>}</div>
                      </td>
                      <td className="num">{BRL(c.custo)}</td>
                      <td className="num">
                        {c.preco ? <b>{BRL(c.preco)}</b> : <span className="muted-cel">sem preço</span>}
                        <div className="muted-cel">{c.origemPreco === "salvo" ? "salvo" : c.origemPreco === "sugerido" ? "sugerido (kit)" : !c.item ? "" : "salve no 1º Avulso"}</div>
                        {fora && marcada && <span className="st st-atencao">⚠ passa de 4×</span>}
                      </td>
                      <td className="num">
                        {c.lucro != null ? BRL(c.lucro) : "—"}
                        {c.margem != null && <div className="muted-cel">{PCT(c.margem)}</div>}
                      </td>
                      <td className="num">{c.economiaPct != null ? `${PCT(c.economiaPct)}${c.separado ? ` de ${BRL(c.separado)}` : ""}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {regra.quatroX &&
            (regra.quatroX.ok ? (
              <div className="alerta alerta-good">
                <b>✓ Cabe num anúncio só na {canal.nome}</b>A mais cara ({regra.quatroX.maisCara.rotulo}, original {BRL(regra.quatroX.maisCara.an.original)}) fica a {regra.quatroX.razao.toFixed(1).replace(".", ",")}× do que o cliente paga na mais barata.
              </div>
            ) : (
              <div className="alerta alerta-warn">
                <b>Regra de 4× da {canal.nome}</b>O preço original de uma opção não pode passar de 4× o que o cliente paga na mais barata ({regra.quatroX.maisBarata.rotulo}: {BRL(regra.quatroX.maisBarata.an.clientePaga)} → até {BRL(regra.quatroX.limite)}). Passam: {combos.filter((c) => regra.quatroX.fora.includes(c.chave)).map((c) => c.rotulo).join(", ")}. Tire a opção mais barata ou faça as mais caras em outro anúncio.
                <div style={{ marginTop: 6 }}>
                  <button type="button" className="btn btn-mini" onClick={desmarcarFora}>
                    Desmarcar as que passam
                  </button>
                </div>
              </div>
            ))}
          {regra.nomeVariacao && <div className="alerta alerta-warn">{regra.nomeVariacao}</div>}
          {marcadas.some((c) => !c.preco) && <p className="hint">Opção sem preço: salve o preço do item no 1º Avulso pra ela entrar certa na ficha.</p>}

          {precosASalvar.length > 0 && (
            <label className="check-inline">
              <input type="checkbox" checked={salvarPrecos} onChange={(e) => setSalvarPrecos(e.target.checked)} /> Salvar o preço sugerido {precosASalvar.length === 1 ? "do kit" : `dos ${precosASalvar.length} kits`} em {canal?.nome} ({precosASalvar.map((c) => BRL(c.sugerido)).join(" · ")})
            </label>
          )}
        </>
      )}

      <div className="combinacoes-acoes">
        <button type="button" className="btn" onClick={onCancelar} disabled={salvando}>
          Voltar
        </button>
        <button type="button" className="btn primary" onClick={usar} disabled={salvando || marcadas.length < 2}>
          {salvando ? "Criando…" : `Usar ${marcadas.length} combinações${novos.length ? ` (cria ${novos.length} ${novos.length === 1 ? "kit" : "kits"})` : ""}`}
        </button>
      </div>
    </div>
  );
}
