import { useEffect, useMemo, useState } from "react";
import Portal from "./Portal.jsx";
import { BRL, DATA } from "../lib/format.js";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useRankingData } from "../hooks/useRankingData.js";
import { hojeISO } from "../lib/fluxoCaixa.js";
import { COMPRAS_NA_MEDIA, dividirParcelas, excluirCompra, linhasParceladas, precoMedio, recalcularPrecoMaterial } from "../lib/comprasMaterial.js";

const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};

// "Registrar compra de material" — o MESMO formulário aberto em Cadastros →
// Materiais (+ Compra) e no Fluxo de Caixa (Compra de material / aviso de
// saída sem dados da compra). Salvar:
//  1) grava a compra em compras_material;
//  2) cria a saída no caixa (à vista ou N parcelas mensais) — ou, no modo
//     "completar" (`lancamento`), só liga a saída que já existia à compra;
//  3) recalcula o preço do material = média ponderada das 3 últimas compras
//     que contam → todos os produtos atualizam ao vivo.
export default function CompraMaterialDialog({ materialIdInicial, lancamento, grupo, inicial, onClose, onToast }) {
  const { lojaId } = useLoja();
  const { materiais } = useRankingData();
  const hoje = hojeISO();
  const completar = !!lancamento;
  const valorLancamento = completar ? (grupo?.length ? grupo : [lancamento]).reduce((s, l) => s + num(l.valor), 0) : 0;
  const [f, setF] = useState(() => ({
    materialId: materialIdInicial || "",
    quantidade: "",
    valor: completar ? String(Math.round(valorLancamento * 100) / 100) : inicial?.valor || "",
    data: completar ? lancamento.data_realizada || lancamento.data_prevista : inicial?.data || hoje,
    contar: true,
    parcelado: false,
    parcelas: 2,
    data1: completar ? lancamento.data_prevista : inicial?.data || hoje,
    pago: inicial?.pago ?? true,
    observacao: inicial?.observacao || "",
  }));
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const [compras, setCompras] = useState([]);
  const [semTabela, setSemTabela] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [apagando, setApagando] = useState(null);

  const material = materiais.find((m) => m.id === f.materialId) || null;
  const unidade = material ? ((material.tipo || "filamento") === "filamento" ? "kg" : material.unidade || "un") : "kg";

  useEffect(() => {
    if (!supabase || !f.materialId) return;
    let ativo = true;
    async function carregar() {
      const { data, error } = await supabase.from("compras_material").select("*").eq("material_id", f.materialId);
      if (!ativo) return;
      if (error) setSemTabela(true);
      else setCompras((data || []).sort((a, b) => String(b.data).localeCompare(String(a.data)) || String(b.criado_em || "").localeCompare(String(a.criado_em || ""))));
    }
    carregar();
    return () => {
      ativo = false;
    };
  }, [f.materialId, salvando, apagando]);

  const qtd = num(f.quantidade);
  const valor = num(f.valor);
  const precoCompra = qtd > 0 && valor > 0 ? valor / qtd : null;
  const mediaAntes = useMemo(() => precoMedio(compras), [compras]);
  const mediaDepois = useMemo(
    () => (precoCompra != null && f.contar ? precoMedio([...compras, { data: f.data, quantidade: qtd, valor_total: valor, contar_media: true, criado_em: "~" }]) : mediaAntes),
    [compras, precoCompra, f.contar, f.data, qtd, valor, mediaAntes]
  );
  const nParc = Math.max(2, Math.min(36, Math.round(num(f.parcelas)) || 2));
  const valoresParc = f.parcelado && valor > 0 ? dividirParcelas(valor, nParc) : null;

  async function salvar() {
    if (!material) return onToast?.("Escolha o material");
    if (!(qtd > 0)) return onToast?.(`Informe a quantidade (${unidade})`);
    if (!(valor > 0)) return onToast?.("Informe o valor pago");
    if (!f.data) return onToast?.("Informe a data da compra");
    setSalvando(true);
    const parcelas = completar ? grupo?.length || 1 : f.parcelado ? nParc : 1;
    const { data: compra, error } = await supabase
      .from("compras_material")
      .insert({
        loja_id: lojaId || null,
        material_id: material.id,
        data: f.data,
        quantidade: qtd,
        valor_total: Math.round(valor * 100) / 100,
        contar_media: f.contar,
        parcelas,
        observacao: f.observacao.trim() || null,
      })
      .select()
      .single();
    if (error) {
      setSalvando(false);
      return onToast?.(
        /compras_material/.test(error.message) ? "Falta rodar o supabase/schema_v32.sql no Supabase pra registrar compras." : `Não foi possível salvar: ${error.message}`
      );
    }
    let erroCaixa = null;
    if (completar) {
      const ids = (grupo?.length ? grupo : [lancamento]).map((l) => l.id);
      const r = await supabase.from("lancamentos_caixa").update({ compra_material_id: compra.id }).in("id", ids);
      erroCaixa = r.error;
    } else {
      const qtdTxt = `${qtd.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${unidade}`;
      const linhas = linhasParceladas(
        {
          loja_id: lojaId || null,
          tipo: "saida",
          descricao: `Compra ${material.nome} · ${qtdTxt}`,
          categoria: "filamento",
          canal_id: null,
          observacao: f.observacao.trim() || null,
          compra_material_id: compra.id,
        },
        { valorTotal: valor, parcelas, data1: f.parcelado ? f.data1 || f.data : f.data, primeiraRealizada: f.pago, hoje }
      );
      const r = await supabase.from("lancamentos_caixa").insert(linhas);
      erroCaixa = r.error;
    }
    const rec = await recalcularPrecoMaterial(supabase, material.id);
    setSalvando(false);
    if (erroCaixa) onToast?.(`Compra registrada, mas a saída no caixa falhou: ${erroCaixa.message}`);
    else if (rec.media) onToast?.(`Compra registrada · ${material.nome} agora ${BRL(rec.media.preco)}/${unidade} (média de ${rec.media.compras} compra${rec.media.compras > 1 ? "s" : ""})`);
    else onToast?.("Compra registrada (não conta na média — preço do material ficou como estava)");
    onClose?.(true);
  }

  async function apagar(c) {
    const r = await excluirCompra(supabase, c);
    setApagando(null);
    if (r.error) onToast?.(`Não foi possível excluir: ${r.error.message}`);
    else onToast?.(r.media ? `Compra excluída · média agora ${BRL(r.media.preco)}/${unidade}` : "Compra excluída");
  }

  const filamentos = materiais.filter((m) => (m.tipo || "filamento") === "filamento");
  const consumiveis = materiais.filter((m) => m.tipo === "consumivel");

  return (
    <Portal>
      <div className="modal-overlay" onClick={() => onClose?.(false)}>
        <div className="modal-box modal-box-larga modal-box-md" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
          <h3>{completar ? "Completar compra de material" : "Registrar compra de material"}</h3>
          {completar && (
            <p className="hint" style={{ marginTop: 0 }}>
              Saída “{lancamento.descricao}”{grupo?.length > 1 ? ` (${grupo.length} parcelas)` : ""} — {BRL(valorLancamento)}. Informe o material e a quantidade pra
              ela entrar na média de preço. Nenhuma saída nova é criada.
            </p>
          )}
          {semTabela && <div className="alerta alerta-warn"><b>Falta rodar o schema v32</b>Rode o supabase/schema_v32.sql no SQL Editor do Supabase pra registrar compras.</div>}
          <div className="field">
            <label>Material (por tipo — ex.: PLA comum, PLA Silk, PETG)</label>
            <select value={f.materialId} onChange={set("materialId")} autoFocus>
              <option value="">— escolha —</option>
              {filamentos.length > 0 && (
                <optgroup label="Filamentos">
                  {filamentos.map((m) => (
                    <option key={m.id} value={m.id}>{m.nome}</option>
                  ))}
                </optgroup>
              )}
              {consumiveis.length > 0 && (
                <optgroup label="Consumíveis">
                  {consumiveis.map((m) => (
                    <option key={m.id} value={m.id}>{m.nome}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          <div className="row3">
            <div className="field">
              <label>Quantidade ({unidade})</label>
              <input type="number" step="0.001" min="0" value={f.quantidade} placeholder={unidade === "kg" ? "ex: 3 (3 rolos de 1 kg)" : ""} onChange={set("quantidade")} />
            </div>
            <div className="field">
              <label title="O que saiu do bolso: já com frete e desconto">Valor pago (R$, com frete/desconto)</label>
              <input type="number" step="0.01" min="0" value={f.valor} onChange={set("valor")} />
            </div>
            <div className="field">
              <label>Data da compra</label>
              <input type="date" value={f.data} onChange={set("data")} />
            </div>
          </div>

          <div className="aviso-fluxo">
            {precoCompra != null ? (
              <>
                Esta compra: <b>{BRL(precoCompra)}/{unidade}</b>
                {material && (
                  <>
                    {" "}· preço do material: <b>{BRL(material.preco)}</b>
                    {f.contar && mediaDepois ? (
                      <>
                        {" "}→ <b>{BRL(mediaDepois.preco)}</b> {mediaDepois.compras > 1 ? `(média das ${mediaDepois.compras} últimas compras)` : "(1ª compra registrada)"}
                      </>
                    ) : (
                      " (não muda — fora da média)"
                    )}
                  </>
                )}
              </>
            ) : (
              <>O preço do material vira a média (pela quantidade) das {COMPRAS_NA_MEDIA} últimas compras que contam — todos os produtos atualizam sozinhos.</>
            )}
          </div>

          <label className="check-linha">
            <input type="checkbox" checked={!f.contar} onChange={(e) => setF((p) => ({ ...p, contar: !e.target.checked }))} />
            Não contar na média (compra de teste/pontual)
          </label>

          {!completar && (
            <>
              <div className="subabas subabas-compacta" style={{ margin: "8px 0" }}>
                <button type="button" className={`btn${!f.parcelado ? " primary" : ""}`} onClick={() => setF((p) => ({ ...p, parcelado: false }))}>
                  À vista
                </button>
                <button type="button" className={`btn${f.parcelado ? " primary" : ""}`} onClick={() => setF((p) => ({ ...p, parcelado: true, data1: p.data1 || p.data }))}>
                  Parcelado
                </button>
              </div>
              {f.parcelado && (
                <div className="row2">
                  <div className="field">
                    <label>Nº de parcelas</label>
                    <input type="number" min="2" max="36" step="1" value={f.parcelas} onChange={set("parcelas")} />
                  </div>
                  <div className="field">
                    <label>Data da 1ª parcela</label>
                    <input type="date" value={f.data1} onChange={set("data1")} />
                  </div>
                </div>
              )}
              {valoresParc && (
                <p className="hint" style={{ marginTop: 0 }}>
                  {nParc}× de {BRL(valoresParc[valoresParc.length - 1])}
                  {valoresParc[0] !== valoresParc[valoresParc.length - 1] ? ` (1ª ${BRL(valoresParc[0])})` : ""} — uma saída prevista por mês no Fluxo de Caixa.
                </p>
              )}
              <label className="check-linha">
                <input type="checkbox" checked={f.pago} onChange={set("pago")} />
                {f.parcelado ? "1ª parcela já paga" : "Já pago"}
              </label>
            </>
          )}
          <div className="field">
            <label>Observação (opcional)</label>
            <input type="text" value={f.observacao} placeholder="ex: loja, cor, promoção" onChange={set("observacao")} />
          </div>

          {material && compras.length > 0 && (
            <>
              <h3 style={{ marginTop: 6 }}>Últimas compras de {material.nome}</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th className="num">Qtd</th>
                      <th className="num">Pago</th>
                      <th className="num">R$/{unidade}</th>
                      <th>Média</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {compras.slice(0, 8).map((c) => {
                      const naMedia = mediaAntes && c.contar_media !== false && compras.filter((x) => x.contar_media !== false).slice(0, COMPRAS_NA_MEDIA).includes(c);
                      return (
                        <tr key={c.id}>
                          <td>{DATA(`${c.data}T12:00:00`)}</td>
                          <td className="num">{num(c.quantidade).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}</td>
                          <td className="num">{BRL(c.valor_total)}</td>
                          <td className="num">{BRL(num(c.valor_total) / num(c.quantidade))}</td>
                          <td className="muted-cel">{c.contar_media === false ? "não conta" : naMedia ? "✓ na média" : "antiga"}</td>
                          <td className="num" style={{ whiteSpace: "nowrap" }}>
                            {apagando === c.id ? (
                              <>
                                <button className="btn btn-mini" onClick={() => apagar(c)} title="Exclui a compra e as parcelas ainda não pagas">Excluir</button>{" "}
                                <button className="btn btn-mini" onClick={() => setApagando(null)}>✕</button>
                              </>
                            ) : (
                              <button className="del" title="Excluir compra" onClick={() => setApagando(c.id)}>×</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="modal-actions">
            <button className="btn" onClick={() => onClose?.(false)} disabled={salvando}>Cancelar</button>
            <button className="btn primary" onClick={salvar} disabled={salvando || semTabela}>
              {salvando ? "Salvando…" : completar ? "Salvar compra" : "Registrar compra"}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
