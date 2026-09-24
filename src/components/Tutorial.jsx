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
    intro: "Antes de qualquer coisa, defina em qual loja você está trabalhando e quais canais de venda ela usa.",
    passos: [
      {
        icone: "🏬",
        nome: "Lojas",
        texto:
          'Cadastre cada loja/negócio que você usa no app (ex: "Ohra - 3D"). Cada loja pode ter um PIN de 4 números — se tiver, o app pede o PIN toda vez que você entra ou troca pra ela, e nada daquela loja aparece antes disso. Materiais, produtos, preços e histórico são todos separados por loja: troque a loja atual no seletor no topo do menu lateral.',
      },
      {
        icone: "🛒",
        nome: "Canais",
        texto:
          'As regras de cada canal de venda. Shopee, Mercado Livre, TikTok Shop e Shein seguem as faixas/comissão oficiais de cada plataforma, calculadas automaticamente pelo app (toda loja nova já nasce com Shopee, Mercado Livre e Shein cadastrados — TikTok Shop é opcional, use o botão "+ Adicionar"). Pra um canal próprio (site, WhatsApp etc.) cadastre comissão e taxa fixa na mão em "Adicionar canal próprio". Imposto, custos fixos e % de Ads são configurados por canal, oficial ou próprio — o % de Ads só é usado pra mostrar o lucro com Ads no Comparativo, não muda o preço de venda.',
      },
      {
        icone: "📋",
        nome: "Taxas Marketplace",
        texto:
          "Referência somente-leitura com a tabela oficial de comissão/taxa fixa de Shopee, Mercado Livre, TikTok Shop e Shein (com a data em que cada uma foi validada contra o site oficial), mais os canais próprios que você cadastrou em Canais — útil pra conferir de vez em quando se as faixas usadas no app ainda batem com a realidade.",
      },
    ],
  },
  {
    titulo: "2. Cadastros",
    intro:
      "É aqui que fica tudo que se repete de produto pra produto — cadastre uma vez e reaproveite no cálculo de custo. Materiais, Embalagens, Produtos e Kits ficam dentro da aba \"Cadastros\", em sub-abas.",
    passos: [
      {
        icone: "🧵",
        nome: "Materiais (Fabricação)",
        texto:
          'O que entra na fabricação da peça. Tipo "Filamento" é precificado por kg (PLA, PETG etc.). Tipo "Consumível" é precificado por unidade — cola, lixa, spray, tinta, o que for gasto aos poucos e não entra na receita de peso da peça.',
      },
      {
        icone: "📦",
        nome: "Embalagens",
        texto:
          "O que vai junto no envio, fora da peça em si: caixa, plástico bolha, envelope plástico, envelope de segurança, mimo etc. Cadastre nome, preço e unidade — depois é só montar a receita de embalagem de cada produto ou kit puxando daqui.",
      },
      {
        icone: "🧱",
        nome: "Produtos",
        texto:
          "O cadastro central de cada produto que você vende. Além do nome e custo, dá pra montar a receita de itens de embalagem (quanto de cada item cadastrado acima esse produto gasta pra ser enviado) — o total substitui o campo manual de embalagem e atualiza sozinho se o preço de um item mudar. Esse cadastro é usado em praticamente toda aba do app. Pra ver o lucro por canal de tudo que está cadastrado, use o Ranking por Retorno; pra ver preços reais já definidos por canal, use Produtos precificados.",
      },
      {
        icone: "🎁",
        nome: "Kits",
        texto:
          'Combos de produtos já cadastrados. O custo de fabricação do kit é a soma do custo de cada produto incluso, mas a embalagem do kit é independente — nunca é a soma automática das embalagens de cada produto (às vezes cabe tudo numa caixa só). Use o botão "Sugerir com base nos produtos escolhidos" como ponto de partida e ajuste à mão.',
      },
      {
        icone: "💰",
        nome: "Produtos precificados",
        texto:
          'Fica no menu logo abaixo de "Cadastros", mas é sobre preço, não sobre cadastro-base — por isso vale um destaque à parte (o nome anterior dessa tela era "Produtos precificados"). É uma grade: cada linha é um produto ou kit cadastrado, cada coluna é um canal cadastrado, e cada célula mostra o preço, lucro e margem mais recentes salvos pra essa combinação. Ela se preenche sozinha quando você clica em "Salvar" na Precificação por Canal — célula vazia é só uma combinação que ainda não foi calculada/salva. Em cada célula já preenchida dá pra usar o ✎ pra corrigir o valor na mão, ou o × pra excluir (sempre pede confirmação antes).',
      },
    ],
  },
  {
    titulo: "3. Precificar",
    intro: "Com os cadastros prontos, calcule o custo de uma peça e o preço ideal pra vender.",
    passos: [
      {
        icone: "🧮",
        nome: "Custo de Produção",
        texto:
          "Ponto de partida de tudo: digite os dados que o fatiador (slicer) mostra antes de imprimir — comprimento de filamento, tempo de impressão etc. O app calcula o peso da peça e soma material, energia, manutenção, falhas, consumíveis e o rateio (ROI) da impressora até chegar no custo de produção total. Dá pra escolher um produto já cadastrado no topo pra carregar o detalhamento dele e reajustar, ou simular do zero. Dali dá pra levar o custo direto pra Precificação por Canal, ou salvar a peça como Produto (se veio de um produto já cadastrado, isso atualiza ele em vez de criar um novo).",
      },
      {
        icone: "🏷️",
        nome: "Precificação por Canal",
        texto:
          'Pega um custo (escolhendo um produto ou kit já cadastrado, vindo da Custo de Produção, ou digitado na mão) e calcula o preço de venda pra um canal específico — Shopee, Mercado Livre, TikTok Shop, Shein ou um canal próprio seu — dada a margem líquida que você quer garantir. O app já desconta comissão, taxa fixa, imposto (o seu, sobre a venda) e custos extras daquele canal antes de sugerir o preço. O resultado destaca três números: custo total do produto, preço definido para a plataforma e quanto cai no seu bolso. Escolhendo um produto/kit cadastrado, o botão "Salvar" grava esse preço em Produtos precificados — se já existir um preço salvo pra essa mesma combinação, o app avisa antes, porque salvar de novo substitui o valor anterior.',
      },
      {
        icone: "📊",
        nome: "Comparativo",
        texto:
          "Mostra todos os canais ativos lado a lado pro mesmo produto, com o termômetro de margem (verde/vermelho conforme a meta) e o lucro com e sem Ads — bom pra decidir onde vale mais a pena vender aquela peça.",
      },
    ],
  },
  {
    titulo: "4. Vender",
    intro: "Ferramentas pro dia a dia de atender pedido e rodar promoção.",
    passos: [
      {
        icone: "🧾",
        nome: "Orçamento",
        texto:
          'Três sub-abas: "Encomenda avulsa" é pra venda direta, fora de marketplace, sem comissão nem taxa fixa de plataforma — puxe um produto cadastrado ou preencha na mão pra algo sob medida, e o "Salvar" grava numa lista própria. "Encomenda em volume" calcula o preço por lote, diluindo o frete entre as peças (quanto mais peças no lote, menor o frete por unidade). "Orçamentos salvos" lista tudo que foi salvo em "Encomenda avulsa", com editar nome e excluir.',
      },
      {
        icone: "🎁",
        nome: "Promoções",
        texto:
          "Simula o impacto de uma promoção no lucro, a partir do preço normal já calculado pro canal escolhido (mesmas taxas de Configuração → Canais). Seis formatos pra escolher: desconto direto, progressivo por quantidade, combo (leve mais pague menos), venda combinada (mistura produtos e/ou kits diferentes num pedido só), frete grátis subsidiado, e liquidação com piso de margem (você define a margem mínima aceitável e o app calcula o maior desconto possível sem furar esse piso).",
      },
    ],
  },
  {
    titulo: "5. Gestão",
    intro: "Pra olhar o negócio de um passo atrás: onde focar produção e divulgação, e sua capacidade real de produzir.",
    passos: [
      {
        icone: "🏆",
        nome: "Ranking por Retorno",
        texto:
          'Lista todo produto e kit cadastrado ordenado pelo lucro líquido por unidade. Quando já existe um preço salvo pra aquele item naquele canal (em Produtos precificados), usa o lucro/margem reais desse preço — marcado "salvo". Quando ainda não existe, estima a uma lucratividade padrão fixa só pra dar uma referência — marcado "estimado" (pra simular outra meta, use Precificação por Canal ou Comparativo). Não é ranking de venda/popularidade, é só "onde vale mais a pena focar". Filtros pra ver só Produtos ou só Kits, e pra ver o retorno no melhor canal de cada item ou num canal específico.',
      },
      {
        icone: "📈",
        nome: "Otimização",
        texto:
          "Analisa sua capacidade real de produção: quantas impressoras você tem e quantas horas elas rodam por dia (isso roda sozinho), e quanto do seu próprio tempo (mão de obra) cada peça consome pra trocar impressão, acabar e embalar. Com isso o app mostra se o gargalo é impressora ou é você, e quanto dá pra produzir por dia.",
      },
    ],
  },
];

