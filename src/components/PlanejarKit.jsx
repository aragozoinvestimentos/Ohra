import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useRankingData } from "../hooks/useRankingData.js";
import { recarregarCatalogo } from "../lib/catalogoStore.js";
import { custoChapaKit, DIFERENCA_AVISO, kitsPorDia, linhasDoKit, planoEstoque } from "../lib/planoKit.js";
import { BRL } from "../lib/format.js";
import Ajuda from "./Ajuda.jsx";

// Otimização → Planejar produção de kit (lib/planoKit.js). Só consulta, menos
// a "chapa do kit" (kits.chapa_kit, schema v49), que é gravada quando você
// clica em Salvar. O preço do kit continua vindo das peças.
const num = (v) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};
const virg = (v) => (v == null || v === "" ? "" : String(v).replace(".", ","));
const h = (v) => `${(Math.round(v * 10) / 10).toLocaleString("pt-BR")} h`;

export default function PlanejarKit({ loja, onToast }) {
  const { kits, itens, produtos, materiais } = useRankingData();
  const [kitId, setKitId] = useState("");
  const [n, setN] = useState("10");
  const [chapaForm, setChapaForm] = useState(null); // edição da chapa do kit
  const [salvando, setSalvando] = useState(false);

  const kit = kits.find((k) => k.id === kitId) || kits[0] || null;
  const item = kit ? itens.find((i) => i.id === `k:${kit.id}`) : null;
  const linhas = useMemo(() => linhasDoKit(item?.componentes, produtos), [item, produtos]);
  const est = useMemo(() => planoEstoque(linhas, n), [linhas, n]);
  const chapa = kit?.chapa_kit || null;
  const mista = useMemo(() => custoChapaKit(chapa, linhas, materiais), [chapa, linhas, materiais]);
  const filamentos = materiais.filter((m) => (m.tipo || "filamento") === "filamento");
  const nKits = Math.max(0, Math.round(num(n)));

  if (!kits.length)
    return (
      <div className="panel">
        <h3 className="section-title">Planejar produção de kit</h3>
        <div className="empty">Nenhum kit cadastrado — cadastre em Cadastros → Kits.</div>
      </div>
    );

  async function salvarChapa() {
    const novo = {
      kitsPorChapa: Math.max(1, Math.round(num(chapaForm.kitsPorChapa)) || 1),
      tempo: num(chapaForm.tempo),
      comprimento: num(chapaForm.comprimento),
      materialNome: chapaForm.materialNome || null,
    };
    if (!(novo.tempo > 0) || !(novo.comprimento > 0)) return onToast?.("Preencha o tempo e o filamento da chapa (do fatiador)");
    setSalvando(true);
    const { error } = await supabase.from("kits").update({ chapa_kit: novo }).eq("id", kit.id);
    setSalvando(false);
    if (error) return onToast?.(/chapa_kit/.test(error.message) ? "Falta rodar o supabase/schema_v49.sql no Supabase" : `Não foi possível salvar: ${error.message}`);
    recarregarCatalogo();
    setChapaForm(null);
    onToast?.("Chapa do kit salva");
  }

  const dif = mista ? mista.custoKit - est.custoKit : null;
  const diaEst = kitsPorDia(est.minutosPorKit, loja);
  const diaMista = mista ? kitsPorDia(mista.minutosPorKit, loja) : null;

  return (
    <div className="panel">
      <h3 className="section-title">
        Planejar produção de kit
        <Ajuda texto="Dois jeitos de produzir: Estoque = cada peça na chapa cheia dela (as sobras ficam pra próximos pedidos). Chapa do kit = uma chapa com as peças do kit juntas, pra despachar na hora. O preço do kit sempre usa o custo das peças (chapa cheia); aqui só compara." />
      </h3>
      <div className="pad-painel">
        <div className="grid-auto">
          <div className="field">
            <label>Kit</label>
            <select value={kit?.id || ""} onChange={(e) => setKitId(e.target.value)}>
              {kits.map((k) => (
                <option key={k.id} value={k.id}>{k.nome}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Quantos kits</label>
            <input type="text" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="plano-kit">
        <div className="plano-kit-col">
          <div className="ads-rotulo">Estoque · chapas cheias</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Peça</th>
                  <th className="num">Por kit</th>
                  <th className="num">Peças</th>
                  <th className="num">Chapas</th>
                  <th className="num">Sobra</th>
                  <th className="num">Impressão</th>
                </tr>
              </thead>
              <tbody>
                {est.itens.map((x) => (
                  <tr key={x.produto.id}>
                    <td>
                      {x.produto.nome}
                      <div className="muted-cel">chapa de {x.pecasChapa} · {BRL(x.custoPeca)}/peça</div>
                    </td>
                    <td className="num">{x.quantidade}</td>
                    <td className="num">{x.pecas}</td>
                    <td className="num"><b>{x.chapas}</b></td>
                    <td className="num">{x.sobra || "—"}</td>
                    <td className="num">{x.tempoChapaMin > 0 ? h(x.horas) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="plano-kit-res">
            <span>Custo por kit (o do preço): <b>{BRL(est.custoKit)}</b></span>
            <span>{nKits} kits: <b>{est.chapas}</b> chapas{est.horas > 0 ? ` · ${h(est.horas)} de impressão` : ""}</span>
            {diaEst != null && <span>Até <b>{diaEst}</b> kits/dia com {num(loja?.impressoras)} impressora(s)</span>}
            {est.semTempo && <span className="muted-cel">Alguma peça sem tempo de impressão — preencha em "Tempos de produção por item" ou no detalhamento.</span>}
          </div>
        </div>

        <div className="plano-kit-col">
          <div className="ads-rotulo">
            Chapa do kit · sob pedido
            <Ajuda texto="Fatie uma chapa com as peças de UM ou mais kits juntas (ex.: 1 letreiro + 2 porta-guardanapos + 1 porta-guloseima) e copie do fatiador o tempo total e os metros de filamento. O app usa a impressora, as % de falhas/manutenção/acabamento e os consumíveis das peças." />
          </div>
          {chapaForm ? (
            <div className="grid-auto" style={{ marginTop: 6 }}>
              <div className="field"><label>Kits na chapa</label><input type="text" inputMode="numeric" value={chapaForm.kitsPorChapa} onChange={(e) => setChapaForm((p) => ({ ...p, kitsPorChapa: e.target.value }))} /></div>
              <div className="field"><label>Tempo total (min)</label><input type="text" inputMode="decimal" value={chapaForm.tempo} onChange={(e) => setChapaForm((p) => ({ ...p, tempo: e.target.value }))} /></div>
              <div className="field"><label>Filamento total (m)</label><input type="text" inputMode="decimal" value={chapaForm.comprimento} onChange={(e) => setChapaForm((p) => ({ ...p, comprimento: e.target.value }))} /></div>
              <div className="field">
                <label>Filamento</label>
                <select value={chapaForm.materialNome} onChange={(e) => setChapaForm((p) => ({ ...p, materialNome: e.target.value }))}>
                  <option value="">o das peças</option>
                  {filamentos.map((m) => (
                    <option key={m.id} value={m.nome}>{m.nome}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
                <button type="button" className="btn primary" disabled={salvando} onClick={salvarChapa}>{salvando ? "Salvando…" : "Salvar"}</button>
                <button type="button" className="btn" onClick={() => setChapaForm(null)}>Cancelar</button>
              </div>
            </div>
          ) : mista ? (
            <div className="plano-kit-res">
              <span>{mista.kitsPorChapa} kit(s) por chapa · {virg(chapa.tempo)} min · {virg(chapa.comprimento)} m</span>
              <span>Custo por kit: <b>{BRL(mista.custoKit)}</b> ({dif >= 0 ? "+" : "−"}{BRL(Math.abs(dif))} vs pelas peças)</span>
              <span>{nKits} kits: <b>{Math.ceil(nKits / mista.kitsPorChapa)}</b> chapas · {h((Math.ceil(nKits / mista.kitsPorChapa) * num(chapa.tempo)) / 60)} de impressão</span>
              {diaMista != null && <span>Até <b>{diaMista}</b> kits/dia</span>}
              {dif > DIFERENCA_AVISO && (
                <div className="alerta alerta-warn" style={{ margin: "6px 0 0" }}>
                  <b>Sob pedido custa {BRL(dif)} a mais por kit</b>O preço salvo usa o custo pelas peças. Se for imprimir sempre assim, confira a margem em Produtos precificados — ou mantenha um estoque pequeno das peças.
                </div>
              )}
              <button type="button" className="link-btn" style={{ justifySelf: "start" }} onClick={() => setChapaForm({ kitsPorChapa: String(chapa.kitsPorChapa || 1), tempo: virg(chapa.tempo), comprimento: virg(chapa.comprimento), materialNome: chapa.materialNome || "" })}>
                ✎ editar chapa do kit
              </button>
            </div>
          ) : (
            <div className="plano-kit-res">
              <span className="muted-cel">Ainda sem a chapa do kit. Fatie as peças de um kit juntas e informe o tempo e os metros de filamento.</span>
              <button type="button" className="btn btn-mini" style={{ justifySelf: "start" }} onClick={() => setChapaForm({ kitsPorChapa: "1", tempo: "", comprimento: "", materialNome: "" })}>
                + Informar chapa do kit
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
