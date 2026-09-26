import { useMemo, useState } from "react";
import { calcCanal } from "../lib/calc.js";
import { BRL, PCT, arredondarPreco } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import Termometro from "./Termometro.jsx";
import TopbarAcoes from "./TopbarAcoes.jsx";
import { useRankingData } from "../hooks/useRankingData.js";
import { useSincronizarAoVivo } from "../hooks/useSincronizarAoVivo.js";
import { gruposDoSeletor } from "../lib/variacoes.js";
import Ajuda from "./Ajuda.jsx";

const DEFAULTS = {
  nome: "",
  custoProduto: "",
  frete: 0,
  embalagem: 0,
  imposto: 0,
  custosFixos: 2,
  lucratividade: 30,
  nivel: "padrao",
  horasModelagem: 0,
  valorHoraModelagem: 0,
};

// Ponto de partida pra precificar personalizado — não é uma regra fixa, é
// só um jeito de não começar do zero toda vez: um projeto sob medida tem
// mais valor agregado que um produto de catálogo por dois motivos, cada um
// com seu próprio campo aqui embaixo — o TEMPO de modelagem/projeto (que
// vira uma taxa própria, horas × seu valor-hora de projeto, separada do
// custo de produção) e o RISCO/exclusividade de ser uma peça única, sem
// tiragem pra diluir o esforço depois (refletido numa margem-alvo maior).
// Escolher um nível só preenche os três campos abaixo com uma sugestão —
// TODOS continuam editáveis na mão, e ajustar um não muda os outros.
const NIVEIS_DIFICULDADE = [
  { key: "padrao", label: "Padrão (cor/tamanho, sem modelagem nova)", lucratividade: 30, horasModelagem: 0, valorHoraModelagem: 0 },
  { key: "complexo", label: "Complexo (modelagem nova ou adaptação grande)", lucratividade: 40, horasModelagem: 1, valorHoraModelagem: 40 },
  { key: "exclusivo", label: "Exclusivo / protótipo (peça única, do zero)", lucratividade: 50, horasModelagem: 2, valorHoraModelagem: 60 },
];

