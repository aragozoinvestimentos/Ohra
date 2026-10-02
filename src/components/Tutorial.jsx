import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useLoja } from "../lib/LojaContext.jsx";
import { useRankingData } from "../hooks/useRankingData.js";
import Ajuda from "./Ajuda.jsx";

// Guia de uso do app. Primeiro um checklist de progresso — lido direto do
// banco da loja atual, sem nada marcado na mão — pra mostrar rápido onde
// você está na cadeia "material → produto com custo → canal → preço
// salvo → (opcional) kit". Abaixo dele, a mesma referência de sempre,
// na mesma ordem das etapas do menu lateral (GRUPOS em App.jsx): configura
// loja/canais → cadastra dados-base → precifica → vende → gerencia.

// Cada passo do checklist: `feito` decide o ✓, `opcional` tira o passo da
// conta de "faltam N passos essenciais" (hoje só Kits é opcional — dá pra
// ter um produto precificado de ponta a ponta sem nunca montar um kit).
function useChecklist() {
  const { lojaId } = useLoja();
  const { produtos, canais, precos, kits, carregando: carregandoRanking } = useRankingData();
  const [materiais, setMateriais] = useState([]);
  // Começa "carregando" só se o Supabase estiver configurado — sem isso o
  // efeito abaixo nunca roda e o checklist ficaria preso em "Carregando…".
  const [carregandoMateriais, setCarregandoMateriais] = useState(() => !!supabase);

  useEffect(() => {
    if (!supabase) return;
    let ativo = true;
    async function carregar() {
      try {
        let query = supabase.from("materiais").select("id");
        if (lojaId) query = query.eq("loja_id", lojaId);
        const { data, error } = await query;
        if (!ativo) return;
        if (!error) setMateriais(data || []);
      } catch {
        // falha de rede — mantém o que já estava carregado
      } finally {
        if (ativo) setCarregandoMateriais(false);
      }
    }
    carregar();
    const canal = supabase
      .channel("tutorial-materiais-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "materiais" }, carregar)
      .subscribe();
    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, [lojaId]);

  const passos = [
    {
      key: "materiais",
      titulo: "Materiais cadastrados",
      feito: materiais.length > 0,
      detalhe: "Cadastre ao menos um material de fabricação (filamento por kg, ou consumível por unidade).",
      onde: "Cadastros → Materiais (Fabricação)",
    },
    {
      key: "produto-custo",
      titulo: "Produto cadastrado com custo calculado",
      feito: produtos.some((p) => Number(p.custo_producao) > 0),
      detalhe: "Simule o custo de uma peça e salve como produto (ou preencha o custo na mão em Produtos).",
      onde: 'Custo de Produção → "Salvar como Produto", ou Cadastros → Produtos',
    },
    {
      key: "canal",
      titulo: "Canal configurado",
      feito: canais.length > 0,
      detalhe: "Toda loja nova já nasce com Shopee, Mercado Livre e Shein — só confirme ou ajuste as taxas.",
      onde: "Configuração → Canais",
    },
    {
      key: "preco-salvo",
      titulo: "Preço salvo em algum canal",
      feito: precos.length > 0,
      detalhe: 'Calcule o preço ideal de um produto/kit num canal e clique em "Salvar".',
      onde: "Precificação por Canal → o resultado aparece em Produtos precificados",
    },
    {
      key: "kits",
      titulo: "Kit cadastrado",
      opcional: true,
      feito: kits.length > 0,
      detalhe: "Combine produtos já cadastrados num combo, se vender algum — não é obrigatório pra precificar.",
      onde: "Cadastros → Kits",
    },
  ];

  return { passos, carregando: carregandoRanking || carregandoMateriais };
}

function ChecklistProgresso() {
  const { passos, carregando } = useChecklist();
  const obrigatorios = passos.filter((p) => !p.opcional);
  const concluidos = obrigatorios.filter((p) => p.feito).length;
  const tudoPronto = concluidos === obrigatorios.length;
  const proximo = passos.find((p) => !p.feito);

  return (
    <div className="panel">
      <h3 className="section-title">
        Seu progresso
        <Ajuda texto="Cada linha vira ✓ sozinha assim que existe o cadastro correspondente na loja atual — não precisa marcar nada na mão, e nada aqui grava ou apaga dado nenhum. Troque de loja no seletor do topo pra ver o progresso de outra loja." />
      </h3>
      {carregando ? (
        <div className="empty">Carregando…</div>
      ) : (
        <>
          <p className="hint" style={{ marginTop: -4 }}>
            {tudoPronto
              ? "Tudo pronto — essa loja já tem pelo menos um produto com preço calculado e salvo num canal."
              : `Faltam ${obrigatorios.length - concluidos} de ${obrigatorios.length} passos essenciais pra ter um produto precificado de ponta a ponta.`}
          </p>
          <div>
            {passos.map((p) => (
              <div className="tutorial-passo" key={p.key}>
                <span className="tutorial-icone">{p.feito ? "✅" : "⬜"}</span>
                <div className="tutorial-passo-corpo">
                  <h4>
                    {p.titulo}
                    {p.opcional && (
                      <span className="badge" style={{ marginLeft: 8 }}>
                        opcional
                      </span>
                    )}
                    {!p.feito && p === proximo && (
                      <span className="badge good" style={{ marginLeft: 8 }}>
                        faça agora
                      </span>
                    )}
                  </h4>
                  <p>
                    {p.detalhe} <strong>{p.onde}</strong>.
                  </p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const ETAPAS = [
  {
    titulo: "1. Configuração",
    intro: "Defina a loja e os canais de venda (Configuração → Lojas, canais e taxas).",
    passos: [
      {
        icone: "🏬",
        nome: "Lojas e metas de preço",
        texto:
          "Cada loja tem seus próprios materiais, produtos, preços e caixa, e pode ter um PIN. Em Lojas → “Metas de preço” ficam a margem desejada, a margem mínima e o lucro mínimo por venda em R$ — o piso de todas as sugestões do app.",
      },
      {
        icone: "🛒",
        nome: "Canais e taxas",
        texto:
          "Shopee, Mercado Livre, TikTok Shop e Shein usam as taxas oficiais (calculadas pelo app, conferidas em Taxas Marketplace). Em cada canal você define imposto, custos fixos e o desconto padrão do anúncio (o % do preço riscado). Canal próprio (site, WhatsApp) tem comissão e taxa digitadas.",
      },
    ],
  },
  {
    titulo: "2. Cadastros",
    intro: "O que se repete de produto pra produto — cadastre uma vez e o app usa em tudo, sempre com o preço atual (“ao vivo”).",
    passos: [
      {
        icone: "🧵",
        nome: "Materiais e compras",
        texto:
          "Cadastre cada TIPO de material uma vez (PLA comum, PLA Silk, PETG…; consumível por unidade). Comprou? “+ Compra” na linha: informe quantidade e valor pago (com frete/desconto), à vista ou parcelado. O preço/kg vira a média das 3 últimas compras, todos os produtos atualizam sozinhos e a saída entra no Fluxo de Caixa. Renomear um material atualiza os produtos que usam ele.",
      },
      {
        icone: "📦",
        nome: "Embalagens",
        texto: "Caixa, saquinho, etiqueta, mimo… com preço, unidade e peso. A receita de embalagem de cada produto/kit puxa daqui.",
      },
      {
        icone: "🧱",
        nome: "Produtos e variações",
        texto:
          "Nome, SKU (o mesmo das plataformas), material, receita de embalagem e peso. Vende em quantidade (kit 2, kit 3)? Use “Variações de quantidade” no produto: cada uma herda tudo e você muda só o que for diferente (chapa, caixa, peso).",
      },
      {
        icone: "🎁",
        nome: "Kits",
        texto: "Produtos diferentes num anúncio só (ex.: Gato + Cachorro). A embalagem do kit é própria; o app sugere o preço por canal comparando com as peças vendidas separadas.",
      },
    ],
  },
  {
    titulo: "3. Precificar",
    intro: "Custo da peça → preço por canal → anúncio pronto. Precificação por Canal tem as sub-abas na ordem de uso (1º a 4º).",
    passos: [
      {
        icone: "🧮",
        nome: "Custo de Produção",
        texto:
          "Dados do fatiador (comprimento, tempo, peças por chapa) + energia, manutenção, falhas, acabamento, consumíveis e o ROI da impressora → custo por peça e o sugerido na Shopee. “⇄ comparar filamentos” mostra quanto a peça custaria em cada filamento. Salve como produto ou leve pra Precificação.",
      },
      {
        icone: "🏷️",
        nome: "1º Avulso",
        texto:
          "Escolha o produto (ou kit) e o canal: o app calcula o preço pela margem desejada já com as taxas reais, mostra o mínimo sem prejuízo e o mínimo aceitável, e “Salvar” grava em Produtos precificados. O botão “⇄ Filamentos” no custo compara filamentos; em kits, compara com as peças separadas.",
      },
      {
        icone: "🪜",
        nome: "2º Por quantidade",
        texto: "A escada de preços (kit 2, 3, 4…) a partir do avulso: preço por peça sempre caindo e você mantendo o lucro por peça. Crie a variação direto daqui e revise os insumos dela.",
      },
      {
        icone: "📝",
        nome: "3º Ficha do anúncio e 4º Anunciar",
        texto:
          "A Ficha monta as tabelas pra criar o anúncio (variações, SKUs, preço original, promo) no formato de cada canal. Anunciar lista, por canal, o preço original (riscado) e a promo pro cliente pagar o preço real, e marca o que mudou pra você atualizar na plataforma. Comparar canais mostra o mesmo produto em todos os canais.",
      },
      {
        icone: "💰",
        nome: "Produtos precificados",
        texto: "A grade produto × canal com o preço salvo, lucro e margem recalculados com o custo e as taxas de hoje (↻ = mudou desde que foi salvo), sugeridos de variações/kits e “⇄ filamentos”.",
      },
    ],
  },
  {
    titulo: "4. Vender",
    intro: "Orçamentos, promoções e o crescimento no orgânico.",
    passos: [
      {
        icone: "🧾",
        nome: "Orçamento",
        texto: "Encomenda avulsa (venda direta, sem taxa de plataforma) e encomenda em volume (frete diluído no lote), com lista de orçamentos salvos.",
      },
      {
        icone: "🏷",
        nome: "Promoções",
        texto: "Simula desconto, progressivo por quantidade, combo, venda combinada, frete grátis e liquidação com piso de margem, e avisa o % certo a lançar na campanha da plataforma.",
      },
      {
        icone: "📈",
        nome: "Crescimento (rampa de preço)",
        texto:
          "Entre perto do 0 a 0 pra ganhar vendas e avaliações e suba em degraus pequenos até o preço salvo (o alvo, que não muda). “+ Iniciar rampa” → registre a semana (vendas, avaliações, nota, Ads) → o app mostra os portões e sugere subir, segurar ou voltar, quanto o Ads precisa render, o que digitar no anúncio e um checklist pra melhorar a conversão.",
      },
    ],
  },
  {
    titulo: "5. Gestão",
    intro: "O dinheiro de verdade e onde focar.",
    passos: [
      {
        icone: "💵",
        nome: "Fluxo de Caixa",
        texto:
          "Entradas e saídas previstas/realizadas, recorrentes mensais e parcelados (N× com uma parcela por mês; “Editar” muda o vencimento de todas). Comece pelo saldo inicial. A projeção soma tudo mês a mês; deixe as estimativas em 0 se não quiser chute. Saída de material sem dados da compra aparece num aviso pra completar.",
      },
      {
        icone: "🎯",
        nome: "Metas",
        texto: "Meta de faturamento e lucro do mês, com o real vindo do Fluxo de Caixa.",
      },
      {
        icone: "🏆",
        nome: "Ranking, Otimização e Registro de Impressões",
        texto:
          "Ranking: itens por lucro (salvo ou estimado). Otimização: capacidade de produção e se o gargalo é impressora ou mão de obra. Registro de Impressões: taxa de falha real e o lote máximo seguro.",
      },
    ],
  },
];

const GLOSSARIO = [
  {
    termo: "Preço real",
    def: "O que o cliente paga. É o único preço que o app calcula e salva; o preço original (riscado) e a promo % só servem pro anúncio.",
  },
  {
    termo: "Margem líquida",
    def: "O que sobra de lucro sobre o preço, já descontado custo, comissão, taxa fixa, imposto e custos do canal.",
  },
  {
    termo: "0 a 0 (mínimo sem prejuízo)",
    def: "O preço em que o lucro é zero com as taxas do canal. Abaixo dele, cada venda dá prejuízo.",
  },
  {
    termo: "Mínimo aceitável",
    def: "O maior entre a margem mínima e o lucro mínimo em R$ da loja — nenhuma sugestão do app fica abaixo dele.",
  },
  {
    termo: "ROAS",
    def: "Receita que o Ads trouxe ÷ o que você gastou. O ROAS mínimo (preço ÷ lucro) é o empate: abaixo dele o Ads dá prejuízo.",
  },
  {
    termo: "ROI da máquina",
    def: "Rateio do valor da impressora entre as peças até pagar o investimento no prazo que você definir.",
  },
];

export default function Tutorial() {
  return (
    <div>
      <ChecklistProgresso />

      <div className="panel">
        <h3>Como usar o Ohra</h3>
        <p style={{ margin: "0 0 4px", fontSize: 13.5, color: "var(--ink-soft)", lineHeight: 1.6 }}>
          O menu lateral é organizado pelo uso do dia a dia (Precificar primeiro, Configuração por último), mas na
          primeira vez o caminho é outro: configure a loja e os canais (Configuração → Lojas, canais e taxas), cadastre
          os dados que se repetem (materiais, embalagens, produtos, kits), calcule o custo e o preço de uma peça, use
          isso pra vender e, por fim, acompanhe onde vale mais a pena focar e sua capacidade de produção. Abaixo vai
          um passo a passo rápido de cada etapa — o checklist acima já mostra, na prática, onde você está nessa
          cadeia agora.
        </p>
      </div>

      {ETAPAS.map((etapa) => (
        <div className="panel" key={etapa.titulo}>
          <h3 className="section-title">{etapa.titulo}</h3>
          <p className="hint" style={{ marginTop: -4 }}>
            {etapa.intro}
          </p>
          {etapa.passos.map((p) => (
            <div className="tutorial-passo" key={p.nome}>
              <span className="tutorial-icone">{p.icone}</span>
              <div className="tutorial-passo-corpo">
                <h4>{p.nome}</h4>
                <p>{p.texto}</p>
              </div>
            </div>
          ))}
        </div>
      ))}

      <div className="panel">
        <h3>Glossário rápido</h3>
        <dl className="tutorial-glossario">
          {GLOSSARIO.map((g) => (
            <div key={g.termo}>
              <dt>{g.termo}</dt>
              <dd>{g.def}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
