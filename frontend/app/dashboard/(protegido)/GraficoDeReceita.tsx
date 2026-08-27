"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatarReais } from "@/lib/painel/dinheiro";
import type { PontoDaSerie } from "@/lib/painel/home/home.logica";

/**
 * A receita por dia — LINHA, e o `PieChart` do painel legado não sobreviveu.
 *
 * R30, e o motivo é de percepção e não de gosto: **ângulo e área não são canais
 * visuais precisos**. Ninguém compara duas fatias de 22% e 25% sem ler os
 * rótulos — e se é preciso ler os rótulos, a tabela já bastava. A regra proíbe
 * pizza, donut, gauge, treemap e 3D, e reserva a LINHA para série temporal e a
 * BARRA ORDENADA para comparação. Receita por dia é série temporal.
 *
 * `HomeDashboard.jsx` tinha um `PieChart` de pedidos por status. Ele não foi
 * traduzido: pedidos por status é uma COMPARAÇÃO, e ela já aparece nesta tela
 * de um jeito melhor — como fila de trabalho, com um link por status. Um gráfico
 * do qual não se pode clicar num pedaço é um número decorativo, que é
 * exatamente o que o §4.1 recusa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A COR VEM DO TERRITÓRIO, NUNCA DA SEMÂNTICA — spec §2.5, última linha.
 *
 * `--color-barro` é uma das três cores de território da marca (com juta e
 * mata), e é a única delas que passa em 4,5:1 sobre cal-puro — o
 * `proibicoes.test.ts` mede isso lendo o `globals.css`. Usar `--color-sucesso`
 * ou `--color-vermelho` numa série faria a linha de receita parecer um juízo
 * ("verde = bom"), e gastaria as duas cores que R21 reserva a estado.
 *
 * A referência é `var(--color-barro)` e não o hexadecimal: o token muda no
 * `globals.css` e o gráfico acompanha. SVG aceita `var()` em `stroke` e `fill`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * É UMA ILHA DE CLIENTE, E A TABELA AO LADO NÃO É.
 *
 * O `<ResponsiveContainer>` mede o contêiner para saber que largura desenhar, e
 * medir exige DOM: no servidor ele renderiza vazio, e o gráfico só aparece
 * depois da hidratação. Por isso a MESMA SÉRIE sai também como uma `<table>`
 * visualmente oculta, renderizada no servidor — que é o que faz o dado existir
 * para o leitor de tela, para quem está sem JavaScript e para quem lê o HTML.
 * Um gráfico sem alternativa textual é um dado que só existe para quem enxerga.
 */
export function GraficoDeReceita({ serie }: { serie: PontoDaSerie[] }) {
  return (
    <div>
      {/*
        `aria-hidden` no gráfico inteiro: um SVG de recharts anuncia dezenas de
        nós sem significado nenhum ("grupo, caminho, grupo…"). A informação vai
        pela tabela abaixo, que é a mesma série em texto.
      */}
      <div aria-hidden="true" className="h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={serie} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            {/*
              Só as linhas HORIZONTAIS, e pontilhadas no filete da casa. Grade
              vertical num gráfico de sete pontos é ruído: o eixo X já marca cada
              dia. O `1px` do estetica.md §4.4 vale aqui como vale na tabela.
            */}
            <CartesianGrid
              horizontal
              vertical={false}
              stroke="var(--color-fuligem-20)"
              strokeDasharray="2 4"
            />
            <XAxis
              dataKey="dia"
              tick={{ fill: "var(--color-fuligem-55)", fontSize: 11 }}
              axisLine={{ stroke: "var(--color-fuligem-20)" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "var(--color-fuligem-55)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={72}
              /* O eixo mostra dinheiro, então mostra dinheiro — "1200" sem
                 unidade obriga a adivinhar se é real ou centavo, e esta loja
                 tem as duas unidades no mesmo schema. */
              tickFormatter={(valor: number) => formatarReais(valor)}
            />
            <Tooltip
              formatter={(valor: number) => [formatarReais(valor), "Receita"]}
              /* Sem sombra e com filete de 1px: o balão obedece ao mesmo
                 sistema que a <Ficha> (estetica.md §4.4 — profundidade se faz
                 por papel e filete). O padrão do recharts é uma caixa branca
                 com sombra difusa, que é vocabulário de outro projeto. */
              contentStyle={{
                background: "var(--color-cal-puro)",
                border: "1px solid var(--color-fuligem-20)",
                borderRadius: 0,
                fontSize: 12,
              }}
              labelStyle={{ color: "var(--color-fuligem-55)" }}
              cursor={{ stroke: "var(--color-fuligem-20)" }}
            />
            <Line
              type="monotone"
              dataKey="valor"
              stroke="var(--color-barro)"
              strokeWidth={2}
              /* O ponto marcado em cada dia: com sete pontos, ver ONDE está
                 cada medição importa mais que a suavidade da curva — sem os
                 pontos, um dia sem venda no meio parece parte da linha. */
              dot={{ r: 3, fill: "var(--color-barro)", strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/*
        A MESMA SÉRIE EM TEXTO. `sr-only` e não `hidden`: `hidden` some para o
        leitor de tela também, e aí o gráfico não teria alternativa nenhuma.
      */}
      <table className="sr-only">
        <caption>Receita por dia, nos últimos 7 dias</caption>
        <thead>
          <tr>
            <th scope="col">Dia</th>
            <th scope="col">Receita</th>
          </tr>
        </thead>
        <tbody>
          {serie.map((ponto) => (
            <tr key={ponto.dia}>
              <th scope="row">{ponto.dia}</th>
              <td>{formatarReais(ponto.valor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