// Venda direta pra um pedido personalizado (encomenda): sem comissão nem
// taxa fixa de marketplace, já que não passa pela Shopee/ML.
export default function OrcamentoAvulso({ onToast }) {
  const { lojaId } = useLoja();
  // Produtos (custo/embalagem AO VIVO), variações e kits do catálogo compartilhado.
  const { itens: itensCatalogo, produtos } = useRankingData();
  const [produtoId, setProdutoId] = useState("");
  const [f, setF] = useState(DEFAULTS);
  const [salvando, setSalvando] = useState(false);

  // produtoId agora é um id prefixado ("p:"/"v:"/"k:"), como nas outras telas.
  // Custo/frete/embalagem acompanham o cadastro AO VIVO enquanto você não
  // digitar outro valor na mão.
  const valoresItem = (() => {
    if (!produtoId) return null;
    const [t, id] = produtoId.split(":");
    if (t === "p") {
      const p = produtos.find((x) => x.id === id);
      return p ? { custoProduto: arredondarPreco(p.custo_producao), frete: arredondarPreco(p.frete_padrao || 0), embalagem: arredondarPreco(p.embalagem_padrao || 0) } : null;
    }
    const it = itensCatalogo.find((x) => x.id === produtoId);
    if (!it) return null;
    if (t === "v") return { custoProduto: it.custoProducao, frete: it.frete, embalagem: it.embalagem };
    return { custoProduto: arredondarPreco(it.custoTotal), frete: 0, embalagem: 0 };
  })();
  const produtoSelecionado = valoresItem ? itensCatalogo.find((x) => x.id === produtoId) || null : null;
  useSincronizarAoVivo(valoresItem ? produtoId : "", valoresItem, setF);

  const set = (key) => (e) => {
    const v = e.target.value;
    setF((prev) => ({ ...prev, [key]: v === "" ? "" : parseFloat(v) }));
  };
  const n = (v) => {
    const x = Number(v);
    return isFinite(x) ? x : 0;
  };

  // Aplica a sugestão de um nível de dificuldade — só preenche lucratividade
  // e as horas/valor-hora de modelagem, não mexe em custo/frete/embalagem
  // nem no nome do pedido. Escolher de novo (ou trocar de nível) sobrescreve
  // esses três campos com a sugestão nova; entre uma escolha e outra, os tres
  // continuam livres pra editar na mão a qualquer momento.
  function aplicarNivel(chave) {
    const nivel = NIVEIS_DIFICULDADE.find((nv) => nv.key === chave);
    if (!nivel) return;
    setF((prev) => ({
      ...prev,
      nivel: chave,
      lucratividade: nivel.lucratividade,
      horasModelagem: nivel.horasModelagem,
      valorHoraModelagem: nivel.valorHoraModelagem,
    }));
  }

  const taxaProjeto = arredondarPreco(n(f.horasModelagem) * n(f.valorHoraModelagem));

  const resultado = useMemo(() => {
    return calcCanal({
      imposto: n(f.imposto) / 100,
      comissaoPct: 0,
      taxaFixa: 0,
      custosFixosPct: n(f.custosFixos) / 100,
      lucratividadePct: n(f.lucratividade) / 100,
      custoProduto: n(f.custoProduto) + taxaProjeto,
      frete: n(f.frete),
      embalagem: n(f.embalagem),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, taxaProjeto]);

  async function salvar() {
    const nome = f.nome.trim();
    if (!nome) {
      onToast("Dê um nome ao pedido antes de salvar");
      return;
    }
    if (!supabase) {
      onToast("Histórico indisponível (Supabase não configurado)");
      return;
    }
    setSalvando(true);
    const { error } = await supabase.from("orcamentos_avulsos").insert({
      nome,
      custo_total: arredondarPreco(resultado.custoTotal),
      preco: arredondarPreco(resultado.preco),
      lucro: arredondarPreco(resultado.lucro),
      margem: resultado.margem,
      ...(lojaId ? { loja_id: lojaId } : {}),
    });
    setSalvando(false);
    if (error) {
      onToast("Não foi possível salvar agora — tente de novo");
      return;
    }
    onToast("Orçamento salvo em Orçamentos salvos");
    setF((prev) => ({ ...prev, nome: "" }));
  }

  // Zera o formulário inteiro de volta pros padrões — desmarca o produto
  // cadastrado escolhido e todos os campos preenchidos na mão.
  function limparTudo() {
    setProdutoId("");
    setF(DEFAULTS);
  }

  return (
    <>
    <TopbarAcoes aba="orcamento">
      <button type="button" className="btn" onClick={limparTudo}>
        Limpar
      </button>
    </TopbarAcoes>
    <div className="grid2">
      <div>
        <div className="panel">
          <h3 className="section-title">
            <span>
              Pedido personalizado
              <Ajuda texto="Pra encomendas vendidas direto (fora de marketplace) — sem comissão nem taxa fixa de plataforma. Escolha um produto já cadastrado pra puxar o custo automaticamente, ou preencha manualmente pra algo sob medida." />
            </span>
          </h3>
          <div className="field">
            <label>Produto, variação ou kit (opcional)</label>
            <select value={produtoSelecionado ? produtoId : ""} onChange={(e) => setProdutoId(e.target.value)}>
              <option value="">— preencher manualmente —</option>
              {gruposDoSeletor(itensCatalogo).map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.itens.map((it) => (
                    <option key={it.id} value={it.id}>{it.rotulo}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Custo de produção (R$)</label>
            <input type="number" step="0.01" value={f.custoProduto} onChange={set("custoProduto")} />
          </div>
          <div className="row2">
            <div className="field">
              <label>Frete (R$)</label>
              <input type="number" step="0.01" value={f.frete} onChange={set("frete")} />
            </div>
            <div className="field">
              <label>Embalagem (R$)</label>
              <input type="number" step="0.01" value={f.embalagem} onChange={set("embalagem")} />
            </div>
          </div>
          {produtoSelecionado && (
            <div className="hint" style={{ marginBottom: 0 }}>
              Custo, frete e embalagem preenchidos com o cadastro (variação já com o que foi personalizado nela) e atualizados sozinhos se o cadastro mudar — a não ser que você digite outro valor.
            </div>
          )}
        </div>

        <div className="panel">
          <h3 className="section-title">
            Complexidade do projeto
            <Ajuda texto="Personalizado tem mais valor agregado que produto de catálogo por dois motivos: o TEMPO de modelagem/projeto (horas × seu valor-hora de projeto, uma taxa própria, separada do custo de produção) e o RISCO de ser peça única, sem tiragem pra diluir esforço depois (margem-alvo maior). Escolher um nível aqui é só um ponto de partida — preenche Lucratividade (no painel Parâmetros) e as horas/valor-hora abaixo, mas os três continuam livres pra ajustar na mão quando você achar que precisa reajustar." />
          </h3>
          <div className="field">
            <label>Nível de dificuldade</label>
            <select value={f.nivel} onChange={(e) => aplicarNivel(e.target.value)}>
              {NIVEIS_DIFICULDADE.map((nv) => (
                <option key={nv.key} value={nv.key}>{nv.label}</option>
              ))}
            </select>
          </div>
          <div className="row2" style={{ marginBottom: 0 }}>
            <div className="field">
              <label>Horas de modelagem/projeto</label>
              <input type="number" step="0.5" min="0" value={f.horasModelagem} onChange={set("horasModelagem")} />
            </div>
            <div className="field">
              <label>Seu valor-hora de projeto (R$)</label>
              <input type="number" step="1" min="0" value={f.valorHoraModelagem} onChange={set("valorHoraModelagem")} />
            </div>
          </div>
          <div className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
            Taxa de projeto: {BRL(taxaProjeto)} {taxaProjeto > 0 && "(entra no custo total, cobrada mesmo se ainda não fabricou nada)"} — os
            valores sugeridos por nível são só um ponto de partida, ajuste como achar melhor a qualquer momento.
          </div>
        </div>

        <div className="panel">
          <h3 className="section-title">
            Parâmetros
            <Ajuda texto="Imposto é o % que você recolhe sobre a venda (MEI com DAS fixo pode deixar em 0%). Custos fixos é qualquer % extra recorrente. Margem desejada é a lucratividade líquida que define o preço sugerido." />
          </h3>
          <div className="row3">
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Imposto (%)</label>
              <input type="number" step="0.1" value={f.imposto} onChange={set("imposto")} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Custos fixos (%)</label>
              <input type="number" step="0.1" value={f.custosFixos} onChange={set("custosFixos")} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Margem desejada (%)</label>
              <input type="number" step="1" value={f.lucratividade} onChange={set("lucratividade")} />
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="panel">
          <h3>Preço sugerido</h3>
          <div className="kv"><span className="k">Custo de produção</span><span className="v">{BRL(n(f.custoProduto))}</span></div>
          <div className="kv"><span className="k">Frete</span><span className="v">{BRL(n(f.frete))}</span></div>
          <div className="kv"><span className="k">Embalagem</span><span className="v">{BRL(n(f.embalagem))}</span></div>
          {taxaProjeto > 0 && (
            <div className="kv"><span className="k">Taxa de projeto ({n(f.horasModelagem)}h × {BRL(n(f.valorHoraModelagem))}/h)</span><span className="v">{BRL(taxaProjeto)}</span></div>
          )}
          <div className="destaque-custo">
            <span className="k">Custo total</span>
            <span className="v">{BRL(resultado.custoTotal)}</span>
          </div>
          <div className="destaque-preco">
            <span className="k">
              Preço definido para o pedido
              <span className="k-sub">valor a cobrar do cliente</span>
            </span>
            <span className="v">{BRL(resultado.preco)}</span>
          </div>
          <div className="destaque-lucro">
            <span className="k">
              Quanto cai no seu bolso
              <span className="k-sub">lucro líquido por unidade, já descontado tudo</span>
            </span>
            <span className="v">{BRL(resultado.lucro)}</span>
          </div>
          <div className="kv"><span className="k">Margem líquida</span><span className="v">{PCT(resultado.margem)}</span></div>
          <Termometro valor={resultado.margem} meta={n(f.lucratividade) / 100} />
          <div className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
            Sem comissão de marketplace — o preço já reflete o quanto você economiza vendendo direto.
          </div>
        </div>

        <div className="panel">
          <h3 className="section-title">Salvar em Orçamentos</h3>
          <div className="save-row">
            <div className="field">
              <label>Nome do pedido</label>
              <input type="text" placeholder="ex: Encomenda 6x porta-retrato" value={f.nome} onChange={(e) => setF((p) => ({ ...p, nome: e.target.value }))} />
            </div>
            <button className="btn primary" onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
