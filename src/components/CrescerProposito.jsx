import { useState } from "react";
import { usePreferencia } from "../hooks/usePreferencia.js";
import { hojeSP } from "../lib/datas.js";
import { CRESCER_DIAS } from "../lib/ads.js";

// "Crescer de propósito" (01/11/2026, aprovado pelo Gustavo): exceção por
// anúncio — aceitar Ads abaixo do equilíbrio por até 14 dias, com um limite de
// prejuízo por semana. Guardado em preferencias_loja `ads:crescer` =
// { chave da linha: { desde, ate, limiteSemana, motivo } }. Vence sozinho.
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const somar = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export default function CrescerProposito({ chave, crescer, ads }) {
  const [mapa, setMapa] = usePreferencia("ads:crescer", {});
  const [abrindo, setAbrindo] = useState(false);
  const [limite, setLimite] = useState("");
  const [motivo, setMotivo] = useState("");
  if (!chave) return null;
  const cfg = mapa?.[chave];
  const hoje = hojeSP();
  const ativo = cfg?.desde && hoje <= (cfg.ate || somar(cfg.desde, CRESCER_DIAS));
  const sugerido = Math.max(10, Math.round(Number(ads?.orcamento || 10) * 7 * 0.5));
  const ligar = () => {
    const v = Number(String(limite || sugerido).replace(",", "."));
    if (!(v > 0)) return;
    const novo = { ...(mapa || {}), [chave]: { desde: hoje, ate: somar(hoje, CRESCER_DIAS), limiteSemana: v, motivo: motivo.trim() } };
    setMapa(novo);
    setAbrindo(false);
  };
  const desligar = () => {
    const novo = { ...(mapa || {}) };
    delete novo[chave];
    setMapa(novo);
  };
  if (ativo)
    return (
      <span className="crescer-proposito ligado" title="Exceção: o app não pede pra reduzir/pausar enquanto o prejuízo da semana ficar dentro do limite.">
        🌱 Crescendo de propósito até {dm(cfg.ate || somar(cfg.desde, CRESCER_DIAS))} · limite R$ {Number(cfg.limiteSemana).toLocaleString("pt-BR")}/semana
        {crescer?.perdaSemana != null && <> · 7 dias: {crescer.perdaSemana > 0 ? `−R$ ${crescer.perdaSemana.toFixed(2).replace(".", ",")}` : "sem prejuízo"}</>}
        <button type="button" className="link-btn" onClick={desligar}>desligar</button>
      </span>
    );
  if (!abrindo)
    return (
      <button type="button" className="btn btn-mini" onClick={() => setAbrindo(true)} title="Exceção por anúncio: aceitar o Ads abaixo do equilíbrio por até 14 dias pra ganhar vendas e avaliações, com um limite de prejuízo por semana.">
        🌱 Crescer de propósito…
      </button>
    );
  return (
    <span className="crescer-proposito">
      <label>
        Aceito até R$
        <input type="number" min="1" step="1" value={limite} placeholder={String(sugerido)} onChange={(e) => setLimite(e.target.value)} style={{ width: 70 }} />
        de prejuízo por semana
      </label>
      <input type="text" value={motivo} placeholder="motivo (ex.: ganhar avaliações)" onChange={(e) => setMotivo(e.target.value)} style={{ width: 200 }} />
      <span className="hint">vale {CRESCER_DIAS} dias e vence sozinho</span>
      <button type="button" className="btn btn-mini primary" onClick={ligar}>Ligar</button>
      <button type="button" className="btn btn-mini" onClick={() => setAbrindo(false)}>Cancelar</button>
    </span>
  );
}
