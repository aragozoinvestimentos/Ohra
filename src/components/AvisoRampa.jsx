// Linha informativa (Ranking e Metas): produtos em rampa de preço vendem
// abaixo do preço salvo — os números destas telas usam o preço de AGORA.
export default function AvisoRampa({ rampas }) {
  const n = rampas?.filter((r) => (r.degrau_atual ?? 0) < (r.degraus || []).length - 1).length || 0;
  if (!n) return null;
  return (
    <div className="linha-info">
      {n} produto{n > 1 ? "s" : ""} em rampa de preço: o lucro aqui está pelo preço de agora (o que está vendendo); no alvo ele{n > 1 ? "s" : ""} lucra{n > 1 ? "m" : ""} mais — veja Vender → Crescimento.
    </div>
  );
}
