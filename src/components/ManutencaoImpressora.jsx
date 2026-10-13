import { useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { recarregarCatalogo } from "../lib/catalogoStore.js";
import { inicioManutencao, itensDaImpressora, PLANO_A1, planoDe, textoPrazo } from "../lib/manutencao.js";
import EditarDialog from "./EditarDialog.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import Ajuda from "./Ajuda.jsx";

// Minha farm → clicar na impressora: lista de manutenção (lib/manutencao.js,
// schema v50). Por calendário: cada item tem "a cada N dias"; ✓ grava em
// `manutencoes` o dia em que foi feito. Nada aqui mexe em custo ou preço.
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
const recarregar = () => window.dispatchEvent(new Event("focus"));

export default function ManutencaoImpressora({ imp, impressoras, cfg, hoje, manutH, lojaId, onToast }) {
  const [plano, setPlano] = useState(null); // edição do plano
  const [desfazer, setDesfazer] = useState(null); // registro a apagar
  const [salvando, setSalvando] = useState(false);

  if (!manutH.disponivel)
    return (
      <div className="alerta alerta-warn" style={{ margin: 0 }}>
        <b>Falta o SQL da manutenção</b>Rode o supabase/schema_v50.sql no Supabase pra usar a lista de manutenção.
      </div>
    );
  if (!cfg) return null;

  const itens = itensDaImpressora(imp, manutH.registros, { impressoras, cfg, hoje });
  const vencendo = itens.filter((x) => x.vencendo);
  const inicio = inicioManutencao(imp, impressoras, cfg);
  const historico = manutH.registros.filter((r) => r.impressora_id === imp.id).slice(0, 8);

  async function marcar(lista) {
    if (!lista.length) return;
    setSalvando(true);
    const { error } = await supabase.from("manutencoes").insert(lista.map((x) => ({ loja_id: lojaId, impressora_id: imp.id, item_id: x.id, item_nome: x.nome, feita_em: hoje })));
    setSalvando(false);
    if (error) return onToast(`Não foi possível marcar: ${error.message}`);
    recarregar();
    onToast(lista.length > 1 ? `${lista.length} itens marcados como feitos hoje` : "Marcado como feito hoje");
  }
  async function salvarImpressora(campos, ok) {
    setSalvando(true);
    const { error } = await supabase.from("impressoras").update(campos).eq("id", imp.id);
    setSalvando(false);
    if (error) {
      onToast(/manutencao_/.test(error.message) ? "Falta rodar o supabase/schema_v50.sql no Supabase" : `Não foi possível salvar: ${error.message}`);
      return false;
    }
    recarregarCatalogo();
    onToast(ok);
    return true;
  }
  async function salvarPlano() {
    const limpo = plano
      .map((x, k) => ({ id: x.id || `item-${Date.now()}-${k}`, nome: String(x.nome || "").trim(), dias: Math.max(1, Math.round(Number(x.dias) || 0)) }))
      .filter((x) => x.nome);
    if (!limpo.length) return onToast("Deixe pelo menos um item no plano");
    if (await salvarImpressora({ manutencao_plano: limpo }, "Plano de manutenção salvo")) setPlano(null);
  }
  async function apagarRegistro() {
    const { error } = await supabase.from("manutencoes").delete().eq("id", desfazer.id);
    setDesfazer(null);
    if (error) return onToast(`Não foi possível apagar: ${error.message}`);
    recarregar();
    onToast("Registro apagado");
  }

  return (
    <div className="detalhe-cel manut">
      <div className="manut-topo">
        <b>Manutenção de {imp.nome}</b>
        <span className="muted-cel">
          por calendário · referência{" "}
          <input
            type="date"
            className="manut-data"
            value={inicio}
            onChange={(e) => e.target.value && salvarImpressora({ manutencao_inicio: e.target.value }, "Dia de referência salvo")}
            title="Dia a partir do qual o app conta os intervalos dos itens que você ainda não marcou"
          />
        </span>
        <Ajuda texto="Cada item tem um intervalo em dias. A próxima data é a última vez que você marcou ✓ + o intervalo (o que nunca foi marcado conta a partir do dia de referência). O Início avisa 3 dias antes e continua avisando se atrasar. Com várias impressoras, o app espalha os dias de referência de N em N dias (Dados gerais da farm). Modelo da Bambu Lab A1: trilhos com óleo (nunca graxa no trilho X), fuso do Z com graxa a cada 3 meses (wiki oficial)." />
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {vencendo.length > 0 && (
            <button type="button" className="btn btn-mini primary" disabled={salvando} onClick={() => marcar(vencendo)}>
              ✓ Fiz a manutenção ({vencendo.length} {vencendo.length === 1 ? "item" : "itens"})
            </button>
          )}
          <button type="button" className="btn btn-mini" onClick={() => setPlano(planoDe(imp).map((x) => ({ ...x })))}>
            Editar plano
          </button>
        </span>
      </div>
      <table className="tabela-ads">
        <tbody>
          {itens.map((x) => (
            <tr key={x.id}>
              <td>{x.nome}</td>
              <td className="muted-cel" style={{ whiteSpace: "nowrap" }}>a cada {x.dias} dias</td>
              <td className="muted-cel" style={{ whiteSpace: "nowrap" }}>{x.ultima ? `feito ${dm(x.ultima)}` : "nunca marcado"}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                {x.vencendo ? <span className="st st-atencao">⚠ {textoPrazo(x.faltam)}</span> : <span className="muted-cel">{dm(x.proxima)} ({textoPrazo(x.faltam)})</span>}
              </td>
              <td className="acao">
                <button type="button" className="btn btn-mini" disabled={salvando} onClick={() => marcar([x])} title="Marcar como feito hoje">
                  ✓ feito hoje
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {historico.length > 0 && (
        <div className="manut-hist">
          <span className="ads-rotulo">Últimos registros</span>
          {historico.map((r) => (
            <span key={r.id} className="chip-ads">
              {dm(r.feita_em)} · {String(r.item_nome || r.item_id).split(/[:(]/)[0].trim()}
              <button type="button" className="btn-icone" title="Apagar este registro" onClick={() => setDesfazer(r)}>×</button>
            </span>
          ))}
        </div>
      )}

      {plano && (
        <EditarDialog titulo={`Plano de manutenção — ${imp.nome}`} salvando={salvando} onCancelar={() => setPlano(null)} onSalvar={salvarPlano} salvarLabel="Salvar plano">
          <div className="manut-plano">
            {plano.map((x, k) => (
              <div key={x.id || k} className="manut-plano-linha">
                <input type="text" value={x.nome} placeholder="Tarefa" onChange={(e) => setPlano((p) => p.map((y, j) => (j === k ? { ...y, nome: e.target.value } : y)))} />
                <span>a cada</span>
                <input type="number" min="1" style={{ width: 70 }} value={x.dias} onChange={(e) => setPlano((p) => p.map((y, j) => (j === k ? { ...y, dias: e.target.value } : y)))} />
                <span>dias</span>
                <button type="button" className="btn-icone" title="Tirar do plano" onClick={() => setPlano((p) => p.filter((_, j) => j !== k))}>×</button>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" className="btn btn-mini" onClick={() => setPlano((p) => [...p, { id: "", nome: "", dias: 30 }])}>+ Item</button>
            <button type="button" className="btn btn-mini" onClick={() => setPlano(PLANO_A1.map((x) => ({ ...x })))}>Voltar ao modelo da A1</button>
          </div>
        </EditarDialog>
      )}
      {desfazer && (
        <ConfirmDialog
          titulo="Apagar este registro de manutenção?"
          mensagem={`${dm(desfazer.feita_em)} · ${desfazer.item_nome || desfazer.item_id}. A próxima data desse item volta a contar pelo registro anterior.`}
          confirmarLabel="Apagar"
          perigo
          onConfirm={apagarRegistro}
          onCancel={() => setDesfazer(null)}
        />
      )}
    </div>
  );
}
