import { useEffect, useMemo, useState } from "react";
import { calcCanal } from "../lib/calc.js";
import { BRL, PCT, arredondarPreco } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import Termometro from "./Termometro.jsx";
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
  const [produtos, setProdutos] = useState([]);
  const [produtoId, setProdutoId] = useState("");
  const [f, setF] = useState(DEFAULTS);
  const [salvando, setSalvando] = useState(false);

  // Troca de loja invalida a seleção anterior de produto cadastrado.
  useEffect(() => {
    setProdutoId("");
  }, [lojaId]);

  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    async function carregar() {
      let query = supabase.from("produtos_cadastro").select("*").order("nome");
      if (lojaId) query = query.eq("loja_id", lojaId);
      const { data, error } = await query;
      if (!ativo || error) return;
      setProdutos(data || []);
    }
    carregar();
    // Sem isso, cadastrar/editar/excluir um produto em Cadastros só refletia
    // aqui depois de recarregar a página inteira.
    const canal = supabase
      .channel("orcamento-avulso-produtos-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "produtos_cadastro" }, carregar)
      .subscribe();
    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, [lojaId]);

  const produtoSelecionado = produtos.find((p) => p.id === produtoId) || null;

  useEffect(() => {
    if (!produtoId) return;
    if (!produtoSelecionado) {
      // Seleção antiga não existe mais nesta loja (ex: acabou de trocar de
      // loja) — volta pro preenchimento manual em vez de manter valores presos.
      setF((prev) => ({ ...prev, custoProduto: "", frete: 0, embalagem: 0 }));
      return;
    }
    setF((prev) => ({
      ...prev,
      custoProduto: arredondarPreco(produtoSelecionado.custo_producao),
      frete: arredondarPreco(produtoSelecionado.frete_padrao || 0),
      embalagem: arredondarPreco(produtoSelecionado.embalagem_padrao || 0),
    }));
  }, [produtoId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <div className="grid2">
      <div>
        <div className="panel">
          <h3 className="section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span>
              Pedido personalizado
              <Ajuda texto="Pra encomendas vendidas direto (fora de marketplace) — sem comissão nem taxa fixa de plataforma. Escolha um produto já cadastrado pra puxar o custo automaticamente, ou preencha manualmente pra algo sob medida." />
            </span>
            <button type="button" className="btn" onClick={limparTudo} style={{ fontWeight: 400 }}>
              Limpar formulário
            </button>
          </h3>
          <div className="field">
            <label>Produto cadastrado (opcional)</label>
            <select value={produtoId} onChange={(e) => setProdutoId(e.target.value)}>
              <option value="">— preencher manualmente —</option>
              {produtos.map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
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
              Preenchido automaticamente com a embalagem já cadastrada nesse produto — não precisa somar de novo.
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
          <h3 className="section-title">Parâmetros</h3>
          <div className="row2">
            <div className="field">
              <label>Imposto sobre a venda — seu CNPJ/MEI (%)</label>
              <input type="number" step="0.1" value={f.imposto} onChange={set("imposto")} />
            </div>
            <div className="field">
              <label>Custos fixos adicionais (%)</label>
              <input type="number" step="0.1" value={f.custosFixos} onChange={set("custosFixos")} />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Lucratividade líquida desejada (%)</label>
            <input type="number" step="1" value={f.lucratividade} onChange={set("lucratividade")} />
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
  );
}
