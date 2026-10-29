import GraficoOrigem from "./GraficoOrigem.jsx";
import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { BRL } from "../lib/format.js";
import { gruposDoSeletor, itemTipoDoId } from "../lib/variacoes.js";
import {
  DIAS_SEM_DIVULGAR,
  STATUS_PARCEIRO,
  comissaoMaxima,
  custoAmostra,
  idPrefixado,
  resumoParceiro,
  statusEfetivo,
  sugestoesAfiliado,
  periodosDeAdsDaLoja,
  vendasPorOrigemReais,
} from "../lib/afiliados.js";
import Ajuda from "./Ajuda.jsx";
import CanalTag from "./CanalTag.jsx";
import { estadoSugestaoAfiliado } from "../lib/estados.js";
import TopbarAcoes from "./TopbarAcoes.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import EditarDialog from "./EditarDialog.jsx";
import BuscaItem from "./BuscaItem.jsx";
import ComissaoLoja from "./ComissaoLoja.jsx";

const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};
const pct = (f) => `${Math.round(num(f) * 100)}%`;
const dataBR = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
const msgV35 = (e) => (/afiliado|schema cache|does not exist/.test(e?.message || "") ? "Falta rodar o supabase/schema_v35.sql no Supabase" : `Não foi possível salvar: ${e?.message}`);

