import { useEstoque } from "../hooks/useEstoque.js";
import { BRL } from "../lib/format.js";
import { abrirEstoque } from "../lib/estoqueNav.js";
import { custoMedioRevenda } from "../lib/revenda.js";
import Estado from "./Estado.jsx";

const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
const fq = (q) => (Number.isInteger(q) ? String(q) : Number(q).toFixed(1).replace(".", ","));

// Cadastro de produtos → produto de REVENDA (v66): no lugar do detalhamento da
// impressão, o custo de compra (média das 3 últimas notas), o fornecedor e o estoque.
export default function BlocoRevenda({ produtoId, fornecedorId, onFornecedor, dados }) {
  const { linhas } = useEstoque();
  const linha = produtoId ? linhas.find((l) => l.produto.id === produtoId) : null;
  const itens = produtoId ? dados.comprasItens.filter((i) => i.produto_id === produtoId).sort((a, b) => String(b.emissao).localeCompare(String(a.emissao))) : [];
  const media = custoMedioRevenda(itens);
  const nf = (i) => dados.compras.find((c) => c.id === i.compra_id)?.numero;
  return (
    <>
      <h3 className="section-title">Revenda — compra e estoque</h3>
      {!dados.disponivel && <div className="alerta alerta-warn">Rode o supabase/schema_v66.sql no Supabase pra usar notas de compra, fornecedores e estoque.</div>}
      <div className="grid-cards">
        <div className="kv-cel">
          <span>Custo — vem das compras</span>
          {media ? (
            <>
              <b>{BRL(media.preco)} por unidade</b>
              <span>média das {media.compras} últimas notas (preço + IPI + ST + frete rateado + DIFAL)</span>
              {itens.slice(0, 3).map((i) => (
                <span key={i.id}>
                  NF {nf(i) || "—"} · {dm(i.emissao)} · {fq(Number(i.quantidade))} un · {BRL(i.custo_un)}
                  {i.contar_media === false ? " · fora da média" : ""}
                </span>
              ))}
            </>
          ) : (
            <>
              <b>Sem nota ainda</b>
              <span>O custo digitado acima vale até a 1ª nota de compra (XML) ser importada.</span>
            </>
          )}
          <button type="button" className="link-btn" style={{ justifySelf: "start" }} onClick={() => abrirEstoque("notas")}>
            Importar nota de compra (XML) →
          </button>
        </div>
        <div className="kv-cel">
          <span>Estoque</span>
          {linha && !linha.est.semControle ? (
            <>
              <b>
                {fq(linha.est.saldo)} un · dura {linha.est.duraDias != null ? `~${Math.floor(linha.est.duraDias)} dias` : "—"} · {BRL(linha.valor)} parado
              </b>
              {linha.sit.tipo !== "ok" && (
                <span>
                  <Estado tipo={linha.sit.tipo === "negativo" ? "resolver" : linha.sit.tipo === "parado" ? "info" : "atencao"}>{linha.sit.texto}</Estado>
                </span>
              )}
            </>
          ) : (
            <>
              <b>Começa na 1ª nota importada</b>
              <span>Depois entra pela nota e sai sozinho pelos pedidos importados da Olist.</span>
            </>
          )}
          <label style={{ display: "grid", gap: 2, marginTop: 4 }}>
            <span>Fornecedor principal</span>
            <select value={fornecedorId || ""} onChange={(e) => onFornecedor(e.target.value)}>
              <option value="">—</option>
              {dados.fornecedores.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                  {f.prazo_dias != null ? ` (entrega ${f.prazo_dias} dias)` : ""}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="link-btn" style={{ justifySelf: "start" }} onClick={() => abrirEstoque("estoque")}>
            Ver no Estoque →
          </button>
        </div>
      </div>
      <p className="hint">Daqui pra frente é tudo igual ao fabricado: precificar, Anunciar, Rampa, Ads, kits (inclusive kit misto: peça 3D + item de revenda). Revenda não aparece em Simular custo, Minha farm, Registro de impressões e Otimização.</p>
    </>
  );
}
