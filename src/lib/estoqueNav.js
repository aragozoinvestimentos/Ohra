import { trocarSubAba } from "./subAbas.js";
import { irParaAba } from "./navegar.js";

// Abre Operação → Estoque e compras numa sub-aba (estoque | notas | fornecedores | inventario).
export function abrirEstoque(sub = "estoque") {
  trocarSubAba("ohra:estoque-sub", sub);
  irParaAba("estoque");
}