const GLOSSARIO = [
  {
    termo: "Markup",
    def: 'Multiplicador aplicado sobre o custo total pra chegar num preço — 100% de markup significa vender pelo dobro do custo. É uma conta rápida, sem considerar taxa de canal; pra preço final de Shopee/ML, use a Precificação por Canal.',
  },
  {
    termo: "Margem líquida (lucratividade)",
    def: "O quanto sobra de lucro sobre o preço de venda, já descontado tudo (custo, comissão, taxa fixa, imposto, Ads etc.). É a meta que você define, e é ela que decide o preço sugerido.",
  },
  {
    termo: "Comissão e taxa fixa",
    def: "O que Shopee, Mercado Livre, TikTok Shop e Shein descontam de cada venda, seguindo as faixas oficiais de cada plataforma — calculadas automaticamente a partir do preço (e, no Mercado Livre, da categoria). Confira os valores usados em Configuração → Taxas Marketplace.",
  },
  {
    termo: "% de Ads",
    def: "Quanto você costuma investir em anúncio patrocinado dentro do canal, como % do preço. O app usa isso só pra mostrar o lucro \"com Ads\" no Comparativo — o preço de venda não muda.",
  },
  {
    termo: "ROI da máquina",
    def: "Rateio do valor pago na impressora entre as peças produzidas até você reaver o investimento no prazo que definir — quanto mais peças/horas de uso, menor esse custo por peça.",
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
