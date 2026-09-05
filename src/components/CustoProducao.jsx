import { useMemo, useState } from "react";
import { FILAMENTOS, calcProducao } from "../lib/calc.js";
import { BRL } from "../lib/format.js";

const DEFAULTS = {
  comprimento: 5,
  diametro: 1.75,
  densidade: 1.24,
  tempo: 35,
  filamentoIdx: FILAMENTOS.length - 1, // PLA (seu custo real)
  kwh: 1.05,
  consumo: 350,
  falhasPct: 10,
  fixacao: 0.2,
  maquina: 3198,
  prazoMeses: 12,
  horasDia: 6,
  diasMes: 26,
  modelagem: 0,
  markupRapido: 100,
};

export default function CustoProducao({ onUsarCusto }) {
  const [f, setF] = useState(DEFAULTS);

  const set = (key) => (e) => {
    const v = e.target.value;
    setF((prev) => ({ ...prev, [key]: v === "" ? "" : parseFloat(v) }));
  };
  const setIdx = (key) => (e) => setF((prev) => ({ ...prev, [key]: parseInt(e.target.value, 10) }));

  const n = (v) => (isFinite(v) ? v : 0);

  const resultado = useMemo(() => {
    const filamento = FILAMENTOS[f.filamentoIdx] || FILAMENTOS[FILAMENTOS.length - 1];
    return calcProducao({
      comprimento: n(f.comprimento),
      diametro: n(f.diametro),
      densidade: n(f.densidade),
      tempo: n(f.tempo),
      precoKg: filamento.preco,
      kwh: n(f.kwh),
      consumo: n(f.consumo),
      falhasPct: n(f.falhasPct) / 100,
      fixacao: n(f.fixacao),
      maquina: n(f.maquina),
      prazoMeses: n(f.prazoMeses),
      horasDia: n(f.horasDia),
      diasMes: n(f.diasMes),
      modelagem: n(f.modelagem),
      markupRapido: n(f.markupRapido) / 100,
    });
  }, [f]);

  return (
    <div className="grid2">
      <div>
        <div className="panel">
          <h3 className="section-title">Peça (dados do fatiador)</h3>
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
            <select value={f.filamentoIdx} onChange={setIdx("filamentoIdx")}>
              {FILAMENTOS.map((it, i) => (
                <option key={it.nome} value={i}>
                  {it.nome} — R${it.preco.toFixed(2)}/kg
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="panel">
          <h3 className="section-title">Custos de produção</h3>
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
          <div className="hint">Manutenção (15%) e acabamento (10%) são calculados sobre o custo do material.</div>
        </div>

        <div className="panel">
          <h3 className="section-title">Retorno de investimento na máquina</h3>
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
          <h3 className="section-title">Cálculo rápido de venda</h3>
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
        </div>
      </div>
    </div>
  );
}
