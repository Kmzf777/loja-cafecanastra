"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatarCentavos } from "@/lib/painel/dinheiro";

/**
 * O gráfico do relatório — LINHA para o tempo, BARRA ORDENADA para comparação.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * R30, e não é gosto: ÂNGULO E ÁREA NÃO SÃO CANAIS VISUAIS PRECISOS. Ninguém
 * compara 22% com 25% numa pizza sem ler os rótulos — e se é preciso ler os
 * rótulos, a tabela já bastava. Pizza, donut, gauge, treemap e 3D estão
 * proibidos; sobram a linha (série temporal) e a barra ordenada (comparação),
 * que usam POSIÇÃO e COMPRIMENTO, os dois canais que o olho mede bem.
 *
 * A escolha entre os dois é do TIPO DE PERGUNTA, e por isso é uma prop e não uma
 * opção do gestor: "vendas por dia" é tempo e pede linha; "vendas por produto" é
 * comparação e pede barra. Deixar escolher produziria uma linha ligando produtos
 * em ordem alfabética, que sugere uma tendência inexistente.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O GRÁFICO É `aria-hidden` E NÃO TEM TABELA OCULTA — ao contrário do da Home.
 *
 * Lá a tabela `sr-only` existia porque o gráfico era a única representação
 * daquela série. Aqui a TABELA REAL, ordenável e visível, está logo abaixo com
 * exatamente os mesmos números: uma segunda cópia oculta seria o mesmo dado três
 * vezes no DOM, e um leitor de tela leria a série duas vezes seguidas sem saber
 * que é a mesma.
 *
 * A regra que fica: gráfico sem alternativa textual é dado que só existe para
 * quem enxerga. Aqui a alternativa é a tabela — e é ela que vem primeiro no
 * código e na tela.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * A COR VEM DO TERRITÓRIO (`--color-barro`), nunca da semântica: pintar receita
 * de verde faria a série parecer um juízo, e gastaria a cor que R21 reserva a
 * estado. `--color-barro` é a única das três cores de território que passa em
 * 4,5:1 sobre cal-puro, e `proibicoes.test.ts` mede isso lendo o `globals.css`.
 */

export type PontoDoGrafico = { rotulo: string; centavos: number };

export function GraficoDoRelatorio({
  pontos,
  forma,
  titulo,
}: {
  pontos: PontoDoGrafico[];
  forma: "linha" | "barra";
  titulo: string;
}) {
  /*
    Um ponto só não é uma série nem uma comparação — é um número, e a tabela já
    o mostra. Desenhar um eixo inteiro em volta de uma barra sozinha é moldura
    sem quadro.
  */
  if (pontos.length < 2) return null;

  const eixoDeDinheiro = {
    tick: { fill: "var(--color-fuligem-55)", fontSize: 11 },
    axisLine: false as const,
    tickLine: false as const,
    width: 84,
    /* O eixo mostra dinheiro, então mostra dinheiro: "1200" sem unidade obriga
       a adivinhar se é real ou centavo — e esta loja tem as duas unidades no
       mesmo schema. */
    tickFormatter: (valor: number) => formatarCentavos(valor),
  };

  const balao = {
    formatter: (valor: number) => [formatarCentavos(valor), "Receita"] as [string, string],
    /* Filete de 1px e sem sombra: o balão obedece ao mesmo sistema da <Ficha>
       (estetica.md §4.4 — profundidade se faz por papel e filete). O padrão do
       recharts é caixa branca com sombra difusa, vocabulário de outro projeto. */
    contentStyle: {
      background: "var(--color-cal-puro)",
      border: "1px solid var(--color-fuligem-20)",
      borderRadius: 0,
      fontSize: 12,
    },
    labelStyle: { color: "var(--color-fuligem-55)" },
  };

  const grade = (
    /* Só as horizontais: a grade vertical num gráfico de poucas colunas é
       ruído, porque o eixo X já marca cada uma. */
    <CartesianGrid
      horizontal
      vertical={false}
      stroke="var(--color-fuligem-20)"
      strokeDasharray="2 4"
    />
  );

  return (
    <div aria-hidden="true" className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        {forma === "linha" ? (
          <LineChart data={pontos} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            {grade}
            <XAxis
              dataKey="rotulo"
              tick={{ fill: "var(--color-fuligem-55)", fontSize: 11 }}
              axisLine={{ stroke: "var(--color-fuligem-20)" }}
              tickLine={false}
              /* Numa janela de 30 dias, 30 rótulos viram uma tarja preta. O
                 recharts pula sozinho o que não cabe. */
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis {...eixoDeDinheiro} />
            <Tooltip {...balao} cursor={{ stroke: "var(--color-fuligem-20)" }} />
            <Line
              type="monotone"
              dataKey="centavos"
              stroke="var(--color-barro)"
              strokeWidth={2}
              /* SEM ponto marcado, ao contrário do gráfico de 7 dias da Home:
                 numa janela de 30 a 90 dias os pontos se encostam e viram uma
                 linha grossa. O `activeDot` continua marcando o que o cursor
                 está lendo. */
              dot={false}
              activeDot={{ r: 4, fill: "var(--color-barro)", strokeWidth: 0 }}
              isAnimationActive={false}
            />
          </LineChart>
        ) : (
          /*
            BARRA HORIZONTAL (`layout="vertical"` no recharts), e não vertical.
            Nome de produto é longo — "Micro-lote Amarelo Catucaí 250g" —, e num
            eixo X horizontal ele viraria texto inclinado a 45°, que é mais
            lento de ler que um rótulo deitado. Com a barra deitada, o rótulo
            fica na horizontal e o comprimento continua sendo o canal visual.
          */
          <BarChart
            data={pontos}
            layout="vertical"
            margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              horizontal={false}
              vertical
              stroke="var(--color-fuligem-20)"
              strokeDasharray="2 4"
            />
            <XAxis type="number" {...eixoDeDinheiro} width={undefined} height={28} />
            <YAxis
              type="category"
              dataKey="rotulo"
              tick={{ fill: "var(--color-fuligem-55)", fontSize: 11 }}
              axisLine={{ stroke: "var(--color-fuligem-20)" }}
              tickLine={false}
              width={160}
            />
            <Tooltip {...balao} cursor={{ fill: "var(--color-cal)" }} />
            <Bar
              dataKey="centavos"
              fill="var(--color-barro)"
              /* Canto reto: `--radius-cx` é 0px, e uma barra arredondada seria a
                 assinatura visual de outro sistema (estetica.md §4.3). */
              radius={0}
              isAnimationActive={false}
            />
          </BarChart>
        )}
      </ResponsiveContainer>
      <p className="sr-only">{titulo}</p>
    </div>
  );
}
