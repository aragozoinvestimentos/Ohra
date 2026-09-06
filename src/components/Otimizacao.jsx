import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useSalvoFlash } from "../lib/useSalvoFlash.js";
import Ajuda from "./Ajuda.jsx";

// Campo numérico com salvamento automático ao sair do campo — usado tanto
// pra config da loja (impressoras, horas disponíveis) quanto pros tempos de
// cada produto. Fora do componente principal de propósito: se ficasse
// dentro, seria recriado a cada tecla digitada e perderia o foco.
function CampoTempo({ valor, sufixo, largura = 64, onSalvar }) {
  const [editando, setEditando] = useState(valor ?? "");
  const [salvo, disparar] = useSalvoFlash();

  useEffect(() => {
    setEditando(valor ?? "");
  }, [valor]);

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
      <input
        type="number"
        step="0.1"
        min="0"
        style={{ width: largura, textAlign: "right" }}
        value={editando}
        onChange={(e) => setEditando(e.target.value)}
        onBlur={async () => {
          const num = parseFloat(editando);
          const valorFinal = isFinite(num) ? num : null;
          const atual = valor ?? null;
          if (valorFinal === atual) return;
          const ok = await onSalvar(valorFinal);
          if (ok) disparar();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.target.blur();
        }}
      />
      {sufixo}
      {salvo && <span className="salvo-check">✓</span>}
    </span>
  );
}

// Calcula a capacidade diária de um produto a partir dos tempos cadastrados
// nele e dos recursos da loja. Separa de propósito o gargalo de impressora
// (roda sozinha — o limite é só o nº de impressoras e horas de máquina) do
// gargalo de mão de obra (setup, acabamento, embalagem, separação — isso só
// acontece quando você está com a mão na massa, limitado pelas suas horas).
function calcularCapacidade(produto, loja, pedidosDia) {
  const tImpressaoHoras = Number(produto.tempo_impressao_horas);
  if (!(tImpressaoHoras > 0)) return null; // sem dado suficiente pra calcular

  const pecasPorLote = Number(produto.pecas_por_impressao) > 0 ? Number(produto.pecas_por_impressao) : 1;
  const tSetupLoteMin = Number(produto.tempo_setup_min) || 0;
  const tAcabamentoMin = Number(produto.tempo_acabamento_min) || 0;
  const tEmbalagemMin = Number(produto.tempo_embalagem_min) || 0;

  const tImpressoraPorPeca = (tImpressaoHoras * 60) / pecasPorLote;
  const tManualPorPeca = tSetupLoteMin / pecasPorLote + tAcabamentoMin + tEmbalagemMin;

  const impressoras = Number(loja?.impressoras) || 0;
  const horasImpressoraDia = Number(loja?.horas_impressora_dia) || 0;
  const horasMaoObraDia = Number(loja?.horas_mao_obra_dia) || 0;
  const tSeparacaoPedido = Number(loja?.tempo_separacao_pedido_min) || 0;
  const pedidos = Number(pedidosDia) || 0;

  const minutosImpressoraDisponiveis = impressoras * horasImpressoraDia * 60;
  const minutosMaoObraDisponiveis = Math.max(0, horasMaoObraDia * 60 - pedidos * tSeparacaoPedido);

  const capImpressora = Math.floor(minutosImpressoraDisponiveis / tImpressoraPorPeca);
  const capMaoObra = tManualPorPeca > 0 ? Math.floor(minutosMaoObraDisponiveis / tManualPorPeca) : null;

  const capacidadeReal = capMaoObra != null ? Math.min(capImpressora, capMaoObra) : capImpressora;
  let gargalo = "impressora";
  if (capMaoObra != null) {
    gargalo = capImpressora === capMaoObra ? "empatado" : capImpressora < capMaoObra ? "impressora" : "mão de obra";
  }

  return { tImpressoraPorPeca, tManualPorPeca, capImpressora, capMaoObra, capacidadeReal, gargalo };
}

