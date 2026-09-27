import { createPortal } from "react-dom";

// Janelas suspensas (PIN, confirmação, edição) são renderizadas direto no
// <body>. Antes elas nasciam dentro do componente que as abria — o PIN do
// seletor de loja, por exemplo, ficava DENTRO da barra lateral (que é
// sticky/fixed e cria o próprio "contexto de empilhamento"), então aparecia
// atrás do cabeçalho/conteúdo e, no celular, presa na largura da gaveta.
export default function Portal({ children }) {
  if (typeof document === "undefined") return children;
  return createPortal(children, document.body);
}
