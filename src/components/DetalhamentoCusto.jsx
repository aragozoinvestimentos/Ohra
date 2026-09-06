import { BRL } from "../lib/format.js";
import SeletorItens from "./SeletorItens.jsx";

// Campo numérico compacto que mostra "(era X)" do lado do rótulo quando o
// valor atual difere do que estava salvo antes dessa edição — pra você ver
// o que mudou sem precisar lembrar de cabeça o número anterior.
function CampoNum({ label, valor, anterior, onChange, step = "1" }) {
  const mudou = anterior != null && String(anterior) !== "" && Number(anterior) !== Number(valor);
  return (
    <div className="field">
      <label>
        {label}
        {mudou && <span className="campo-anterior"> (era {anterior})</span>}
      </label>
      <input type="number" step={step} value={valor} onChange={(e) => onChange(e.target.value === "" ? "" : parseFloat(e.target.value))} />
    </div>
  );
}

// Seção recolhível dentro do cadastro de Produto: reaproveita a mesma
// fórmula da aba Custo de Produção (calcProducao), mas guardada por
// produto — assim dá pra conferir depois quais métricas geraram aquele
// custo, ajustar qualquer uma e ver o total recalculado na hora com os
// preços ATUAIS de material (não um valor congelado do dia do cadastro).
export default function DetalhamentoCusto({ detalhe, salvo, filamentos, consumiveisCatalogo, resultado, custoConsumiveis, onChange, onIniciar }) {
  if (!detalhe) {
    return (
      <div className="hint" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span>Este produto não tem o detalhamento do custo de produção salvo (foi cadastrado com um valor manual, ou antes desse recurso existir).</span>
        <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onIniciar}>
          + Preencher detalhamento
        </button>
      </div>
    );
  }

  const set = (campo) => (v) => onChange({ ...detalhe, [campo]: v });

  return (
    <div className="detalhe-producao">
      <div className="row2">
        <CampoNum label="Comprimento de filamento (m)" valor={detalhe.comprimento} anterior={salvo?.comprimento} onChange={set("comprimento")} step="0.01" />
        <CampoNum label="Diâmetro do filamento (mm)" valor={detalhe.diametro} anterior={salvo?.diametro} onChange={set("diametro")} step="0.01" />
      </div>
      <div className="row2">
        <CampoNum label="Densidade (g/cm³)" valor={detalhe.densidade} anterior={salvo?.densidade} onChange={set("densidade")} step="0.01" />
        <CampoNum label="Tempo de impressão (min)" valor={detalhe.tempo} anterior={salvo?.tempo} onChange={set("tempo")} />
      </div>
      <div className="field">
        <label>
          Filamento
          {salvo && salvo.materialNome !== detalhe.materialNome && <span className="campo-anterior"> (era {salvo.materialNome})</span>}
        </label>
        <select value={detalhe.materialNome} onChange={(e) => set("materialNome")(e.target.value)}>
          {filamentos.map((m) => (
            <option key={m.id} value={m.nome}>
              {m.nome} — R${Number(m.preco).toFixed(2)}/kg
            </option>
          ))}
        </select>
      </div>

      <div className="row2">
        <CampoNum label="Preço do kWh (R$)" valor={detalhe.kwh} anterior={salvo?.kwh} onChange={set("kwh")} step="0.01" />
        <CampoNum label="Consumo da máquina (W)" valor={detalhe.consumo} anterior={salvo?.consumo} onChange={set("consumo")} />
      </div>
      <div className="row3">
        <CampoNum label="Falhas (%)" valor={detalhe.falhasPct} anterior={salvo?.falhasPct} onChange={set("falhasPct")} />
        <CampoNum label="Manutenção (%)" valor={detalhe.manutencaoPct} anterior={salvo?.manutencaoPct} onChange={set("manutencaoPct")} />
        <CampoNum label="Acabamento (%)" valor={detalhe.acabamentoPct} anterior={salvo?.acabamentoPct} onChange={set("acabamentoPct")} />
      </div>

      <div className="field">
        <label>Consumíveis usados</label>
        <SeletorItens
          catalogo={consumiveisCatalogo}
          itens={detalhe.consumiveisItens || []}
          onChange={(itens) => set("consumiveisItens")(itens)}
          rotuloVazio="Nenhum consumível nessa peça."
        />
      </div>

      <div className="row2">
        <CampoNum label="Valor da máquina (R$)" valor={detalhe.maquina} anterior={salvo?.maquina} onChange={set("maquina")} />
        <CampoNum label="Prazo desejado (meses)" valor={detalhe.prazoMeses} anterior={salvo?.prazoMeses} onChange={set("prazoMeses")} />
      </div>
      <div className="row3">
        <CampoNum label="Horas de uso/dia" valor={detalhe.horasDia} anterior={salvo?.horasDia} onChange={set("horasDia")} step="0.5" />
        <CampoNum label="Dias de uso/mês" valor={detalhe.diasMes} anterior={salvo?.diasMes} onChange={set("diasMes")} />
        <CampoNum label="Modelagem 3D (R$)" valor={detalhe.modelagem} anterior={salvo?.modelagem} onChange={set("modelagem")} step="0.01" />
      </div>

      {resultado && (
        <div className="detalhe-resultado">
          <div className="kv"><span className="k">Peso estimado</span><span className="v">{Number(resultado.peso || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} g</span></div>
          <div className="kv"><span className="k">Material</span><span className="v">{BRL(resultado.material)}</span></div>
          <div className="kv"><span className="k">Energia</span><span className="v">{BRL(resultado.energia)}</span></div>
          <div className="kv"><span className="k">Manutenção</span><span className="v">{BRL(resultado.manutencao)}</span></div>
          <div className="kv"><span className="k">Falhas</span><span className="v">{BRL(resultado.falhas)}</span></div>
          <div className="kv"><span className="k">Acabamento</span><span className="v">{BRL(resultado.acabamento)}</span></div>
          <div className="kv"><span className="k">Consumíveis</span><span className="v">{BRL(custoConsumiveis)}</span></div>
          <div className="kv"><span className="k">ROI da máquina</span><span className="v">{BRL(resultado.roiPeca)}</span></div>
          <div className="kv"><span className="k">Modelagem</span><span className="v">{BRL(detalhe.modelagem)}</span></div>
          <div className="kv total"><span className="k">Total (bate com "Custo de produção" acima)</span><span className="v">{BRL(resultado.total)}</span></div>
        </div>
      )}
    </div>
  );
}
