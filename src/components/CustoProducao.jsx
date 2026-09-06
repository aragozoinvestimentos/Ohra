import { useEffect, useMemo, useState } from "react";
import { calcProducao, DEFAULTS_PRODUCAO } from "../lib/calc.js";
import { BRL } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import Ajuda from "./Ajuda.jsx";
import SeletorItens, { totalItens } from "./SeletorItens.jsx";

const STORAGE_KEY = "ohra:custo-producao:v2";

const DEFAULTS = {
  ...DEFAULTS_PRODUCAO,
  materialNome: "PLA (seu custo real)",
  markupRapido: 100,
};

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    // localStorage indisponível — segue com os padrões
  }
  return DEFAULTS;
}

export default function CustoProducao({ onUsarCusto, onSalvarProduto, onIrParaMateriais }) {
  const { lojaId } = useLoja();
  const [f, setF] = useState(loadInitial);
  const [materiais, setMateriais] = useState([]);
  const [materiaisCarregando, setMateriaisCarregando] = useState(true);
  const [produtos, setProdutos] = useState([]);
  const [produtoId, setProdutoId] = useState("");

  // Troca de loja invalida a seleção anterior de produto cadastrado.
  useEffect(() => {
    setProdutoId("");
  }, [lojaId]);

  // Produtos cadastrados, pra carregar o detalhamento salvo de um deles (se
  // tiver) e reajustar em vez de simular sempre do zero.
  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    async function carregar() {
      let query = supabase.from("produtos_cadastro").select("id, nome, material_nome, producao_detalhe").order("nome");
      if (lojaId) query = query.eq("loja_id", lojaId);
      const { data, error } = await query;
      if (!ativo) return;
      if (!error) setProdutos(data || []);
    }
    carregar();
    const canal = supabase
      .channel("custo-producao-produtos-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "produtos_cadastro" }, carregar)
      .subscribe();
    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, [lojaId]);

  const produtoSelecionado = produtos.find((p) => p.id === produtoId) || null;

  // Ao escolher um produto, carrega o detalhamento salvo dele pros campos —
  // se ele não tiver detalhamento (cadastrado manual/antigo), só ajusta o
  // filamento e deixa o resto como está, pra você preencher e "adotar" ele.
  useEffect(() => {
    if (!produtoId || !produtoSelecionado) return;
    if (produtoSelecionado.producao_detalhe) {
      setF((prev) => ({ ...DEFAULTS, ...produtoSelecionado.producao_detalhe, markupRapido: prev.markupRapido }));
    } else if (produtoSelecionado.material_nome) {
      setF((prev) => ({ ...prev, materialNome: produtoSelecionado.material_nome }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtoId]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(f));
    } catch {
      // sem problema, só não lembra da próxima vez
    }
  }, [f]);

  useEffect(() => {
    if (!supabase) {
      setMateriaisCarregando(false);
      return;
    }
    let ativo = true;
    async function carregar() {
      try {
        let query = supabase.from("materiais").select("*").order("nome", { ascending: true });
        if (lojaId) query = query.eq("loja_id", lojaId);
        const { data, error } = await query;
        if (!ativo) return;
        // Só mostra o que está realmente cadastrado — nada de filamento
        // fictício aparecendo antes de você cadastrar algo de verdade.
        if (!error) setMateriais(data || []);
      } catch {
        // falha de rede — mantém o que já estava carregado
      } finally {
        if (ativo) setMateriaisCarregando(false);
      }
    }
    carregar();
    const canal = supabase
      .channel("materiais-custo-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "materiais" }, carregar)
      .subscribe();
    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, [lojaId]);

  const set = (key) => (e) => {
    const v = e.target.value;
    setF((prev) => ({ ...prev, [key]: v === "" ? "" : parseFloat(v) }));
  };
  const setStr = (key) => (e) => setF((prev) => ({ ...prev, [key]: e.target.value }));

  const n = (v) => {
    const x = Number(v);
    return isFinite(x) ? x : 0;
  };

  const filamentos = materiais.filter((m) => (m.tipo || "filamento") === "filamento");
  const consumiveisCatalogo = materiais.filter((m) => m.tipo === "consumivel");

  const materialSelecionado =
    filamentos.find((m) => m.nome === f.materialNome) || filamentos[filamentos.length - 1] || null;

  const custoConsumiveis = totalItens(consumiveisCatalogo, f.consumiveisItens);

  const resultado = useMemo(() => {
    return calcProducao({
      comprimento: n(f.comprimento),
      diametro: n(f.diametro),
      densidade: n(f.densidade),
      tempo: n(f.tempo),
      precoKg: materialSelecionado?.preco ?? 0,
      kwh: n(f.kwh),
      consumo: n(f.consumo),
      falhasPct: n(f.falhasPct) / 100,
      manutencaoPct: n(f.manutencaoPct) / 100,
      acabamentoPct: n(f.acabamentoPct) / 100,
      consumiveis: custoConsumiveis,
      maquina: n(f.maquina),
      prazoMeses: n(f.prazoMeses),
      horasDia: n(f.horasDia),
      diasMes: n(f.diasMes),
      modelagem: n(f.modelagem),
      markupRapido: n(f.markupRapido) / 100,
      pecasPorPlaca: n(f.pecasPorPlaca) || 1,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, materialSelecionado, custoConsumiveis]);

  if (materiaisCarregando) {
    return (
      <div className="panel">
        <div className="empty">Carregando materiais…</div>
      </div>
    );
  }

  if (filamentos.length === 0) {
    return (
      <div className="panel">
        <h3>Nenhum filamento cadastrado ainda</h3>
        <div className="empty">
          {supabase
            ? "Cadastre pelo menos um filamento em Cadastros → Materiais (Fabricação) antes de calcular um custo de produção — assim o preço por kg usado aqui é sempre o que está de fato registrado."
            : "Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar o cadastro de materiais."}
        </div>
        {supabase && onIrParaMateriais && (
          <button className="btn primary" style={{ marginTop: 12 }} onClick={onIrParaMateriais}>
            Ir para Cadastros → Materiais
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="grid2">
      <div>
        <div className="panel">
          <h3 className="section-title">
            Peça (dados do fatiador)
            <Ajuda texto="Dados que o fatiador (slicer) mostra antes de imprimir. Comprimento é o total de filamento gasto (em metros); diâmetro e densidade dependem do filamento (1.75mm e ~1.24 g/cm³ pra PLA/PETG são padrão); tempo é a duração da impressão. Se você imprime várias peças de uma vez na mesma chapa (aproveitando o espaço da mesa), aumente 'Peças por impressão/chapa' e informe comprimento/tempo do TOTAL da chapa — o app divide tudo automaticamente pra achar o custo de cada peça." />
          </h3>
          {supabase && (
            <div className="field">
              <label>Produto cadastrado (opcional)</label>
              <select value={produtoId} onChange={(e) => setProdutoId(e.target.value)}>
                <option value="">— novo cálculo —</option>
                {produtos.map((p) => (
                  <option key={p.id} value={p.id}>{p.nome}</option>
                ))}
              </select>
            </div>
          )}
          {produtoSelecionado && (
            <div className="hint" style={{ marginTop: -8 }}>
              {produtoSelecionado.producao_detalhe
                ? 'Detalhamento desse produto carregado abaixo — ajuste o que quiser e use "Salvar como Produto" pra atualizar ele (não cria um novo).'
                : 'Esse produto não tem detalhamento salvo ainda — os campos abaixo continuam como estavam. Ao salvar, isso preenche o detalhamento dele.'}
            </div>
          )}
          <div className="field">
            <label>Peças por impressão/chapa</label>
            <input type="number" step="1" min="1" style={{ maxWidth: 160 }} value={f.pecasPorPlaca} onChange={set("pecasPorPlaca")} />
          </div>
          {n(f.pecasPorPlaca) > 1 && (
            <div className="hint" style={{ marginTop: -8 }}>
              Imprimindo {n(f.pecasPorPlaca)} peças de uma vez na mesma chapa: informe comprimento e tempo de impressão do TOTAL da chapa abaixo — o app divide material, energia, manutenção, falhas, acabamento e ROI da máquina por essa quantidade pra chegar no custo de cada peça.
            </div>
          )}
          <div className="row2">
            <div className="field">
              <label>Comprimento de filamento (m){n(f.pecasPorPlaca) > 1 ? " — total da chapa" : ""}</label>
              <input type="number" step="0.01" value={f.comprimento} onChange={set("comprimento")} />
            </div>
            <div className="field">
              <label>Diâmetro do filamento (mm)</label>
              <input type="number" step="0.01" value={f.diametro} onChange={set("diametro")} />
            </div>
          </div>
          <div className="row2">
            <div className="field">
              <label>Densidade (g/cm³)</label>
              <input type="number" step="0.01" value={f.densidade} onChange={set("densidade")} />
            </div>
            <div className="field">
              <label>Tempo de impressão (min){n(f.pecasPorPlaca) > 1 ? " — total da chapa" : ""}</label>
              <input type="number" step="1" value={f.tempo} onChange={set("tempo")} />
            </div>
          </div>
          <div className="field">
            <label>Filamento</label>
            <select value={materialSelecionado?.nome || ""} onChange={setStr("materialNome")}>
              {filamentos.map((m) => (
                <option key={m.id} value={m.nome}>
                  {m.nome} — R${Number(m.preco).toFixed(2)}/kg
                </option>
              ))}
            </select>
          </div>
          {supabase && (
            <div className="hint" style={{ marginBottom: 0 }}>
              Lista puxada da aba Materiais — cadastre ou atualize preços por lá.
            </div>
          )}
        </div>

        <div className="panel">
          <h3 className="section-title">
            Custos de produção
            <Ajuda texto="Preço do kWh e consumo da máquina (em Watts) calculam o custo de energia da impressão. Falhas é a % de peças que costuma dar problema e ser perdida — esse custo é diluído nas que dão certo. Consumíveis é o gasto com cola, spray, lixa etc. (cadastrados em Materiais). Manutenção e acabamento são % aplicados sobre o custo do material, cobrindo desgaste da máquina e pós-processamento." />
          </h3>
          <div className="row2">
            <div className="field">
              <label>Preço do kWh (R$)</label>
              <input type="number" step="0.01" value={f.kwh} onChange={set("kwh")} />
            </div>
            <div className="field">
              <label>Consumo da máquina (W)</label>
              <input type="number" step="1" value={f.consumo} onChange={set("consumo")} />
            </div>
          </div>
          <div className="field">
            <label>Média de falhas (%)</label>
            <input type="number" step="1" style={{ maxWidth: 160 }} value={f.falhasPct} onChange={set("falhasPct")} />
          </div>
          <div className="row2">
            <div className="field">
              <label>Manutenção (% do material)</label>
              <input type="number" step="1" value={f.manutencaoPct} onChange={set("manutencaoPct")} />
            </div>
            <div className="field">
              <label>Acabamento (% do material)</label>
              <input type="number" step="1" value={f.acabamentoPct} onChange={set("acabamentoPct")} />
            </div>
          </div>
          <div className="hint">Manutenção e acabamento são calculados como % sobre o custo do material — ajuste se sua peça exigir mais ou menos pós-processamento.</div>
        </div>

        <div className="panel">
          <h3 className="section-title">
            Consumíveis
            <Ajuda texto="Cola, spray de fixação, lixa, tinta — o que essa peça gasta além do filamento. Escolha o item (cadastrado em Materiais → Consumíveis) e quantas unidades ela usa; o app soma tudo automaticamente." />
          </h3>
          <SeletorItens
            catalogo={consumiveisCatalogo.map((m) => ({ id: m.id, nome: m.nome, preco: m.preco, unidade: m.unidade }))}
            itens={f.consumiveisItens}
            onChange={(itens) => setF((prev) => ({ ...prev, consumiveisItens: itens }))}
            rotuloVazio='Nenhum consumível cadastrado — se usar cola, spray, lixa etc., cadastre em Cadastros → Materiais (Fabricação), tipo "Consumível".'
          />
        </div>

        <div className="panel">
          <h3 className="section-title">
            Retorno de investimento na máquina
            <Ajuda texto="Rateia o valor da impressora entre as peças que ela vai produzir até você 'reaver' o investimento no prazo desejado. Quanto mais horas por dia/dias por mês a máquina roda, menor esse custo por peça — e quanto mais rápido você quer pagar a máquina, maior. Modelagem é só se você pagou por um modelo 3D pronto." />
          </h3>
          <div className="row2">
            <div className="field">
              <label>Valor da máquina (R$)</label>
              <input type="number" step="1" value={f.maquina} onChange={set("maquina")} />
            </div>
            <div className="field">
              <label>Prazo desejado (meses)</label>
              <input type="number" step="1" value={f.prazoMeses} onChange={set("prazoMeses")} />
            </div>
          </div>
          <div className="row2">
            <div className="field">
              <label>Horas de uso por dia</label>
              <input type="number" step="0.5" value={f.horasDia} onChange={set("horasDia")} />
            </div>
            <div className="field">
              <label>Dias de uso por mês</label>
              <input type="number" step="1" value={f.diasMes} onChange={set("diasMes")} />
            </div>
          </div>
          <div className="field">
            <label>Modelagem 3D — se pagou por um modelo (R$)</label>
            <input type="number" step="0.01" value={f.modelagem} onChange={set("modelagem")} />
          </div>
        </div>
      </div>

      <div>
        <div className="panel">
          <h3>Resultado</h3>
          <div className="kv">
            <span className="k">Peso estimado da peça</span>
            <span className="v">{isFinite(Number(resultado.peso)) ? Number(resultado.peso).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " g" : "—"}</span>
          </div>
          <div className="kv"><span className="k">Custo de material</span><span className="v">{BRL(resultado.material)}</span></div>
          <div className="kv"><span className="k">Custo de energia</span><span className="v">{BRL(resultado.energia)}</span></div>
          <div className="kv"><span className="k">Manutenção</span><span className="v">{BRL(resultado.manutencao)}</span></div>
          <div className="kv"><span className="k">Falhas</span><span className="v">{BRL(resultado.falhas)}</span></div>
          <div className="kv"><span className="k">Acabamento</span><span className="v">{BRL(resultado.acabamento)}</span></div>
          <div className="kv"><span className="k">Consumíveis</span><span className="v">{BRL(custoConsumiveis)}</span></div>
          <div className="kv"><span className="k">ROI da máquina nesta peça</span><span className="v">{BRL(resultado.roiPeca)}</span></div>
          <div className="kv"><span className="k">Administrativo</span><span className="v">{BRL(n(f.modelagem))}</span></div>
          <div className="kv total"><span className="k">Custo de produção total</span><span className="v">{BRL(resultado.total)}</span></div>
        </div>
        <div className="panel">
          <h3 className="section-title">
            Cálculo rápido de venda
            <Ajuda texto="Markup é o multiplicador aplicado sobre o custo total pra chegar num preço sugerido — 100% de markup significa vender pelo dobro do custo. É só uma estimativa rápida, sem considerar taxas de canal; pra um preço final por Shopee/ML/etc., use 'Precificação por Canal'." />
          </h3>
          <div className="field">
            <label>Markup desejado (%) — ex: 100% = dobro do custo</label>
            <input type="number" step="1" value={f.markupRapido} onChange={set("markupRapido")} />
          </div>
          <div className="kv total"><span className="k">Preço sugerido</span><span className="v">{BRL(resultado.precoRapido)}</span></div>
          <button
            className="btn primary"
            style={{ marginTop: 10, width: "100%" }}
            onClick={() => onUsarCusto(resultado.total)}
          >
            Usar este custo na Precificação por Canal →
          </button>
          <button
            className="btn"
            style={{ marginTop: 8, width: "100%" }}
            onClick={() =>
              onSalvarProduto({
                id: produtoId || null,
                nome: produtoSelecionado?.nome || "",
                custo: resultado.total,
                materialNome: materialSelecionado?.nome || "",
                detalhe: {
                  comprimento: n(f.comprimento),
                  diametro: n(f.diametro),
                  densidade: n(f.densidade),
                  tempo: n(f.tempo),
                  materialNome: materialSelecionado?.nome || "",
                  kwh: n(f.kwh),
                  consumo: n(f.consumo),
                  falhasPct: n(f.falhasPct),
                  manutencaoPct: n(f.manutencaoPct),
                  acabamentoPct: n(f.acabamentoPct),
                  consumiveisItens: f.consumiveisItens,
                  maquina: n(f.maquina),
                  prazoMeses: n(f.prazoMeses),
                  horasDia: n(f.horasDia),
                  diasMes: n(f.diasMes),
                  modelagem: n(f.modelagem),
                  pecasPorPlaca: Math.max(1, n(f.pecasPorPlaca) || 1),
                },
              })
            }
          >
            {produtoId ? "Atualizar produto cadastrado →" : "Salvar como Produto →"}
          </button>
        </div>
      </div>
    </div>
  );
}
