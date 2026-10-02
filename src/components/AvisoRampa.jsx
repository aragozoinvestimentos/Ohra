// Linha informativa (Ranking e Metas): produtos em rampa de preço vendem
// abaixo do preço salvo — os números destas telas usam o preço salvo (alvo).
export default function AvisoRampa({ rampas }) {
  const n = rampas?.filter((r) => (r.degrau_atual ?? 0) < (r.degraus || []).length - 1).length || 0;
  if (!n) return null;
  return (
    <div className="linha-info">
      {n} produto{n > 1 ? "s" : ""} em rampa de preço: o lucro aqui está pelo preço alvo (o salvo); o real está menor enquanto ele{n > 1 ? "s" : ""} não chega{n > 1 ? "m" : ""} lá — veja Vender → Crescimento.
    </div>
  );
}
