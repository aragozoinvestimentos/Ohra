import { useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { BRL } from "../lib/format.js";
import { recarregarReserva } from "../hooks/useReservaProducao.js";
import { saldosCaixinhas } from "../lib/caixinhas.js";
import EditarDialog from "./EditarDialog.jsx";
import Ajuda from "./Ajuda.jsx";

// Caixinha "Insumos" no Dinheiro → Caixa (01/11/2026, simplificada): o dinheiro
// separado pra comprar material e embalagem. Nada sai do caixa — o saldo da loja
// só mostra quanto já tem destino. Conta em lib/caixinhas.js.
const num = (v) => (Number.isFinite(Number(String(v).replace(",", "."))) ? Number(String(v).replace(",", ".")) : 0);
const NOME_ANTIGA = { impostos: "Impostos", equipamentos: "Equipamentos", reserva: "Reserva", reinvestimento: "Reinvestimento", prolabore: "Pró-labore" };

export default function CaixinhasCaixa({ registros = [], disponivel, caixa, hoje, onToast }) {
  const { lojaId } = useLoja();
  const { insumos, antigas, total } = saldosCaixinhas(registros);
  const [mov, setMov] = useState(null); // { tipo, valor, descricao }
  const [salvando, setSalvando] = useState(false);
  const livre = Math.round((caixa - total) * 100) / 100;

  async function gravar(linhas) {
    if (!supabase) return false;
    setSalvando(true);
    let r = await supabase.from("reserva_producao").insert(linhas);
    // Sem o v72 a coluna `caixinha` não existe: Insumos grava sem ela (é o padrão).
    if (r.error && /caixinha|origem/.test(r.error.message)) r = await supabase.from("reserva_producao").insert(linhas.map(({ caixinha: _c, ...x }) => x));
    setSalvando(false);
    if (r.error) {
      onToast?.(`Não foi possível salvar: ${r.error.message}`);
      return false;
    }
    recarregarReserva();
    return true;
  }

  async function confirmar() {
    const v = num(mov.valor);
    if (!(v > 0)) return onToast?.("Digite o valor");
    const ok = await gravar([{ loja_id: lojaId || null, data: hoje, mes: hoje.slice(0, 7), tipo: mov.tipo, valor: Math.round(v * 100) / 100, descricao: mov.descricao.trim() || (mov.tipo === "usar" ? "usado" : "separado") }]);
    if (ok) {
      onToast?.(mov.tipo === "usar" ? "Tirado da caixinha Insumos" : "Separado na caixinha Insumos");
      setMov(null);
    }
  }

  async function liberarAntigas() {
    const linhas = Object.entries(antigas)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({ loja_id: lojaId || null, data: hoje, mes: hoje.slice(0, 7), tipo: "usar", valor: v, caixinha: k, descricao: "caixinha antiga liberada" }));
    if (linhas.length && (await gravar(linhas))) onToast?.("Caixinhas antigas liberadas");
  }

  if (!disponivel) return null;
  return (
    <div className="panel caixinhas">
      <h3>
        Caixinha Insumos <Ajuda texto="Dinheiro separado pra comprar filamento, material e embalagem. Nada sai do caixa: o saldo da loja continua o mesmo, só mostra quanto já tem destino. Quando comprar, na − Saída marque “Pago com a caixinha Insumos”." />
      </h3>
      <div className="caixinhas-topo">
        <span>
          Na caixinha <b className="caixinha-valor">{BRL(insumos)}</b>
        </span>
        <span className="hint">
          caixa da loja {BRL(caixa)} · <span className={livre < 0 ? "neg" : ""}>livre {BRL(livre)}</span>
        </span>
        <span className="caixinhas-acoes">
          <button className="btn btn-mini primary" onClick={() => setMov({ tipo: "separar", valor: "", descricao: "" })}>
            + Separar
          </button>
          <button className="btn btn-mini" onClick={() => setMov({ tipo: "usar", valor: "", descricao: "" })}>
            Usar
          </button>
        </span>
      </div>
      {livre < -0.009 && <p className="st st-atencao">⚠ A caixinha passou do dinheiro que existe no caixa — tire um pouco dela.</p>}
      {Object.keys(antigas).length > 0 && (
        <p className="hint">
          Caixinhas antigas: {Object.entries(antigas).map(([k, v]) => `${NOME_ANTIGA[k] || k} ${BRL(v)}`).join(" · ")} —{" "}
          <button className="link-btn" onClick={liberarAntigas}>
            liberar
          </button>
        </p>
      )}
      {mov && (
        <EditarDialog titulo={mov.tipo === "usar" ? "Usar da caixinha Insumos" : "Separar na caixinha Insumos"} salvando={salvando} onSalvar={confirmar} onCancelar={() => setMov(null)} salvarLabel={mov.tipo === "usar" ? "Tirar da caixinha" : "Separar"}>
          <p className="hint">
            Na caixinha: {BRL(insumos)} · livre no caixa: {BRL(livre)}. {mov.tipo === "usar" && "Se o dinheiro saiu de verdade, lance também a saída no Caixa (ou marque “Pago com a caixinha Insumos” na própria saída)."}
          </p>
          <div className="grid-auto">
            <label>
              Valor (R$)
              <input type="text" inputMode="decimal" value={mov.valor} onChange={(e) => setMov((m) => ({ ...m, valor: e.target.value }))} autoFocus />
            </label>
            <label>
              Pra quê
              <input type="text" value={mov.descricao} onChange={(e) => setMov((m) => ({ ...m, descricao: e.target.value }))} placeholder="ex.: filamento PETG, embalagens" />
            </label>
          </div>
        </EditarDialog>
      )}
    </div>
  );
}
