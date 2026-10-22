import { useState } from "react";
import { useLoja } from "../lib/LojaContext.jsx";
import { useCatalogo } from "../hooks/useCatalogo.js";
import { canalDireto, ordenarCanais } from "../lib/canais.js";
import { cuponsAtivos, textoFaixa } from "../lib/cupomLoja.js";
import CanalTag from "./CanalTag.jsx";

// Configuração → Regras → "Cupons ativos da loja" (22/10/2026): os cupons que já
// estão ligados na plataforma, por canal (ex.: Shopee 2% acima de R$ 5 · 5% acima
// de R$ 20). Grava em lojas.config_escada.cupons (sem SQL). Só informa: a Rampa,
// o Painel do anúncio e o Cupom da loja mostram o lucro com eles; nenhum preço muda.
const num = (v) => Number(String(v ?? "").replace(",", ".")) || 0;
const vazia = { minimo: "", tipo: "pct", valor: "", teto: "" };

export default function CuponsAtivos({ onToast }) {
  const { lojas, lojaId, atualizar } = useLoja();
  const { canaisTodos = [] } = useCatalogo();
  const loja = lojas.find((l) => l.id === lojaId) || null;
  const cfg = loja?.config_escada || {};
  const canais = ordenarCanais(canaisTodos.filter((c) => c.ativo !== false && !canalDireto(c)));
  const [edit, setEdit] = useState(null); // { canalId, faixas: [...] }
  const [salvando, setSalvando] = useState(false);

  const abrir = (canalId) => {
    const fs = cuponsAtivos(cfg, canalId).map((f) => ({ minimo: String(f.minimo).replace(".", ","), tipo: f.tipo, valor: String(f.valor).replace(".", ","), teto: f.teto ? String(f.teto).replace(".", ",") : "" }));
    setEdit({ canalId, faixas: fs.length ? fs : [{ ...vazia }] });
  };
  const setF = (i, k, v) => setEdit((e) => ({ ...e, faixas: e.faixas.map((f, j) => (j === i ? { ...f, [k]: v } : f)) }));
  const salvar = async () => {
    if (!loja || !edit) return;
    const faixas = edit.faixas
      .map((f) => ({ minimo: num(f.minimo), tipo: f.tipo === "valor" ? "valor" : "pct", valor: num(f.valor), ...(f.tipo === "pct" && num(f.teto) > 0 ? { teto: num(f.teto) } : {}) }))
      .filter((f) => f.valor > 0)
      .sort((a, b) => a.minimo - b.minimo);
    const cupons = { ...(cfg.cupons || {}) };
    if (faixas.length) cupons[edit.canalId] = faixas;
    else delete cupons[edit.canalId];
    setSalvando(true);
    const r = await atualizar(loja.id, { configEscada: { ...cfg, cupons } });
    setSalvando(false);
    onToast?.(r.ok ? (faixas.length ? "Cupons do canal salvos" : "Cupons do canal tirados") : `Não foi possível salvar: ${r.error}`);
    if (r.ok) setEdit(null);
  };

  if (!canais.length) return <p className="muted-cel">Cadastre um canal em Configuração → Canais.</p>;
  return (
    <div>
      <p className="muted-cel" style={{ marginTop: 0 }}>
        Os cupons que você já deixou ligados na plataforma. Vale a maior faixa que o pedido alcança. O app mostra o lucro com eles na Rampa (O que digitar), no Painel do anúncio e em Promoções → Cupom da loja — e avisa no Início se algum anúncio fica no prejuízo. Nenhum preço muda.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Canal</th>
              <th>Cupons ativos</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {canais.map((c) => {
              const fs = cuponsAtivos(cfg, c.id);
              const aberto = edit?.canalId === c.id;
              return (
                <tr key={c.id}>
                  <td><CanalTag canal={c} /></td>
                  <td>
                    {aberto ? (
                      <div className="cupons-edit">
                        {edit.faixas.map((f, i) => (
                          <div key={i} className="cupons-faixa">
                            <select value={f.tipo} onChange={(e) => setF(i, "tipo", e.target.value)}>
                              <option value="pct">%</option>
                              <option value="valor">R$</option>
                            </select>
                            <input type="text" inputMode="decimal" placeholder={f.tipo === "pct" ? "2" : "5,00"} value={f.valor} onChange={(e) => setF(i, "valor", e.target.value)} style={{ width: 70 }} />
                            <span className="muted-cel">acima de R$</span>
                            <input type="text" inputMode="decimal" placeholder="0" value={f.minimo} onChange={(e) => setF(i, "minimo", e.target.value)} style={{ width: 80 }} />
                            {f.tipo === "pct" && (
                              <>
                                <span className="muted-cel">máx. R$</span>
                                <input type="text" inputMode="decimal" placeholder="sem teto" value={f.teto} onChange={(e) => setF(i, "teto", e.target.value)} style={{ width: 80 }} />
                              </>
                            )}
                            <button type="button" className="btn btn-mini" title="Tirar esta faixa" onClick={() => setEdit((e) => ({ ...e, faixas: e.faixas.filter((_, j) => j !== i) }))}>×</button>
                          </div>
                        ))}
                        <div className="cupons-faixa">
                          <button type="button" className="btn btn-mini" onClick={() => setEdit((e) => ({ ...e, faixas: [...e.faixas, { ...vazia }] }))}>+ faixa</button>
                          <button type="button" className="btn btn-mini primary" disabled={salvando} onClick={salvar}>{salvando ? "Salvando…" : "Salvar"}</button>
                          <button type="button" className="btn btn-mini" onClick={() => setEdit(null)}>Cancelar</button>
                        </div>
                      </div>
                    ) : fs.length ? (
                      fs.map(textoFaixa).join(" · ")
                    ) : (
                      <span className="muted-cel">nenhum</span>
                    )}
                  </td>
                  <td className="num">
                    {!aberto && (
                      <button type="button" className="btn btn-mini" onClick={() => abrir(c.id)}>
                        {fs.length ? "✎ Editar" : "+ Cupom"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
