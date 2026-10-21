import { useMemo, useState } from "react";
import ConfirmDialog from "./ConfirmDialog.jsx";
import { useCatalogo } from "../hooks/useCatalogo.js";
import { useRankingData } from "../hooks/useRankingData.js";
import { useRampas } from "../hooks/useRampas.js";
import { useAfiliados } from "../hooks/useAfiliados.js";
import { familiaDoItem, oQueExisteNoCanal, tirarDoCanal } from "../lib/tirarDoCanal.js";
import { BRL } from "../lib/format.js";
import CanalTag from "./CanalTag.jsx";

const pct = (v) => `${Math.round(Number(v) * 1000) / 10}%`.replace(".", ",");

// "Tirar do <canal>" — mostra o que existe do item (e da família) nesse canal
// e apaga conforme a escolha (lib/tirarDoCanal.js). Outros canais não mudam.
export default function TirarDoCanalDialog({ item, canal, onClose, onToast }) {
  const cat = useCatalogo();
  const { itens } = useRankingData();
  const { rampas, registros } = useRampas({ comRegistros: true, todosCanais: true });
  const af = useAfiliados();
  const [modo, setModo] = useState("relancar");
  const [familia, setFamilia] = useState(true);
  const [apagarRampa, setApagarRampa] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const fam = useMemo(() => familiaDoItem(item, itens), [item, itens]);
  const temFamilia = fam.length > 1;
  const alvo = familia && temFamilia ? fam : [item];
  const linhas = oQueExisteNoCanal({ itensAlvo: alvo, canal, precos: cat.precos, publicacoes: cat.publicacoesCanal, afConfig: af.config, rampas, rampaRegistros: registros });
  const comRampa = linhas.filter((l) => l.rampa);
  const semanas = comRampa.reduce((s, l) => s + l.semanas, 0);
  const marcadas = linhas.filter((l) => l.publicacao).length;

  async function confirmar() {
    if (salvando) return;
    if (modo === "relancar" && !marcadas) return onToast?.("Nada marcado como anunciado neste canal — não há o que apagar");
    setSalvando(true);
    const erros = await tirarDoCanal({ modo, linhas, canal, apagarRampa: modo === "tudo" && apagarRampa, produtos: cat.produtos });
    setSalvando(false);
    if (erros.length) {
      onToast?.(`Parte não foi apagada: ${erros[0]}`);
      return;
    }
    onToast?.(
      modo === "relancar"
        ? `Marcação de anúncio apagada em ${canal.nome} (${marcadas} ${marcadas === 1 ? "item" : "itens"}) — o preço salvo ficou`
        : `Tirado de ${canal.nome}: ${linhas.length} ${linhas.length === 1 ? "item" : "itens"}${comRampa.length ? (apagarRampa ? " + rampa" : " (a rampa ficou)") : ""}`
    );
    onClose();
  }

  return (
    <ConfirmDialog
      titulo={
        <>
          Tirar {item.nome} deste canal <CanalTag canal={canal} />
        </>
      }
      confirmarLabel={salvando ? "Apagando…" : modo === "relancar" ? "Apagar a marcação" : "Tirar tudo deste canal"}
      perigo={modo === "tudo"}
      larga
      onConfirm={confirmar}
      onCancel={onClose}
    >
      <div className="tirar-canal">
        <p className="modal-msg" style={{ marginBottom: 8 }}>
          O que existe em <b>{canal.nome}</b> (os outros canais não mudam):
        </p>
        {!linhas.length ? (
          <div className="hint">Nada salvo deste item neste canal.</div>
        ) : (
          <ul className="tirar-canal-lista">
            {linhas.map((l) => (
              <li key={l.item.id}>
                <b>{l.item.nome}</b>
                <span>
                  {[
                    l.preco ? `preço salvo ${BRL(Number(l.preco.preco))}` : null,
                    l.publicacao ? `anúncio marcado (riscado fixo ${BRL(Number(l.publicacao.preco_original))})` : null,
                    l.afiliado.length ? `afiliado ${l.afiliado.map((a) => (a.comissao != null ? pct(a.comissao) : "padrão")).join(", ")}` : null,
                    l.rampa ? `rampa · ${l.semanas} ${l.semanas === 1 ? "semana registrada" : "semanas registradas"}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
        {temFamilia && (
          <label className="check-linha">
            <input type="checkbox" checked={familia} onChange={(e) => setFamilia(e.target.checked)} /> Incluir variações e kits deste produto neste canal
          </label>
        )}
        <div className="tirar-canal-opcoes">
          <label className={`tirar-opcao${modo === "relancar" ? " on" : ""}`}>
            <input type="radio" name="tirar-modo" checked={modo === "relancar"} onChange={() => setModo("relancar")} />
            <span>
              <b>Removi o anúncio, mas vou relançar</b>
              <small>Apaga só a marcação de anúncio (riscado fixo). O preço salvo fica; ao relançar, a Anunciar volta a sugerir o preço de cadastro.</small>
            </span>
          </label>
          <label className={`tirar-opcao${modo === "tudo" ? " on" : ""}`}>
            <input type="radio" name="tirar-modo" checked={modo === "tudo"} onChange={() => setModo("tudo")} />
            <span>
              <b>Tirar tudo deste canal</b>
              <small>Apaga preço salvo, marcação de anúncio, comissão de afiliado e as quantidades anunciadas neste canal.</small>
            </span>
          </label>
        </div>
        {modo === "tudo" && comRampa.length > 0 && (
          <div className="aviso-cel ruim" style={{ marginTop: 10 }}>
            <b>Rampa neste canal:</b> a rampa{comRampa.length > 1 ? "s" : ""} e {semanas} {semanas === 1 ? "semana registrada" : "semanas registradas"} serão apagadas se você marcar abaixo. Sem marcar, a rampa fica e o resto é apagado.
            <label className="check-linha" style={{ marginTop: 6 }}>
              <input type="checkbox" checked={apagarRampa} onChange={(e) => setApagarRampa(e.target.checked)} /> Apagar também a rampa e as {semanas} semanas registradas
            </label>
          </div>
        )}
      </div>
    </ConfirmDialog>
  );
}
