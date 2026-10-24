import { useState } from "react";
import { usePreferencia } from "./usePreferencia.js";
import { CHAVE_BACKUP, estadoBackup, gerarBackup } from "../lib/backup.js";
import { hojeSP } from "../lib/datas.js";

// Botão "Gerar e baixar" do backup geral — o mesmo em Configuração → Lojas,
// Início (Seus dados) e no consultor da Sede. Grava a data em preferencias_loja
// (vale em qualquer computador) pra o lembrete de 15 dias.
export function useBackup(onToast) {
  const [ultimo, setUltimo] = usePreferencia(CHAVE_BACKUP, null, { atraso: 0 });
  const [gerando, setGerando] = useState(false);
  const hoje = hojeSP();
  const estado = estadoBackup(ultimo, hoje);
  async function gerar() {
    if (gerando) return;
    setGerando(true);
    try {
      const r = await gerarBackup();
      if (!r.ok) return onToast?.(`Backup falhou: ${r.falhas?.[0]?.erro || "nenhuma tabela lida"}`);
      setUltimo({ data: hoje, tabelas: r.tabelas, linhas: r.linhas });
      onToast?.(r.falhas.length ? `Backup baixado (${r.linhas} linhas), mas sem: ${r.falhas.map((f) => f.tabela).join(", ")}` : `Backup baixado — ${r.tabelas} tabelas, ${r.linhas} linhas, todas as lojas`);
    } finally {
      setGerando(false);
    }
  }
  return { ultimo, estado, gerando, gerar };
}
