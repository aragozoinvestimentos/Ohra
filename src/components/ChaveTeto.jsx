import { usePreferencia } from "../hooks/usePreferencia.js";

// Chave "Ignorar teto de Ads" por anúncio (22/10/2026, pedido do Gustavo):
// ligada, o app decide o Ads deste anúncio como se o teto da loja não existisse
// (o aumento não é barrado); desligada, volta a respeitar o teto. Guardada em
// preferencias_loja `ads:ignorar-teto` = { chave da linha: true }.
export default function ChaveTeto({ chave }) {
  const [mapa, setMapa] = usePreferencia("ads:ignorar-teto", {});
  if (!chave) return null;
  const ligado = !!mapa?.[chave];
  const alternar = () => {
    const novo = { ...(mapa || {}) };
    if (ligado) delete novo[chave];
    else novo[chave] = true;
    setMapa(novo);
  };
  return (
    <label className={`chave-teto${ligado ? " ligada" : ""}`} title="Ligada: o app decide este anúncio sem o teto de Ads da loja (o aumento não é barrado). Desligada: respeita o teto.">
      <button type="button" role="switch" aria-checked={ligado} className="chave-switch" onClick={alternar}>
        <span className="chave-bolinha" />
      </button>
      <span>Ignorar teto de Ads{ligado ? " — ligado" : ""}</span>
    </label>
  );
}
