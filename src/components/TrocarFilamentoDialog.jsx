import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useRankingData } from "../hooks/useRankingData.js";
import { recarregarCatalogo } from "../lib/catalogoStore.js";
import { custoProducaoAtual } from "../lib/aoVivo.js";
import { ehFilamento, materiaisComFilamento } from "../lib/trocaFilamento.js";
import { BRL } from "../lib/format.js";
import { normalizarTexto } from "../lib/texto.js";
import EditarDialog from "./EditarDialog.jsx";

// Produção → Insumos → Materiais → "usar em produtos…" (22/10/2026, pedido do
// Gustavo: migrar produtos pro PETG). Troca o filamento de VÁRIOS produtos de uma
// vez: grava material_nome/material_id + producao_detalhe.materialNome (e o das
// variações "fatiador" que usavam o mesmo filamento do produto). O PREÇO SALVO NÃO
// MUDA — o custo cai (ou sobe) e o lucro acompanha, ao vivo, em todo o app.
const materialDe = (p) => p.producao_detalhe?.materialNome || p.material_nome || "";

export default function TrocarFilamentoDialog({ material, onClose, onToast }) {
  const { produtos, materiais, variacoes } = useRankingData();
  const [marcados, setMarcados] = useState(() => new Set());
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState(false);
  const filamentos = useMemo(() => (materiais || []).filter(ehFilamento), [materiais]);
  const nomesFil = useMemo(() => new Set(filamentos.map((m) => m.nome)), [filamentos]);
  const comAlvo = useMemo(() => materiaisComFilamento(materiais, material), [materiais, material]);

  const linhas = useMemo(
    () =>
      (produtos || [])
        .filter((p) => {
          const m = materialDe(p);
          return m !== material.nome && (nomesFil.has(m) || !m);
        })
        .map((p) => {
          const semDetalhe = !p.producao_detalhe;
          const atual = custoProducaoAtual(p, materiais);
          const novo = semDetalhe ? null : custoProducaoAtual(p, comAlvo);
          return { p, de: materialDe(p) || "—", atual, novo, dif: novo == null ? null : novo - atual, semDetalhe };
        })
        .sort((a, b) => a.de.localeCompare(b.de) || (a.dif ?? 0) - (b.dif ?? 0) || a.p.nome.localeCompare(b.p.nome)),
    [produtos, materiais, comAlvo, material.nome, nomesFil]
  );
  const visiveis = busca ? linhas.filter((l) => normalizarTexto(`${l.p.nome} ${l.p.sku || ""}`).includes(normalizarTexto(busca))) : linhas;
  const grupos = [...new Set(linhas.filter((l) => !l.semDetalhe).map((l) => l.de))];
  const alternar = (id) =>
    setMarcados((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const marcarGrupo = (de) => setMarcados((s) => new Set([...s, ...linhas.filter((l) => l.de === de && !l.semDetalhe).map((l) => l.p.id)]));
  const sel = linhas.filter((l) => marcados.has(l.p.id));
  const somaDif = sel.reduce((t, l) => t + (l.dif || 0), 0);

  const salvar = async () => {
    if (!sel.length) return;
    setSalvando(true);
    let ok = 0;
    const erros = [];
    for (const l of sel) {
      const antigo = materialDe(l.p);
      const upd = { material_nome: material.nome, material_id: material.id };
      if (l.p.producao_detalhe) upd.producao_detalhe = { ...l.p.producao_detalhe, materialNome: material.nome };
      let { error } = await supabase.from("produtos_cadastro").update(upd).eq("id", l.p.id);
      if (error && /material_id/i.test(error.message)) {
        delete upd.material_id;
        ({ error } = await supabase.from("produtos_cadastro").update(upd).eq("id", l.p.id));
      }
      if (error) {
        erros.push(l.p.nome);
        continue;
      }
      ok++;
      // Variação com fatiador próprio no MESMO filamento do produto acompanha a troca.
      for (const v of (variacoes || []).filter((x) => x.produto_id === l.p.id && x.producao_detalhe?.materialNome && x.producao_detalhe.materialNome === antigo)) {
        await supabase.from("produto_variacoes").update({ producao_detalhe: { ...v.producao_detalhe, materialNome: material.nome } }).eq("id", v.id);
      }
    }
    setSalvando(false);
    recarregarCatalogo();
    onToast?.(erros.length ? `${ok} trocado(s); não deu em: ${erros.slice(0, 3).join(", ")}` : `${ok} produto(s) agora em ${material.nome} — o preço salvo não mudou, o lucro acompanha o custo novo`);
    if (!erros.length) onClose();
  };

  return (
    <EditarDialog
      titulo={`Usar ${material.nome} em produtos`}
      classe="modal-box-md"
      salvando={salvando}
      onCancelar={onClose}
      onSalvar={salvar}
      salvarLabel={sel.length ? `Trocar ${sel.length} produto${sel.length > 1 ? "s" : ""}` : "Escolha os produtos"}
    >
      <p className="hint" style={{ marginTop: 0 }}>
        O custo de produção passa a usar o preço do {material.nome} ({BRL(material.preco)}/kg). <b>O preço salvo não muda</b> — o lucro de cada venda sobe (ou cai) no mesmo valor do custo. Se o {material.nome} imprime com tempo ou peso diferente, refatie os produtos principais depois (Simular custo).
      </p>
      <div className="toolbar" style={{ flexWrap: "wrap", gap: 6 }}>
        <input type="search" placeholder="Buscar produto ou SKU" value={busca} onChange={(e) => setBusca(e.target.value)} />
        {grupos.map((g) => (
          <button key={g} type="button" className="btn btn-mini" onClick={() => marcarGrupo(g)}>
            marcar todos em {g}
          </button>
        ))}
        {marcados.size > 0 && (
          <button type="button" className="btn btn-mini" onClick={() => setMarcados(new Set())}>
            desmarcar
          </button>
        )}
      </div>
      {!linhas.length ? (
        <div className="empty">Todos os produtos já usam {material.nome}.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Produto</th>
                <th>Hoje em</th>
                <th className="num">Custo/peça hoje</th>
                <th className="num">Em {material.nome}</th>
                <th className="num">Lucro por venda</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l) => (
                <tr key={l.p.id} className={l.semDetalhe ? "linha-apagada" : undefined}>
                  <td>
                    <input type="checkbox" disabled={l.semDetalhe} checked={marcados.has(l.p.id)} onChange={() => alternar(l.p.id)} />
                  </td>
                  <td>
                    {l.p.nome}
                    {l.p.sku && <div className="sub-num">{l.p.sku}</div>}
                  </td>
                  <td>{l.de}</td>
                  <td className="num">{BRL(l.atual)}</td>
                  <td className="num">{l.semDetalhe ? <span className="muted-cel">custo à mão — troque no cadastro</span> : BRL(l.novo)}</td>
                  <td className="num">{l.dif == null ? "—" : <b style={{ color: l.dif > 0.004 ? "var(--bad)" : l.dif < -0.004 ? "var(--good)" : undefined }}>{l.dif < -0.004 ? "+" : l.dif > 0.004 ? "−" : ""}{BRL(Math.abs(l.dif))}</b>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sel.length > 0 && (
        <p className="muted-cel" style={{ marginTop: 8 }}>
          {sel.length} marcado(s): {somaDif <= 0 ? `+${BRL(-somaDif)}` : `−${BRL(somaDif)}`} de lucro somando 1 peça de cada (avulso). Variações e kits que usam esses produtos recalculam sozinhos.
        </p>
      )}
    </EditarDialog>
  );
}
