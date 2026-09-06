import { useState } from "react";
import { arredondarPreco } from "../lib/format.js";

// Ajuda a preencher "preço por unidade" quando você só tem a conta da compra
// inteira (quantidade do pacote/nota + valor total pago) — evita ter que
// fazer a divisão de cabeça antes de digitar. Só calcula e devolve o valor
// pro campo de preço via onAplicar; não mexe em nada sozinho.
// Arredonda em no máximo 3 casas decimais — o suficiente pra itens baratos
// comprados em pacote (ex: R$0,079/un) sem acumular dízima.
export default function CalculadoraPreco({ unidade, onAplicar }) {
  const [aberta, setAberta] = useState(false);
  const [quantidade, setQuantidade] = useState("");
  const [valorTotal, setValorTotal] = useState("");

  const qtd = parseFloat(quantidade);
  const total = parseFloat(valorTotal);
  const resultado = qtd > 0 && isFinite(total) ? arredondarPreco(total / qtd) : null;

  function fechar() {
    setAberta(false);
    setQuantidade("");
    setValorTotal("");
  }

  if (!aberta) {
    return (
      <button type="button" className="calc-preco-toggle" onClick={() => setAberta(true)}>
        🧮 Calcular a partir do total da compra
      </button>
    );
  }

  return (
    <div className="calc-preco-box">
      <div className="row2">
        <div className="field">
          <label>Quantidade da compra ({unidade || "un"})</label>
          <input
            type="number"
            step="0.01"
            placeholder="ex: 500"
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Valor total pago (R$)</label>
          <input
            type="number"
            step="0.01"
            placeholder="ex: 50,00"
            value={valorTotal}
            onChange={(e) => setValorTotal(e.target.value)}
          />
        </div>
      </div>
      <div className="calc-preco-resultado">
        {resultado != null ? (
          <>
            <span>
              = R$ {resultado.toFixed(3).replace(".", ",")} por {unidade || "un"}
            </span>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                onAplicar(resultado);
                fechar();
              }}
            >
              Usar este preço
            </button>
          </>
        ) : (
          <span className="calc-preco-hint">Preencha quantidade e valor total pra calcular.</span>
        )}
        <button type="button" className="calc-preco-toggle" onClick={fechar}>
          cancelar
        </button>
      </div>
    </div>
  );
}
