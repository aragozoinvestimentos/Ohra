// Ícone do app Margem Real (monograma MR, escolhido pelo Gustavo em
// 17/10/2026). Segue o tema: escuro = fundo grafite, M branco e R terracota;
// claro = invertido (fundo claro, M grafite, R terracota). Cores em
// `.marca-app` no index.css (tokens --marca-*).
export default function MarcaApp({ tamanho = 28, className = "" }) {
  return (
    <svg className={`marca-app ${className}`} width={tamanho} height={tamanho} viewBox="0 0 64 64" role="img" aria-label="Margem Real">
      <rect className="marca-fundo" x="1" y="1" width="62" height="62" rx="15" />
      <text x="32" y="43" textAnchor="middle" fontFamily="Manrope, Arial, sans-serif" fontWeight="800" fontSize="28">
        <tspan className="marca-m">M</tspan>
        <tspan className="marca-r">R</tspan>
      </text>
    </svg>
  );
}
