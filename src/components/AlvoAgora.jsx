import { BRL, PCT } from "../lib/format.js";

// Preço ALVO × preço de AGORA (lib/precoAgora.js) — os mesmos rótulos no app
// inteiro: "Preço alvo" (o salvo, onde se quer chegar) e "Preço agora" (o que
// o cliente paga hoje). Lucro sempre com a quebra "recebe − repor".

/** "recebe R$ 2,42 − repor R$ 1,88" (lucro já sem o custo). */
export function QuebraLucro({ q, className = "quebra-lucro" }) {
  if (!q) return null;
  return (
    <span className={className} title={`Você recebe ${BRL(q.recebe)} (o que o canal repassa, depois das taxas) − repor o produto ${BRL(q.repor)} (custo de hoje: fabricação + embalagem + frete) = lucro ${BRL(q.lucro)}`}>
      recebe {BRL(q.recebe)} − repor {BRL(q.repor)}
    </span>
  );
}

/** Cartões do detalhe: Preço alvo e (em rampa) Preço agora + a diferença. */
export function CartoesAlvoAgora({ aa, pecas = 1 }) {
  if (!aa) return null;
  const porPeca = (q) => (pecas > 1 && q ? ` · ${BRL(q.lucro / pecas)}/peça` : "");
  const cartao = (rot, q, cls, nota) => (
    <div className={`kv-cel kv-alvo-agora ${cls}`}>
      <small>{rot}</small>
      <b>{q ? BRL(q.preco) : "—"}</b>
      {q && (
        <span>
          lucro <b className="kv-lucro">{BRL(q.lucro)}</b> · {PCT(q.margem)}
          {porPeca(q)}
        </span>
      )}
      {q && <QuebraLucro q={q} />}
      {nota && <span className="muted-cel">{nota}</span>}
    </div>
  );
  if (!aa.emRampa) return cartao("Preço alvo = agora", aa.alvo, "", "é o que vale e o que está vendendo");
  return (
    <>
      {cartao("Preço alvo", aa.alvo, "", "onde você quer chegar (preço salvo)")}
      {cartao(aa.acima ? "Preço agora · testando acima" : "Preço agora · em rampa", aa.agora, "agora", "o que o cliente paga hoje")}
    </>
  );
}

/** Frase da diferença entre os dois (só em rampa). */
export function DiferencaAlvoAgora({ aa }) {
  if (!aa?.emRampa || !aa.alvo) return null;
  if (aa.acima)
    return (
      <div className="aviso-cel decisao">
        <b>Testando acima do alvo</b> agora {BRL(aa.agora.preco)} (lucro {BRL(aa.agora.lucro)}) × alvo {BRL(aa.alvo.preco)} (lucro {BRL(aa.alvo.lucro)}).
      </div>
    );
  return (
    <div className="aviso-cel decisao">
      <b>Até o alvo faltam {BRL(aa.difPreco)} no preço</b> e {BRL(aa.difLucro)} de lucro por venda — hoje você ganha {BRL(aa.agora.lucro)}, no alvo ganharia {BRL(aa.alvo.lucro)}.
    </div>
  );
}

/** Linha curta pra células/tabelas: "agora R$ 10,49 · lucro R$ 0,54". */
export function LinhaAgora({ aa, className = "linha-agora" }) {
  if (!aa?.emRampa) return null;
  return (
    <span className={className} title={`Preço agora (o cliente paga hoje): ${BRL(aa.agora.preco)} · lucro ${BRL(aa.agora.lucro)} (recebe ${BRL(aa.agora.recebe)} − repor ${BRL(aa.agora.repor)}). Alvo: ${BRL(aa.alvo?.preco)}.`}>
      agora {BRL(aa.agora.preco)} · {BRL(aa.agora.lucro)}
    </span>
  );
}

/** Célula "Lucro" das tabelas do que digitar (Ficha): pelo que o cliente paga. */
export function TdLucro({ q, qAlvo = null }) {
  return (
    <td className="num">
      {q ? (
        <>
          <b style={q.lucro < 0 ? { color: "var(--bad)" } : undefined}>{BRL(q.lucro)}</b>
          <div>
            <QuebraLucro q={q} />
          </div>
          {qAlvo && <div className="muted-cel">no alvo {BRL(qAlvo.lucro)}</div>}
        </>
      ) : (
        "—"
      )}
    </td>
  );
}
