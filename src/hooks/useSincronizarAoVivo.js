import { useEffect, useRef } from "react";

// Mantém campos de formulário que vieram de um item cadastrado (custo,
// frete, embalagem…) SINCRONIZADOS com o valor ao vivo desse item.
//
// - Trocou o item (`chave` mudou): preenche todos os campos com os valores
//   do item novo.
// - Mesmo item, mas um valor mudou lá na origem (ex.: preço do filamento ou
//   da caixa subiu, alguém editou o produto em outro aparelho): atualiza SÓ
//   os campos que você não mexeu na mão — se o campo ainda está igual ao
//   último valor preenchido automaticamente, recebe o novo; se você digitou
//   outra coisa pra simular um cenário, o seu valor é respeitado.
//
// `aplicar(fn)` recebe uma função (anterior → novo) no formato de um
// setState funcional com as mesmas chaves de `valores`.
const iguais = (a, b) => {
  if (a === b) return true;
  const na = Number(a);
  const nb = Number(b);
  return a !== "" && b !== "" && a != null && b != null && isFinite(na) && isFinite(nb) && Math.abs(na - nb) < 0.0005;
};

export function useSincronizarAoVivo(chave, valores, aplicar) {
  const ultimo = useRef({ chave: null, valores: null });
  const assinatura = valores ? JSON.stringify(valores) : "";

  useEffect(() => {
    const anterior = ultimo.current;
    if (!chave || !valores) {
      ultimo.current = { chave, valores: null };
      return;
    }
    if (anterior.chave !== chave || !anterior.valores) {
      aplicar((atual) => ({ ...atual, ...valores }));
    } else {
      aplicar((atual) => {
        let mudou = false;
        const novo = { ...atual };
        for (const k of Object.keys(valores)) {
          if (!iguais(valores[k], anterior.valores[k]) && iguais(atual[k], anterior.valores[k])) {
            novo[k] = valores[k];
            mudou = true;
          }
        }
        return mudou ? novo : atual;
      });
    }
    ultimo.current = { chave, valores };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, assinatura]);
}
