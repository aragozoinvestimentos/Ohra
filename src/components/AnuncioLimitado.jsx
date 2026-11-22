import { useState } from "react";
import EditarDialog from "./EditarDialog.jsx";
import { MOTIVOS_LIMITE, nomeMotivo } from "../lib/anuncioLimitado.js";
import { confirmarAindaLimitado, desmarcarLimitado, marcarLimitado, naoEhLimitado } from "../lib/anuncioLimitadoAcoes.js";
import { hojeSP } from "../lib/datas.js";

// Anúncio limitado pela plataforma (22/11/2026). lim = useCrescimento().linhasAds
// .linhas[].limitado (lib/anuncioLimitado.js → estadoLimitado + chave). Só a
// marcação grava (preferencias_loja `anuncios:limitados`); nada de preço/Ads muda.
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

export function MarcarLimitadoDialog({ chave, nome, inicial = {}, onClose, onToast }) {
  const [desde, setDesde] = useState(inicial.desde || hojeSP());
  const [motivo, setMotivo] = useState(inicial.motivo || (inicial.devolucoes > 0 ? "devolucoes" : "outro"));
  const [obs, setObs] = useState(inicial.obs || "");
  const [salvando, setSalvando] = useState(false);
  async function salvar() {
    setSalvando(true);
    const r = await marcarLimitado(chave, { desde, motivo, obs });
    setSalvando(false);
    if (r?.ok === false) return onToast?.(`Não foi possível salvar: ${r.msg}`);
    onToast?.(`${nome}: marcado como limitado desde ${dm(desde)} — preço e Ads ficam em espera`);
    onClose();
  }
  return (
    <EditarDialog titulo={`${nome}: anúncio limitado pela plataforma`} salvando={salvando} onSalvar={salvar} onCancelar={onClose} salvarLabel="Marcar como limitado">
      <p className="hint">Enquanto estiver marcado, o app não sugere mudar o preço (Preço dinâmico/Otimizar) nem o orçamento/meta do Ads deste anúncio, e os avisos dele saem do Início — fica um só. A cada 7 dias ele pergunta se ainda está limitado.</p>
      <div className="grid-auto">
        <label className="field">
          <span>Limitado desde</span>
          <input type="date" value={desde} max={hojeSP()} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label className="field">
          <span>Motivo</span>
          <select value={motivo} onChange={(e) => setMotivo(e.target.value)}>
            {MOTIVOS_LIMITE.map((m) => (
              <option key={m.id} value={m.id}>{m.nome}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Observação (opcional)</span>
        <input type="text" value={obs} placeholder="ex.: devoluções pelo tamanho; Saúde da conta sem aviso" onChange={(e) => setObs(e.target.value)} />
      </label>
    </EditarDialog>
  );
}

/**
 * Faixa/botões do anúncio limitado. compacto = só os botões (cartão do Início);
 * sem compacto = faixa completa (Painel do anúncio).
 */
export default function AnuncioLimitado({ lim, chave, nome, onToast, compacto = false, mostrarMarcar = true }) {
  const [dialogo, setDialogo] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const k = lim?.chave || chave;
  async function rodar(fn, ok) {
    setOcupado(true);
    const r = await fn();
    setOcupado(false);
    onToast?.(r?.ok === false ? `Não foi possível salvar: ${r.msg}` : ok);
  }
  const dlg = dialogo && <MarcarLimitadoDialog chave={k} nome={nome} inicial={dialogo} onClose={() => setDialogo(null)} onToast={onToast} />;

  if (lim?.ativo) {
    const a = lim.ativo;
    const botoes = (
      <>
        {(lim.conferir || lim.voltou) && (
          <button type="button" className="btn btn-mini" disabled={ocupado} onClick={() => rodar(() => confirmarAindaLimitado(k), `${nome}: continua limitado — o app pergunta de novo em 7 dias`)}>
            Ainda está limitado
          </button>
        )}
        <button type="button" className={`btn btn-mini${lim.voltou ? " primary" : ""}`} disabled={ocupado} onClick={() => rodar(() => desmarcarLimitado(k), `${nome}: voltou ao normal — preço e Ads voltam a ser analisados`)}>
          Voltou ao normal
        </button>
        {!compacto && (
          <button type="button" className="link-btn" onClick={() => setDialogo(a)}>
            editar
          </button>
        )}
      </>
    );
    if (compacto) return (<>{botoes}{dlg}</>);
    return (
      <div className="alerta alerta-warn limitado-faixa">
        <div>
          <b>⚠ Anúncio limitado pela plataforma desde {dm(a.desde)}</b> · {nomeMotivo(a.motivo)}
          {a.obs ? ` · ${a.obs}` : ""}
          <div className="hint">
            Preço e Ads em espera: o app não sugere voltar/subir o preço nem mexer no orçamento/meta — as vendas caíram pela visibilidade, não pelo preço.
            {lim.voltou ? " O Ads voltou a gastar: parece que voltou ao normal." : lim.conferir ? " Já faz 7 dias: ainda está limitado?" : ""}
          </div>
          <div className="acoes-linha-fixa">{botoes}</div>
        </div>
        {dlg}
      </div>
    );
  }
  if (lim?.suspeita) {
    const s = lim.suspeita;
    const botoes = (
      <>
        <button type="button" className="btn btn-mini primary" disabled={ocupado} onClick={() => setDialogo({ desde: s.desde, devolucoes: lim.devolucoes })}>
          Sim, está limitado
        </button>
        <button type="button" className="btn btn-mini" disabled={ocupado} onClick={() => rodar(() => naoEhLimitado(k, s.desde), `${nome}: anotado — o app não pergunta de novo por 14 dias`)}>
          Não, é outra coisa
        </button>
      </>
    );
    if (compacto) return (<>{botoes}{dlg}</>);
    return (
      <div className="alerta alerta-warn limitado-faixa">
        <div>
          <b>A plataforma pode ter limitado este anúncio</b>
          <div className="hint">{s.texto.charAt(0).toUpperCase() + s.texto.slice(1)}. Foi isso? Se sim, o app para de culpar o preço e o Ads.</div>
          <div className="acoes-linha-fixa">{botoes}</div>
        </div>
        {dlg}
      </div>
    );
  }
  if (!mostrarMarcar) return null;
  return (
    <>
      <button type="button" className="link-btn" onClick={() => setDialogo({})} title="A Shopee tirou visibilidade (devoluções, denúncia…)? Marque: o app para de sugerir mudança de preço e de Ads enquanto isso">
        ⚠ Marcar como limitado pela plataforma
      </button>
      {dlg}
    </>
  );
}
