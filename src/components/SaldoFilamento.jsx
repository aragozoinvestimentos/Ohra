import { useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useSaldoFilamento, recarregarInsumos } from "../hooks/useSaldoFilamento.js";
import { DIAS_AVISO_FILAMENTO } from "../lib/saldoFilamento.js";
import { hojeSP } from "../lib/datas.js";
import EditarDialog from "./EditarDialog.jsx";
import Ajuda from "./Ajuda.jsx";

// Estoque e compras → Insumos → Saldo de filamento (01/11/2026, schema v73).
// Conta em lib/saldoFilamento.js. Grava só as contagens (insumos_contagem).
const kg = (v) => `${(Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const SIT = {
  ok: ["", "ok"],
  comprar: ["st st-atencao", "comprar"],
  acabou: ["st st-resolver", "acabou"],
  contar: ["st st-info", "conte o que tem"],
  "sem-uso": ["hint", "sem uso"],
};

export default function SaldoFilamento({ onToast }) {
  const { lojaId } = useLoja();
  const { linhas, disponivel } = useSaldoFilamento();
  const [contar, setContar] = useState(null); // { material, data, cores: [{cor, kg}] }
  const [salvando, setSalvando] = useState(false);
  const hoje = hojeSP();

  async function salvar() {
    const rows = contar.cores.filter((c) => String(c.kg).trim() !== "").map((c) => ({ loja_id: lojaId, material_id: contar.material.id, cor: c.cor.trim(), kg: Number(String(c.kg).replace(",", ".")) || 0, data: contar.data }));
    if (!rows.length) return onToast?.("Digite pelo menos uma cor com o peso");
    setSalvando(true);
    const r = await supabase.from("insumos_contagem").insert(rows);
    setSalvando(false);
    if (r.error) return onToast?.(/insumos_contagem/.test(r.error.message) ? "Falta rodar o supabase/schema_v73.sql no Supabase" : `Não foi possível salvar: ${r.error.message}`);
    recarregarInsumos();
    onToast?.(`Contagem de ${contar.material.nome} salva`);
    setContar(null);
  }

  return (
    <div className="panel">
      <h3>
        Saldo de filamento{" "}
        <Ajuda texto="Parte da sua última contagem (por cor), soma as compras de material registradas depois e tira o que as impressões registradas gastaram (peso do fatiador; falha = só o % impresso). É estimado: conte de vez em quando (pese o carretel sem o carretel vazio) pra acertar." />
      </h3>
      {!disponivel && (
        <div className="alerta alerta-warn">
          <b>Falta rodar o SQL</b> Rode o <b>supabase/schema_v73.sql</b> no SQL Editor do Supabase pra guardar as contagens.
        </div>
      )}
      {linhas.length === 0 ? (
        <div className="empty">Nenhum filamento cadastrado em Materiais.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Filamento</th>
                <th>Última contagem</th>
                <th className="num">Saldo hoje</th>
                <th className="num">Gasto 30 dias</th>
                <th className="num">Dura</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.material.id}>
                  <td>
                    <b>{l.material.nome}</b>
                  </td>
                  <td>
                    {l.ultimaData ? (
                      <>
                        {dm(l.ultimaData)} · {l.cores.map((c) => `${c.cor || "sem cor"} ${kg(c.kg)}`).join(" · ")}
                        {(l.entrou > 0 || l.gastou > 0) && (
                          <div className="hint">
                            depois: + {kg(l.entrou)} comprado · − {kg(l.gastou)} impresso
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="hint">nunca contado</span>
                    )}
                  </td>
                  <td className="num">{l.saldo == null ? "—" : <b>{kg(l.saldo)}</b>}</td>
                  <td className="num">{kg(l.gasto30)}</td>
                  <td className="num">{l.dura == null ? "—" : `${l.dura} dias`}</td>
                  <td>
                    <span className={SIT[l.estado][0]}>{SIT[l.estado][1]}</span>
                    {l.estado === "comprar" && <div className="hint">menos de {DIAS_AVISO_FILAMENTO} dias no ritmo atual</div>}
                  </td>
                  <td>
                    <button className="btn btn-mini" disabled={!disponivel} onClick={() => setContar({ material: l.material, data: hoje, cores: l.cores.length ? l.cores.map((c) => ({ cor: c.cor, kg: "" })) : [{ cor: "", kg: "" }], antes: l })}>
                      Contar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {contar && (
        <EditarDialog titulo={`Contagem — ${contar.material.nome}`} salvando={salvando} onSalvar={salvar} onCancelar={() => setContar(null)} salvarLabel="Salvar contagem">
          <p className="hint">
            Pese cada cor (sem o carretel vazio) e digite em kg. A contagem substitui o saldo: daqui pra frente o app soma as compras e tira as impressões a partir dela.
            {contar.antes?.saldo != null && ` O app estimava ${kg(contar.antes.saldo)}.`}
          </p>
          <label>
            Data
            <input type="date" value={contar.data} max={hoje} onChange={(e) => setContar((c) => ({ ...c, data: e.target.value }))} />
          </label>
          {contar.cores.map((c, i) => (
            <div key={i} className="grid-auto">
              <label>
                Cor
                <input type="text" value={c.cor} placeholder="ex.: Preto" onChange={(e) => setContar((x) => ({ ...x, cores: x.cores.map((y, j) => (j === i ? { ...y, cor: e.target.value } : y)) }))} />
              </label>
              <label>
                Quanto tem (kg)
                <input type="text" inputMode="decimal" value={c.kg} placeholder="0,80" onChange={(e) => setContar((x) => ({ ...x, cores: x.cores.map((y, j) => (j === i ? { ...y, kg: e.target.value } : y)) }))} />
              </label>
            </div>
          ))}
          <button className="link-btn" onClick={() => setContar((x) => ({ ...x, cores: [...x.cores, { cor: "", kg: "" }] }))}>
            + cor
          </button>
        </EditarDialog>
      )}
    </div>
  );
}
