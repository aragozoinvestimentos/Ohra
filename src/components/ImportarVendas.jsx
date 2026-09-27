// Importar vendas — EM CONSTRUÇÃO. Vai ler o relatório de vendas exportado
// da Olist (CSV/Excel) e registrar item, canal, quantidade e valor sem
// digitação manual (alimenta Ranking real, kits mais vendidos e Fluxo de
// Caixa). Falta o Gustavo mandar um modelo do relatório pra montar o leitor.
export default function ImportarVendas() {
  return (
    <div className="panel">
      <h3>
        Importar vendas <span className="badge warn" style={{ marginLeft: 8 }}>em construção</span>
      </h3>
      <div className="em-construcao">
        <div className="em-construcao-icone">📥</div>
        <div className="em-construcao-titulo">Importação do relatório de vendas da Olist</div>
        <p>
          Quando o modelo do relatório estiver disponível, aqui você sobe o arquivo (CSV ou Excel) e o app lê item, canal, quantidade e
          valor — sem digitar nada.
        </p>
        <p>Isso vai alimentar o Ranking com vendas reais, mostrar quais kits mais vendem e lançar as vendas no Fluxo de Caixa.</p>
        <button className="btn" disabled>
          Selecionar arquivo
        </button>
      </div>
    </div>
  );
}