export default function Otimizacao({ onToast }) {
  const { lojaId, lojas, disponivel } = useLoja();
  const loja = lojas.find((l) => l.id === lojaId) || null;
  const [produtos, setProdutos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [pedidosDia, setPedidosDia] = useState("");
  const [simProdutoId, setSimProdutoId] = useState("");
  const [simPecas, setSimPecas] = useState("");

  useEffect(() => {
    if (!supabase) {
      setCarregando(false);
      return;
    }
    let ativo = true;
    async function carregar() {
      try {
        let query = supabase.from("produtos_cadastro").select("*").order("nome");
        if (lojaId) query = query.eq("loja_id", lojaId);
        const { data, error } = await query;
        if (!ativo) return;
        if (!error) setProdutos(data || []);
      } catch {
        // falha de rede — mantém o que já estava carregado
      } finally {
        if (ativo) setCarregando(false);
      }
    }
    carregar();
    const canal = supabase
      .channel("otimizacao-produtos-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "produtos_cadastro" }, carregar)
      .subscribe();
    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, [lojaId]);

  useEffect(() => {
    setPedidosDia(loja?.pedidos_estimados_dia ?? "");
    setSimProdutoId("");
  }, [loja?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function salvarConfigLoja(campo, valor) {
    if (!supabase || !lojaId) return false;
    const { error } = await supabase.from("lojas").update({ [campo]: valor }).eq("id", lojaId);
    if (error) onToast?.(`Não foi possível salvar: ${error.message}`);
    return !error;
  }

  async function salvarPedidosDia(valor) {
    setPedidosDia(valor ?? "");
    return salvarConfigLoja("pedidos_estimados_dia", valor);
  }

  async function salvarCampoProduto(id, campo, valor) {
    if (!supabase) return false;
    const { error } = await supabase.from("produtos_cadastro").update({ [campo]: valor }).eq("id", id);
    if (error) onToast?.(`Não foi possível salvar: ${error.message}`);
    return !error;
  }

  const linhas = produtos.map((p) => ({ produto: p, capacidade: calcularCapacidade(p, loja, pedidosDia) }));
  const produtosComDados = linhas.filter((l) => l.capacidade != null);

  const simProduto = produtos.find((p) => p.id === simProdutoId) || null;
  const simCapacidade = simProduto ? calcularCapacidade(simProduto, loja, pedidosDia) : null;
  const simResultado = (() => {
    if (!simCapacidade || !simPecas) return null;
    const pecas = Number(simPecas);
    if (!(pecas > 0)) return null;
    const horasImpressoraDia = Number(loja?.horas_impressora_dia) || 0;
    const impressorasNecessarias =
      horasImpressoraDia > 0 ? Math.ceil((pecas * simCapacidade.tImpressoraPorPeca) / (horasImpressoraDia * 60)) : null;
    const horasMaoObraNecessarias = (pecas * simCapacidade.tManualPorPeca) / 60;
    return { impressorasNecessarias, horasMaoObraNecessarias };
  })();

  if (!supabase) {
    return (
      <div className="panel">
        <h3>Otimização</h3>
        <div className="empty">Indisponível — configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para ativar.</div>
      </div>
    );
  }

  if (!disponivel) {
    return (
      <div className="panel">
        <h3>Otimização</h3>
        <div className="empty">Disponível depois de rodar a migração de lojas (schema_v3.sql) no Supabase.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="panel">
        <h3 className="section-title">
          Recursos disponíveis
          <Ajuda texto="Impressão roda sozinha — o limite é só o nº de impressoras e as horas que elas podem ficar ligadas. Mão de obra é o seu tempo de verdade: trocar a impressão, dar acabamento, embalar e separar pedido. Preencher isso aqui é o que permite calcular quanto você realmente consegue produzir por dia, e se o gargalo é impressora ou é você." />
        </h3>
        <div className="row2">
          <div className="field">
            <label>Impressoras disponíveis</label>
            <CampoTempo valor={loja?.impressoras} sufixo="" onSalvar={(v) => salvarConfigLoja("impressoras", v)} />
          </div>
          <div className="field">
            <label>Horas de impressora por dia</label>
            <CampoTempo valor={loja?.horas_impressora_dia} sufixo="h" onSalvar={(v) => salvarConfigLoja("horas_impressora_dia", v)} />
          </div>
        </div>
        <div className="row2">
          <div className="field">
            <label>Suas horas disponíveis por dia (mão de obra)</label>
            <CampoTempo valor={loja?.horas_mao_obra_dia} sufixo="h" onSalvar={(v) => salvarConfigLoja("horas_mao_obra_dia", v)} />
          </div>
          <div className="field">
            <label>Tempo de separação por pedido</label>
            <CampoTempo valor={loja?.tempo_separacao_pedido_min} sufixo="min" onSalvar={(v) => salvarConfigLoja("tempo_separacao_pedido_min", v)} />
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Pedidos estimados por dia (pra descontar o tempo de separação das suas horas)</label>
          <CampoTempo valor={pedidosDia} sufixo="" onSalvar={salvarPedidosDia} />
        </div>
      </div>

      <div className="panel">
        <h3 className="section-title">
          Tempos de produção por item
          <Ajuda texto="Peças/lote é quantas unidades saem de uma impressão. Impressão é o tempo total do lote (a impressora roda sozinha). Setup é o seu tempo pra tirar a peça e começar a próxima impressão, dividido entre as peças do lote. Acabamento e embalagem são por peça." />
        </h3>
        {carregando ? (
          <div className="empty">Carregando…</div>
        ) : produtos.length === 0 ? (
          <div className="empty">Nenhum produto cadastrado ainda — vá em Cadastros → Produtos.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="num">Peças/lote</th>
                  <th className="num">Impressão (h/lote)</th>
                  <th className="num">Setup (min/lote)</th>
                  <th className="num">Acabamento (min/peça)</th>
                  <th className="num">Embalagem (min/peça)</th>
                </tr>
              </thead>
              <tbody>
                {produtos.map((p) => (
                  <tr key={p.id}>
                    <td>{p.nome}</td>
                    <td className="num">
                      <CampoTempo valor={p.pecas_por_impressao} sufixo="" largura={50} onSalvar={(v) => salvarCampoProduto(p.id, "pecas_por_impressao", v)} />
                    </td>
                    <td className="num">
                      <CampoTempo valor={p.tempo_impressao_horas} sufixo="h" largura={56} onSalvar={(v) => salvarCampoProduto(p.id, "tempo_impressao_horas", v)} />
                    </td>
                    <td className="num">
                      <CampoTempo valor={p.tempo_setup_min} sufixo="min" largura={56} onSalvar={(v) => salvarCampoProduto(p.id, "tempo_setup_min", v)} />
                    </td>
                    <td className="num">
                      <CampoTempo valor={p.tempo_acabamento_min} sufixo="min" largura={56} onSalvar={(v) => salvarCampoProduto(p.id, "tempo_acabamento_min", v)} />
                    </td>
                    <td className="num">
                      <CampoTempo valor={p.tempo_embalagem_min} sufixo="min" largura={56} onSalvar={(v) => salvarCampoProduto(p.id, "tempo_embalagem_min", v)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h3>Capacidade máxima por dia</h3>
        {produtosComDados.length === 0 ? (
          <div className="empty">Preencha ao menos o tempo de impressão de um produto acima pra ver a capacidade.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="num">Limite impressora (peças/dia)</th>
                  <th className="num">Limite mão de obra (peças/dia)</th>
                  <th className="num">Capacidade real</th>
                  <th>Gargalo</th>
                </tr>
              </thead>
              <tbody>
                {produtosComDados.map(({ produto, capacidade }) => (
                  <tr key={produto.id}>
                    <td>{produto.nome}</td>
                    <td className="num">{capacidade.capImpressora}</td>
                    <td className="num">{capacidade.capMaoObra ?? "—"}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{capacidade.capacidadeReal}</td>
                    <td>
                      {capacidade.gargalo === "impressora" && <span className="badge bad">impressora</span>}
                      {capacidade.gargalo === "mão de obra" && <span className="badge bad">mão de obra</span>}
                      {capacidade.gargalo === "empatado" && <span className="badge warn">empatado</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
          "Impressora" como gargalo indica que comprar mais impressoras aumenta sua produção. "Mão de obra" indica que o limite é o seu tempo de acabamento/embalagem/separação — nesse caso, mais impressoras sozinhas não ajudam.
        </div>
      </div>

      <div className="panel">
        <h3 className="section-title">Simular uma meta</h3>
        <div className="row2">
          <div className="field">
            <label>Produto</label>
            <select value={simProdutoId} onChange={(e) => setSimProdutoId(e.target.value)}>
              <option value="">— escolha —</option>
              {produtosComDados.map(({ produto }) => (
                <option key={produto.id} value={produto.id}>{produto.nome}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Quero produzir quantas peças por dia?</label>
            <input type="number" step="1" min="0" value={simPecas} onChange={(e) => setSimPecas(e.target.value)} />
          </div>
        </div>
        {!simProduto ? (
          <div className="hint" style={{ marginBottom: 0 }}>Escolha um produto e a quantidade desejada.</div>
        ) : simResultado ? (
          <>
            <div className="kv"><span className="k">Impressoras necessárias</span><span className="v">{simResultado.impressorasNecessarias ?? "—"}</span></div>
            <div className="kv"><span className="k">Horas de mão de obra necessárias/dia</span><span className="v">{simResultado.horasMaoObraNecessarias.toFixed(1)}h</span></div>
          </>
        ) : (
          <div className="hint" style={{ marginBottom: 0 }}>Informe quantas peças por dia você quer simular.</div>
        )}
      </div>
    </div>
  );
}
