import Estado from "./Estado.jsx";
import Ajuda from "./Ajuda.jsx";
import { BRL } from "../lib/format.js";

// "Surtiu efeito?" — antes × depois da última mudança no anúncio (conta em
// lib/efeito.js). Só mostra; quem decide é a aba de cada ferramenta.
const TIPO = { coletando: "info", confirmando: "decisao" };
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const n1 = (x) => (x == null ? "—" : x.toFixed(1).replace(".", ","));

export default function SurtiuEfeito({ ef }) {
  if (!ef) return null;
  const tipo = ef.estado === "final" ? ef.grupo || "info" : TIPO[ef.estado] || "info";
  const linhas = ef.depois
    ? [
        ["Vendas por dia", n1(ef.antes.vendasDia), n1(ef.depois.vendasDia)],
        ["Preço médio pago", ef.antes.preco != null ? BRL(ef.antes.preco) : "—", ef.depois.preco != null ? BRL(ef.depois.preco) : "—"],
        ["Lucro bruto por dia", BRL(ef.antes.lucroDia), BRL(ef.depois.lucroDia)],
        ["Ads por dia", BRL(ef.antes.adsDia), BRL(ef.depois.adsDia)],
        ["Sobrou depois do Ads por dia", BRL(ef.antes.sobrouDia), BRL(ef.depois.sobrouDia)],
      ]
    : [];
  return (
    <div className="panel">
      <h3>
        Surtiu efeito?{" "}
        <Ajuda texto="Compara, por dia, o que sobrou depois do Ads (lucro bruto dos pedidos pagos − Ads) antes e depois da última mudança no anúncio. Lê no 7º dia: melhorou (≥ 110%) ou piorou (< 75%) já decide; resultado parecido ou poucas vendas confirma em 14 dias. Produto em temporada decide no 7º. Enquanto não sai, não mude outra coisa no anúncio." />
      </h3>
      <Estado tipo={tipo}>{ef.titulo}</Estado>
      <p className="hint" style={{ margin: "6px 0" }}>{ef.texto}</p>
      {linhas.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Antes ({dm(ef.antesDe)}–{dm(ef.antesAte)})</th>
                <th>Depois ({dm(ef.depoisDe)}–{dm(ef.depoisAte)})</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map(([r, a, d]) => (
                <tr key={r} className={r.startsWith("Sobrou") ? "tot" : ""}>
                  <td>{r}</td>
                  <td>{a}</td>
                  <td>{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ef.sazonal && <p className="hint" style={{ marginTop: 6 }}>Em temporada as vendas sobem de qualquer jeito — o "antes" é só de 7 dias pra pesar menos isso.</p>}
      {(ef.antes?.adsDesconhecido || ef.depois?.adsDesconhecido) && <p className="hint atencao-txt" style={{ marginTop: 6 }}>Faltam envios do CSV do Ads nessas datas — o Ads por dia pode estar incompleto.</p>}
    </div>
  );
}