export default function Afiliados({ dados, af, regras, linhasAf, mapaAf, hoje, onToast, pedidos, linhasAds }) {
  const { lojaId } = useLoja();
  const { itens, canais } = dados;
  const { config, parceiros, registros, disponivel } = af;
  const [parceiroForm, setParceiroForm] = useState(null); // { parceiro } | { inicial }
  const [excluir, setExcluir] = useState(null);

  // Comissão da LOJA (29/10/2026): as sugestões de item (ativar/usar/subir/descer) saíram — ficam
  // só as dos parceiros (amostra, marcar divulgou).
  const sugestoes = useMemo(
    () => sugestoesAfiliado({ linhas: linhasAf, parceiros, afRegistros: registros, regras, itens, hoje }).filter((sg) => /^(divulgou|amostra)\|/.test(sg.chave)),
    [linhasAf, parceiros, registros, regras, itens, hoje]
  );
  const origem = useMemo(
    () => vendasPorOrigemReais({ pedidos, periodos: periodosDeAdsDaLoja(linhasAds), afRegistros: registros, hoje }),
    [registros, pedidos, linhasAds, hoje]
  );

  async function mudarStatus(p, status) {
    const campos = { status, status_desde: hoje };
    if (status === "amostra" && !p.amostra_data) campos.amostra_data = hoje;
    const { error } = await supabase.from("afiliados").update(campos).eq("id", p.id);
    if (error) return onToast?.(msgV35(error));
    onToast?.(`${p.nome}: ${STATUS_PARCEIRO.find((s) => s.chave === status)?.rotulo}`);
  }

  async function excluirParceiro() {
    const p = excluir;
    setExcluir(null);
    const { error } = await supabase.from("afiliados").delete().eq("id", p.id);
    if (error) return onToast?.(`Não foi possível excluir: ${error.message}`);
    onToast?.(`${p.nome} excluído (as vendas registradas ficam, sem parceiro)`);
  }

  async function acaoSugestao(a) {
    if (a.tipo === "divulgou") return mudarStatus(a.parceiro, "divulgou");
    if (a.tipo === "amostra")
      return setParceiroForm({
        inicial: { canal_id: a.linha.canal.id, amostra_item: idPrefixado(a.linha.tipo, a.linha.id), comissao: a.linha.conf.comissao ?? a.linha.conf.padrao ?? null },
      });
  }

  if (!supabase)
    return (
      <div className="panel">
        <div className="empty">Configure o Supabase pra usar Afiliados.</div>
      </div>
    );
  if (!disponivel)
    return (
      <div className="panel">
        <h3>Afiliados</h3>
        <div className="empty">
          Falta criar as tabelas de afiliados no banco — rode o <strong>supabase/schema_v35.sql</strong> no SQL Editor do Supabase e recarregue a página.
        </div>
      </div>
    );

  // custo por venda (últimas semanas do gráfico)
  const tot = origem.reduce((a, w) => ({ af: a.af + w.afiliado, com: a.com + w.comissao, ads: a.ads + w.ads, gasto: a.gasto + w.adsGasto }), { af: 0, com: 0, ads: 0, gasto: 0 });

  return (
    <div className="af-pagina">
      <TopbarAcoes aba="crescimento">
        <button type="button" className="btn" onClick={() => setParceiroForm({ inicial: {} })}>
          + Parceiro
        </button>
      </TopbarAcoes>

      <ComissaoLoja dados={dados} linhasAf={linhasAf} config={config} pedidos={pedidos} registros={registros} mapaAf={mapaAf} lojaId={lojaId} hoje={hoje} onToast={onToast} />

      <div className="panel">
        <h3 className="section-title">
          <span>
            Parceiros
            <Ajuda texto={`Campanhas exclusivas e amostras. Status: convidado → amostra enviada → divulgou → ativo → parado. Amostra enviada há mais de ${DIAS_SEM_DIVULGAR} dias sem post aparece como parado. Custo da amostra = custo de produção + embalagem das peças (ao vivo) + o frete que você informar. Retorno = lucro gerado pelas vendas dele (já sem comissão) ÷ custo da amostra.`} />
          </span>
          <button type="button" className="btn btn-mini" onClick={() => setParceiroForm({ inicial: {} })}>
            + Parceiro
          </button>
        </h3>
        {!parceiros.length ? (
          <div className="empty">Nenhum parceiro ainda. Quando tiver um item com boas avaliações, a sugestão “mandar amostra” aparece aqui embaixo.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Parceiro</th>
                  <th>Status</th>
                  <th>Amostra</th>
                  <th className="num">Custo amostra</th>
                  <th className="num">Comissão</th>
                  <th className="num">Vendas</th>
                  <th className="num">Comissão paga</th>
                  <th className="num">Retorno da amostra</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {parceiros.map((p) => {
                  const r = resumoParceiro(p, { registros, mapaLinhas: mapaAf, itens });
                  const st = statusEfetivo(p, hoje, registros);
                  const canal = canais.find((c) => c.id === p.canal_id);
                  const amostraItem = r.amostra?.item;
                  // comissão do parceiro acima da máxima do item da amostra?
                  const linhaAm = p.amostra_item_id && canal ? mapaAf.get(`${p.amostra_item_tipo}|${p.amostra_item_id}|${canal.id}`) : null;
                  const acima = linhaAm && !linhaAm.emRampa && p.comissao != null && num(p.comissao) > linhaAm.max + 1e-9;
                  return (
                    <tr key={p.id}>
                      <td>
                        <b>{p.nome}</b>
                        <div className="sub-linha">
                          {[p.nicho, p.rede].filter(Boolean).join(" · ")}
                          {canal && (
                            <>
                              {p.nicho || p.rede ? " · " : ""}
                              <CanalTag canal={canal} />
                            </>
                          )}
                        </div>
                      </td>
                      <td>
                        <select className="select-status" value={p.status} onChange={(e) => mudarStatus(p, e.target.value)}>
                          {STATUS_PARCEIRO.map((s) => (
                            <option key={s.chave} value={s.chave}>
                              {s.rotulo}
                            </option>
                          ))}
                        </select>
                        {st.auto && <div className="sub-num neg">parado · {st.dias} dias sem divulgar</div>}
                        {st.vendeu > 0 && <div className="sub-num pos">já vendeu {st.vendeu} — marque “divulgou”</div>}
                      </td>
                      <td>
                        {amostraItem ? (
                          <>
                            {amostraItem.nome}
                            {num(p.amostra_qtd) > 1 ? ` × ${p.amostra_qtd}` : ""}
                            <div className="sub-linha">
                              {p.amostra_data ? `enviada ${dataBR(p.amostra_data)}` : "a enviar"}
                              {p.status === "amostra" && st.dias != null && !st.auto ? ` · ${st.dias} dia${st.dias === 1 ? "" : "s"}` : ""}
                            </div>
                          </>
                        ) : (
                          <span className="muted-cel">—</span>
                        )}
                      </td>
                      <td className="num">
                        {r.amostra ? (
                          <>
                            {BRL(r.amostra.total)}
                            <div className="sub-num">
                              peças {BRL(r.amostra.pecas)}
                              {r.amostra.frete ? ` + frete ${BRL(r.amostra.frete)}` : ""}
                            </div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={`num${acima ? " neg" : ""}`}>
                        {p.comissao != null ? pct(p.comissao) : "—"}
                        {acima && <div className="sub-num">máx. {pct(linhaAm.max)}</div>}
                      </td>
                      <td className="num">{r.vendas || (p.status === "convidado" ? "—" : 0)}</td>
                      <td className="num">{r.comissao ? BRL(r.comissao) : "—"}</td>
                      <td className="num">
                        {r.retorno != null ? (
                          <>
                            <b className={r.retorno >= 1 ? "pos" : "neg"}>{r.retorno.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}×</b>
                            <div className="sub-num">lucro {BRL(r.lucro)}</div>
                          </>
                        ) : r.vendas ? (
                          <span className="sub-num">lucro {BRL(r.lucro)}</span>
                        ) : p.status === "amostra" || p.status === "divulgou" ? (
                          <span className="muted-cel">aguardando vendas</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="num">
                        <div className="acoes-linha">
                          <button type="button" className="link-btn" onClick={() => setParceiroForm({ parceiro: p })} title="Editar">
                            ✎
                          </button>
                          <button type="button" className="link-btn" onClick={() => setExcluir(p)} title="Excluir">
                            ×
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h3 className="section-title">
          <span>Vendas por origem</span>
          <span className="h3-contagem">todas as rampas e itens com afiliado, por semana</span>
        </h3>
        <GraficoOrigem semanas={origem} />
        <div className="cmp-custo">
          <div>
            <small>Custo por venda via afiliado</small>
            <b>{tot.af ? BRL(tot.com / tot.af) : "—"}</b>
            <span className="muted-cel"> · só paga se vender</span>
          </div>
          <div>
            <small>Custo por venda via Ads</small>
            <b>{tot.ads ? BRL(tot.gasto / tot.ads) : "—"}</b>
            <span className="muted-cel"> · paga pelo clique</span>
          </div>
        </div>
      </div>

      <div className="panel">
        <h3 className="section-title">
          <span>Sugestões</span>
          <span className="h3-contagem">{sugestoes.length || "nenhuma agora"}</span>
        </h3>
        {!sugestoes.length ? (
          <div className="empty">Nada com os parceiros agora.</div>
        ) : (
          <ul className="sug-af">
            {sugestoes.map((sg) => (
              <li key={sg.chave}>
                <span className={`sug-af-ic st-${estadoSugestaoAfiliado(sg)}`}>{sg.icone}</span>
                <div>
                  <b>{sg.titulo}</b>
                  <div className="sub-linha">{sg.texto}</div>
                </div>
                {sg.acao && (
                  <button type="button" className="btn btn-mini" onClick={() => acaoSugestao(sg.acao)}>
                    {sg.acao.rotulo}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {parceiroForm && (
        <ParceiroDialog
          parceiro={parceiroForm.parceiro || null}
          inicial={parceiroForm.inicial || {}}
          itens={itens}
          canais={canais}
          mapaAf={mapaAf}
          hoje={hoje}
          lojaId={lojaId}
          onToast={onToast}
          onClose={() => setParceiroForm(null)}
        />
      )}
      {excluir && (
        <ConfirmDialog
          titulo="Excluir parceiro"
          mensagem={`Excluir ${excluir.nome}? As vendas já registradas continuam, só sem o parceiro.`}
          confirmarLabel="Excluir"
          perigo
          onConfirm={excluirParceiro}
          onCancel={() => setExcluir(null)}
        />
      )}
    </div>
  );
}

function ParceiroDialog({ parceiro, inicial, itens, canais, mapaAf, hoje, lojaId, onToast, onClose }) {
  const base = parceiro || {};
  const [f, setF] = useState(() => ({
    nome: base.nome || "",
    rede: base.rede || "",
    nicho: base.nicho || "",
    canal_id: base.canal_id || inicial.canal_id || canais[0]?.id || "",
    comissao: base.comissao != null ? String(Math.round(num(base.comissao) * 1000) / 10).replace(".", ",") : inicial.comissao != null ? String(Math.round(inicial.comissao * 100)) : "",
    status: base.status || (inicial.amostra_item ? "amostra" : "convidado"),
    amostra_item: base.amostra_item_id ? idPrefixado(base.amostra_item_tipo, base.amostra_item_id) : inicial.amostra_item || "",
    amostra_qtd: String(base.amostra_qtd || 1),
    amostra_data: base.amostra_data || (inicial.amostra_item ? hoje : ""),
    amostra_frete: base.amostra_frete != null ? String(base.amostra_frete).replace(".", ",") : "",
    observacao: base.observacao || "",
  }));
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const grupos = useMemo(() => gruposDoSeletor(itens), [itens]);
  const tipo = f.amostra_item ? itemTipoDoId(f.amostra_item) : null;
  const ca = f.amostra_item ? custoAmostra({ amostra_item_tipo: tipo, amostra_item_id: f.amostra_item.slice(2), amostra_qtd: num(f.amostra_qtd) || 1, amostra_frete: num(f.amostra_frete) }, itens) : null;
  const linhaAm = f.amostra_item && f.canal_id ? mapaAf.get(`${tipo}|${f.amostra_item.slice(2)}|${f.canal_id}`) : null;
  const maxAm = linhaAm && !linhaAm.emRampa ? comissaoMaxima(linhaAm.preco, linhaAm.lucro, linhaAm.cfg) : null;

  async function salvar() {
    if (!f.nome.trim()) return onToast?.("Informe o nome ou @ do parceiro");
    if (f.comissao !== "" && !(num(f.comissao) > 0 && num(f.comissao) < 100)) return onToast?.("Comissão entre 0 e 100%");
    const campos = {
      nome: f.nome.trim(),
      rede: f.rede.trim() || null,
      nicho: f.nicho.trim() || null,
      canal_id: f.canal_id || null,
      comissao: f.comissao === "" ? null : num(f.comissao) / 100,
      status: f.status,
      amostra_item_tipo: f.amostra_item ? tipo : null,
      amostra_item_id: f.amostra_item ? f.amostra_item.slice(2) : null,
      amostra_qtd: Math.max(1, Math.round(num(f.amostra_qtd) || 1)),
      amostra_data: f.amostra_item && f.amostra_data ? f.amostra_data : null,
      amostra_frete: f.amostra_frete === "" ? null : num(f.amostra_frete),
      observacao: f.observacao.trim() || null,
    };
    if (!parceiro || parceiro.status !== f.status) campos.status_desde = hoje;
    setSalvando(true);
    const { error } = parceiro
      ? await supabase.from("afiliados").update(campos).eq("id", parceiro.id)
      : await supabase.from("afiliados").insert({ ...campos, loja_id: lojaId || null });
    setSalvando(false);
    if (error) return onToast?.(msgV35(error));
    onToast?.(parceiro ? `${campos.nome} atualizado` : `${campos.nome} adicionado`);
    onClose();
  }

  return (
    <EditarDialog titulo={parceiro ? `Editar ${parceiro.nome}` : "Novo parceiro"} salvando={salvando} onSalvar={salvar} onCancelar={onClose} salvarLabel={parceiro ? "Salvar" : "Adicionar"} classe="modal-box-md">
      <div className="grid-auto">
        <div className="field">
          <label>Nome ou @</label>
          <input type="text" value={f.nome} onChange={set("nome")} placeholder="@perfil" />
        </div>
        <div className="field">
          <label>Rede</label>
          <input type="text" value={f.rede} onChange={set("rede")} placeholder="Instagram, TikTok, grupo…" />
        </div>
        <div className="field">
          <label>Nicho</label>
          <input type="text" value={f.nicho} onChange={set("nicho")} placeholder="decoração, pets…" />
        </div>
        <div className="field">
          <label>Canal</label>
          <select value={f.canal_id} onChange={set("canal_id")}>
            {canais.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Comissão (%)</label>
          <input type="text" inputMode="decimal" value={f.comissao} onChange={set("comissao")} placeholder="ex.: 15" />
        </div>
        <div className="field">
          <label>Status</label>
          <select value={f.status} onChange={set("status")}>
            {STATUS_PARCEIRO.map((s) => (
              <option key={s.chave} value={s.chave}>
                {s.rotulo}
              </option>
            ))}
          </select>
        </div>
      </div>
      <h4 className="sub-titulo-modal">Amostra (opcional)</h4>
      <div className="field">
        <label>Item enviado</label>
        <BuscaItem grupos={grupos} value={f.amostra_item} onChange={(id) => setF((p) => ({ ...p, amostra_item: id }))} vazio="— sem amostra —" />
      </div>
      {f.amostra_item && (
        <div className="grid-auto">
          <div className="field">
            <label>Quantidade</label>
            <input type="number" min="1" value={f.amostra_qtd} onChange={set("amostra_qtd")} />
          </div>
          <div className="field">
            <label>Data de envio</label>
            <input type="date" value={f.amostra_data} onChange={set("amostra_data")} />
          </div>
          <div className="field">
            <label>Frete (R$)</label>
            <input type="text" inputMode="decimal" value={f.amostra_frete} onChange={set("amostra_frete")} placeholder="0,00" />
          </div>
        </div>
      )}
      {ca && (
        <p className="hint">
          Custo da amostra: <b>{BRL(ca.total)}</b> (peças {BRL(ca.pecas)}
          {ca.frete ? ` + frete ${BRL(ca.frete)}` : ""}).
          {maxAm != null &&
            ` Comissão desse item no canal: recomendada ${linhaAm.recomendada != null ? pct(linhaAm.recomendada) : "— (sem espaço acima da sua margem)"} · máxima ${maxAm >= 0.01 ? pct(maxAm) : "sem folga"}.`}
          {linhaAm?.emRampa && " Item em rampa abaixo do alvo: ainda sem folga pra comissão."}
          {maxAm != null && f.comissao !== "" && num(f.comissao) / 100 > maxAm + 1e-9 && <b className="neg"> A comissão do parceiro passa da máxima.</b>}
        </p>
      )}
      <div className="field">
        <label>Observação</label>
        <input type="text" value={f.observacao} onChange={set("observacao")} />
      </div>
    </EditarDialog>
  );
}
