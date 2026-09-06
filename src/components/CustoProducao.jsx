import { useEffect, useMemo, useState } from "react";
import { FILAMENTOS, calcProducao } from "../lib/calc.js";
import { BRL } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import Ajuda from "./Ajuda.jsx";

const STORAGE_KEY = "ohra:custo-producao:v2";

const DEFAULTS = {
  comprimento: 5,
  diametro: 1.75,
  densidade: 1.24,
  tempo: 35,
  materialNome: "PLA (seu custo real)",
  kwh: 1.05,
  consumo: 350,
  falhasPct: 10,
  manutencaoPct: 15,
  acabamentoPct: 10,
  fixacao: 0.2,
  maquina: 3198,
  prazoMeses: 12,
  horasDia: 6,
  diasMes: 26,
  modelagem: 0,
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

const FALLBACK_MATERIAIS = FILAMENTOS.map((f) => ({ id: f.nome, nome: f.nome, preco_kg: f.preco }));

export default function CustoProducao({ onUsarCusto, onSalvarProduto }) {
  const [f, setF] = useState(loadInitial);
  const [materiais, setMateriais] = useState(FALLBACK_MATERIAIS);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(f));
    } catch {
      // sem problema, só não lembra da próxima vez
    }
  }, [f]);

  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    async function carregar() {
      const { data, error } = await supabase.from("materiais").select("*").order("nome", { ascending: true });
      if (!ativo || error || !data || data.length === 0) return;
      setMateriais(data);
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
  }, []);

  const set = (key) => (e) => {
    const v = e.target.value;
    setF((prev) => ({ ...prev, [key]: v === "" ? "" : parseFloat(v) }));
  };
  const setStr = (key) => (e) => setF((prev) => ({ ...prev, [key]: e.target.value }));

  const n = (v) => (isFinite(v) ? v : 0);

  const materialSelecionado =
    materiais.find((m) => m.nome === f.materialNome) || materiais[materiais.length - 1] || FALLBACK_MATERIAIS[0];

  const resultado = useMemo(() => {
    return calcProducao({
      comprimento: n(f.comprimento),
      diametro: n(f.diametro),
      densidade: n(f.densidade),
      tempo: n(f.tempo),
      precoKg: materialSelecionado?.preco_kg ?? 0,
      kwh: n(f.kwh),
      consumo: n(f.consumo),
      falhasPct: n(f.falhasPct) / 100,
      manutencaoPct: n(f.manutencaoPct) / 100,
      acabamentoPct: n(f.acabamentoPct) / 100,
      fixacao: n(f.fixacao),
      maquina: n(f.maquina),
      prazoMeses: n(f.prazoMeses),
      horasDia: n(f.horasDia),
      diasMes: n(f.diasMes),
      modelagem: n(f.modelagem),
      markupRapido: n(f.markupRapido) / 100,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, materialSelecionado]);

  return (
    <div className="grid2">
      <div>
        <div className="panel">
          <h3 className="section-title">
            Peça (dados do fatiador)
            <Ajuda texto="Dados que o fatiador (slicer) mostra antes de imprimir. Comprimento é o total de filamento gasto na peça (em metros); diâmetro e densidade dependem do filamento (1.75mm e ~1.24 g/cm³ pra PLA/PETG são padrão); tempo é a duração da impressão. Com isso o app calcula o peso da peça e o custo de material." />
          </h3>
          <div className="row2">
            <div className="field">
              <label>Comprimento de filamento (m)</label>
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
              <label>Tempo de impressão (min)</label>
              <input type="number" step="1" value={f.tempo} onChange={set("tempo")} />
            </div>
          </div>
          <div className="field">
            <label>Filamento</label>
            <select value={materialSelecionado?.nome || ""} onChange={setStr("materialNome")}>
              {materiais.map((m) => (
                <option key={m.id} value={m.nome}>
                  {m.nome} — R${Number(m.preco_kg).toFixed(2)}/kg
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
            <Ajuda texto="Preço do kWh e consumo da máquina (em Watts) calculam o custo de energia da impressão. Falhas é a % de peças que costuma dar problema e ser perdida — esse custo é diluído nas que dão certo. Fixação é o gasto com spray/cola pra base aderir. Manutenção e acabamento são % aplicados sobre o custo do material, cobrindo desgaste da máquina e pós-processamento (lixar, pintar etc.)." />
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
          <div className="row2">
            <div className="field">
              <label>Média de falhas (%)</label>
              <input type="number" step="1" value={f.falhasPct} onChange={set("falhasPct")} />
            </div>
            <div className="field">
              <label>Fixação — spray/cola (R$)</label>
              <input type="number" step="0.01" value={f.fixacao} onChange={set("fixacao")} />
            </div>
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
            <span className="v">{isFinite(resultado.peso) ? resultado.peso.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " g" : "—"}</span>
          </div>
          <div className="kv"><span className="k">Custo de material</span><span className="v">{BRL(resultado.material)}</span></div>
          <div className="kv"><span className="k">Custo de energia</span><span className="v">{BRL(resultado.energia)}</span></div>
          <div className="kv"><span className="k">Manutenção</span><span className="v">{BRL(resultado.manutencao)}</span></div>
          <div className="kv"><span className="k">Falhas</span><span className="v">{BRL(resultado.falhas)}</span></div>
          <div className="kv"><span className="k">Acabamento</span><span className="v">{BRL(resultado.acabamento)}</span></div>
          <div className="kv"><span className="k">Fixação</span><span className="v">{BRL(n(f.fixacao))}</span></div>
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
            onClick={() => onSalvarProduto({ custo: resultado.total, materialNome: materialSelecionado?.nome || "" })}
          >
            Salvar como Produto →
          </button>
        </div>
      </div>
    </div>
  );
}
