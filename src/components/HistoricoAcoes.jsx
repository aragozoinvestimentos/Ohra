import { useMemo, useState } from "react";
import { useLoja } from "../lib/LojaContext.jsx";
import { useAcoesComerciais } from "../hooks/useAcoesComerciais.js";
import { CONCLUSOES, TIPOS_ACAO, acoesPerto, antesDepois, listarAcoes } from "../lib/acoesComerciais.js";
import { concluirAcao, excluirAcao, registrarAcao } from "../lib/acoesComerciaisAcoes.js";
import { vendasDoAnuncio } from "../lib/anuncios.js";
import { BRL } from "../lib/format.js";
import Estado from "./Estado.jsx";
import Ajuda from "./Ajuda.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";

// Painel do anúncio → Ações: o que foi feito neste anúncio (pelo app e à mão)
// e o antes × depois de cada ação (lib/acoesComerciais.js). Schema v64.
const dm = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : "");
const diasEntre = (de, ate) => Math.round((new Date(`${ate}T12:00:00`) - new Date(`${de}T12:00:00`)) / 864e5) + 1;

export default function HistoricoAcoes({ l, hoje, pedidos, cres, onToast }) {
  const { lojaId } = useLoja();
  const acoesH = useAcoesComerciais();
  const itemTipo = l.tipo;
  const itemId = l.itemId.slice(2);
  const alvo = { itemTipo, itemId, canalId: l.canal.id };
  const rampasH = cres?.rampasH || {};
  const acoes = useMemo(
    () =>
      listarAcoes({
        alvo,
        periodos: cres?.adsH?.periodos || [],
        rampas: [...(rampasH.rampas || []), ...(rampasH.rampasGrupo || []), ...(rampasH.rampasKit || [])],
        registros: rampasH.registros || [],
        precos: cres?.dados?.precos || [],
        manuais: acoesH.acoes,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cres, acoesH.acoes, itemTipo, itemId, l.canal.id]
  );
  const filtro = l.tipo === "grupo" ? { canalId: l.canal.id, grupoId: itemId } : { itemId: l.itemId, canalId: l.canal.id, produtoId: l.tipo === "produto" ? itemId : null };
  const vendasEm = (de, ate) => vendasDoAnuncio(pedidos, filtro, hoje, diasEntre(de, ate), ate);
  const periodosAds = l.ads?.periodos || [];

  const [form, setForm] = useState(null);
  const [excluir, setExcluir] = useState(null);
  async function salvar() {
    const r = await registrarAcao({ lojaId, itemTipo, itemId, canalId: l.canal.id, tipo: form.tipo, data: form.data, antes: form.antes, depois: form.depois, observacao: form.obs });
    if (r.error) return onToast?.(r.error.message);
    setForm(null);
    onToast?.("Ação registrada — o antes × depois aparece depois de 7 dias");
  }
  async function concluir(a, c) {
    const r = await concluirAcao({ lojaId, acao: a, conclusao: a.conclusao === c ? null : c });
    if (r.error) onToast?.(r.error.message);
  }

  return (
    <div className="panel">
      <h3>
        Ações e resultado{" "}
        <Ajuda texto="Tudo que foi feito neste anúncio: o que o app já registra sozinho (ligar/ajustar/pausar Ads, subir/descer degrau, preço salvo) e o que você registra à mão (foto, título, descrição, promoção, cupom… mudados direto no marketplace). Antes × depois = 7 dias antes × 7 dias depois do dia da ação (o próprio dia fica fora); com poucas vendas, 14 dias. É associação no tempo, não prova: campanha, data, concorrente e estoque também mudam. Quem conclui é você." />
        <button type="button" className="btn btn-mini" style={{ marginLeft: "auto" }} onClick={() => (acoesH.disponivel ? setForm({ tipo: "imagem", data: hoje, antes: "", depois: "", obs: "" }) : onToast?.("Rode o supabase/schema_v64.sql no Supabase pra registrar ações"))}>
          + Registrar ação
        </button>
      </h3>
      <div className="pa-corpo">
        {!acoesH.disponivel && <div className="alerta alerta-warn">Falta rodar o supabase/schema_v64.sql — sem ele dá pra ver as ações do app, mas não registrar ações à mão nem a conclusão.</div>}
        {form && (
          <div className="acao-form">
            <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
              {TIPOS_ACAO.map((t) => (
                <option key={t.k} value={t.k}>
                  {t.rot}
                </option>
              ))}
            </select>
            <input type="date" value={form.data} max={hoje} onChange={(e) => setForm({ ...form, data: e.target.value })} />
            <input type="text" placeholder="antes (opcional, ex.: R$ 10/dia)" value={form.antes} onChange={(e) => setForm({ ...form, antes: e.target.value })} />
            <input type="text" placeholder="depois (opcional)" value={form.depois} onChange={(e) => setForm({ ...form, depois: e.target.value })} />
            <input type="text" placeholder="observação" value={form.obs} onChange={(e) => setForm({ ...form, obs: e.target.value })} style={{ flex: 2 }} />
            <button type="button" className="btn btn-mini primary" onClick={salvar}>
              Salvar
            </button>
            <button type="button" className="btn btn-mini" onClick={() => setForm(null)}>
              Cancelar
            </button>
          </div>
        )}
        {!acoes.length ? (
          <span className="muted-cel">Nenhuma ação registrada neste anúncio ainda.</span>
        ) : (
          acoes.map((a) => {
            const r = antesDepois({ data: a.data, hoje, vendasEm, periodosAds });
            const perto = acoesPerto(a, acoes);
            const c = CONCLUSOES.find((x) => x.k === a.conclusao);
            return (
              <div key={a.chave} className="acao-item">
                <div className="acao-cab">
                  <b>{dm(a.data)}</b> {a.rotulo}
                  {(a.antes || a.depois) && (
                    <span className="muted-cel">
                      {" "}
                      · {a.antes || "—"} → {a.depois || "—"}
                    </span>
                  )}
                  <span className="chip-fonte">{a.origem === "app" ? "pelo app" : "à mão"}</span>
                  {c && <Estado tipo={c.tipo}>{c.rot}</Estado>}
                  {a.origem === "manual" && (
                    <button type="button" className="del" title="Excluir esta ação" onClick={() => setExcluir(a)}>
                      ×
                    </button>
                  )}
                </div>
                {a.obs && <div className="muted-cel">{a.obs}</div>}
                {r.antes && (
                  <table className="acao-tabela">
                    <thead>
                      <tr>
                        <th />
                        <th className="num">Vendas</th>
                        <th className="num">Faturamento</th>
                        <th className="num">Lucro</th>
                        <th className="num">Ads</th>
                        <th className="num">Depois do Ads</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["Antes", r.antes],
                        ["Depois", r.depois],
                      ].map(([rot, x]) => (
                        <tr key={rot}>
                          <td>
                            {rot} <span className="muted-cel">{dm(x.de)}–{dm(x.ate)}</span>
                          </td>
                          <td className="num">{x.unidades}</td>
                          <td className="num">{BRL(x.faturamento)}</td>
                          <td className="num">{BRL(x.lucro)}</td>
                          <td className="num">{x.ads ? BRL(x.ads) : "—"}</td>
                          <td className={`num${x.depoisAds < 0 ? " neg" : ""}`}>{BRL(x.depoisAds)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div className="hint" style={{ margin: "2px 0" }}>
                  {r.leitura}
                  {perto.length > 0 && ` Atenção: ${perto.length > 1 ? `${perto.length} outras ações` : "outra ação"} neste anúncio a menos de 7 dias (${perto.map((x) => `${dm(x.data)} ${x.rotulo.charAt(0).toLowerCase()}${x.rotulo.slice(1)}`).join("; ")}) — não dá pra separar o efeito de cada uma.`}
                </div>
                {acoesH.disponivel && (
                  <div className="acao-concluir">
                    <span className="muted-cel">Sua conclusão:</span>
                    {CONCLUSOES.map((x) => (
                      <button key={x.k} type="button" className={`chip-filtro-area${a.conclusao === x.k ? " ativo" : ""}`} onClick={() => concluir(a, x.k)}>
                        {x.rot}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      {excluir && (
        <ConfirmDialog
          titulo="Excluir ação"
          mensagem={`Excluir “${excluir.rotulo}” de ${dm(excluir.data)}?`}
          confirmarLabel="Excluir"
          perigo
          onCancel={() => setExcluir(null)}
          onConfirm={async () => {
            const a = excluir;
            setExcluir(null);
            const r = await excluirAcao(a.id);
            if (r.error) onToast?.(r.error.message);
          }}
        />
      )}
    </div>
  );
}
