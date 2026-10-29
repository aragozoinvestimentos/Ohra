import { useState } from "react";
import { custoArtesanal } from "../lib/calc.js";
import { BRL } from "../lib/format.js";
import SeletorItens from "./SeletorItens.jsx";
import Ajuda from "./Ajuda.jsx";

// Parte ARTESANAL do custo de produção (22/10/2026 — vela, suporte de cimento,
// molde…). Fica RECOLHIDA (pedido do Gustavo: não poluir a tela quando não
// usa); abre sozinha quando o produto já tem itens artesanais. Grava em
// producao_detalhe.artesanal (+ sem3d) — a conta é custoArtesanal (calc.js).
// `valor` = { artesanal, sem3d }; `onChange({ artesanal, sem3d })`.
export default function ParteArtesanal({ valor, materiais, onChange, embutido = false }) {
  const a = valor?.artesanal || null;
  const sem3d = !!valor?.sem3d;
  const conta = custoArtesanal({ artesanal: a }, materiais);
  const temAlgo = !!conta && !conta.vazio;
  const [aberto, setAberto] = useState(temAlgo || sem3d);
  const abertoReal = aberto || sem3d;
  const catalogo = (materiais || []).filter((m) => m.tipo === "consumivel").map((m) => ({ id: m.id, nome: m.nome, preco: m.preco, unidade: m.unidade }));
  const base = { itens: [], avulsos: [], lote: 1, peso: "", ...(a || {}) };
  const mudar = (campo, v) => onChange({ artesanal: { ...base, [campo]: v }, sem3d });
  const lote = Math.max(1, Number(base.lote) || 1);
  const avulsos = base.avulsos || [];
  const setAvulso = (i, k, v) => mudar("avulsos", avulsos.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  return (
    <div className={`${embutido ? "parte-artesanal-embutida" : "panel"} parte-artesanal${abertoReal ? " aberta" : ""}`}>
      <h3 className="section-title">
        <button type="button" className="link-btn parte-artesanal-toggle" onClick={() => setAberto(!abertoReal)} disabled={sem3d} aria-expanded={abertoReal}>
          {abertoReal ? "▾" : "▸"} Parte artesanal <span className="muted-cel">(opcional — vela, cimento, molde…)</span>
        </button>
        {temAlgo && !abertoReal && <span className="parte-artesanal-total">{BRL(conta.porPeca)} por peça</span>}
        <Ajuda texto="Pra produto que leva uma parte feita à mão além (ou no lugar) da impressão 3D — ex.: a vela e a jarrinha de um kit, um suporte de cimento. Os itens vêm de Insumos → Materiais → Consumíveis (o preço atualiza sozinho a cada compra registrada); item avulso fica com o valor digitado. Só custo: sem falhas e sem mão de obra. Entra no custo de produção da peça e no preço sugerido." />
      </h3>
      {abertoReal && (
        <>
          <div className="parte-artesanal-lote">
            <span className="muted-cel">Receita de:</span>
            <label>
              <input type="radio" checked={lote === 1 && !base.loteAberto} onChange={() => onChange({ artesanal: { ...base, lote: 1, loteAberto: false }, sem3d })} /> 1 peça
            </label>
            <label>
              <input type="radio" checked={lote > 1 || !!base.loteAberto} onChange={() => onChange({ artesanal: { ...base, loteAberto: true, lote: lote > 1 ? lote : "" }, sem3d })} /> um lote de
              <input type="number" min="1" step="1" className="parte-artesanal-n" placeholder="10" value={lote > 1 || base.loteAberto ? base.lote : ""} onChange={(e) => onChange({ artesanal: { ...base, loteAberto: true, lote: e.target.value }, sem3d })} />
              peças <span className="muted-cel">(o app divide)</span>
            </label>
          </div>
          <SeletorItens
            catalogo={catalogo}
            itens={base.itens || []}
            onChange={(itens) => mudar("itens", itens)}
            rotuloVazio='Nenhum consumível cadastrado — cadastre cera, pavio, cimento, jarrinha… em Estoque e compras → Materiais, tipo "Consumível". Ou use um item avulso abaixo.'
          />
          {avulsos.map((av, i) => (
            <div className="seletor-linha" key={i}>
              <input type="text" placeholder="Item avulso (ex.: fita decorativa)" value={av.nome || ""} onChange={(e) => setAvulso(i, "nome", e.target.value)} style={{ flex: 1 }} />
              <input type="number" step="0.01" min="0" className="seletor-qtd" placeholder="R$" value={av.valor ?? ""} onChange={(e) => setAvulso(i, "valor", e.target.value)} />
              <span className="seletor-subtotal muted-cel">avulso</span>
              <button type="button" className="del" title="Remover" onClick={() => mudar("avulsos", avulsos.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => mudar("avulsos", [...avulsos, { nome: "", valor: "" }])}>
            + Item avulso (digitar valor)
          </button>
          <div className="row2" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Peso da parte artesanal por peça (g)</label>
              <input type="number" step="1" min="0" placeholder="opcional — pro frete" value={base.peso ?? ""} onChange={(e) => mudar("peso", e.target.value)} />
            </div>
            <div className="field">
              <label>Total artesanal</label>
              <div className="parte-artesanal-soma">
                <b>{BRL(conta?.porPeca || 0)}</b> por peça
                {lote > 1 && <span className="muted-cel"> · lote {BRL(conta?.totalLote || 0)} ÷ {lote}</span>}
              </div>
            </div>
          </div>
          <label className="parte-artesanal-sem3d">
            <input type="checkbox" checked={sem3d} onChange={(e) => onChange({ artesanal: base, sem3d: e.target.checked })} /> Só artesanal — este produto não tem parte impressa em 3D
          </label>
        </>
      )}
    </div>
  );
}
