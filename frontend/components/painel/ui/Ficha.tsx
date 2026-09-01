import type { ReactNode } from "react";
import { ETIQUETA } from "./estilos";

/**
 * A ficha — o contêiner de conteúdo do painel.
 *
 * "Ficha" e não "card" porque é literalmente o que ela é no estetica.md §3: a
 * ETIQUETA, a ficha técnica — grid rígido, filete de 1px, canto reto. O nome em
 * inglês traria junto o vocabulário errado (elevação, sombra, raio), que é o
 * que o §4.4 rejeita: "sem sombra difusa de material design; profundidade se
 * faz por PAPEL E FILETE".
 *
 * É por isso que `bg-cal-puro` sobre o `bg-cal` da página é toda a elevação de
 * que ela precisa: a ficha é uma folha mais clara pousada sobre a cal, e a
 * diferença entre #FBFAF7 e #F1F0EA é pequena de propósito. Sombra aqui seria o
 * vocabulário de outro sistema, e a spec §2.7 a proíbe nominalmente.
 *
 * Sem estado, sem evento, sem hook: continua renderizável como Server
 * Component, que é o padrão da spec §2.3. É também por isso que a região usa
 * `aria-label={titulo}` em vez de `aria-labelledby` — este precisaria de um id
 * único, `useId()` é hook, e hook arrastaria a ficha inteira para o cliente
 * para ganhar uma diferença que o leitor de tela anuncia igual.
 */
export function Ficha({
  titulo,
  nivel = 2,
  acao,
  semPreenchimento = false,
  className = "",
  children,
}: {
  titulo?: string;
  /** O nível do <h*>. A ficha não sabe a que profundidade foi montada, e saltar
   *  de <h1> para <h3> quebra a navegação por cabeçalho de quem usa leitor de
   *  tela — que é como se percorre uma tela densa sem ouvir tudo. */
  nivel?: 2 | 3 | 4;
  /** A ação do canto do cabeçalho ("Novo produto", "Exportar"). Fica aqui e não
   *  solta acima da ficha porque uma ação órfã entre dois blocos não diz a qual
   *  dos dois pertence. */
  acao?: ReactNode;
  /** Tira o respiro do corpo, para que tabela e lista encostem no filete em vez
   *  de desenharem um segundo retângulo por dentro do primeiro. */
  semPreenchimento?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const Titulo = `h${nivel}` as "h2" | "h3" | "h4";
  const Caixa = titulo ? "section" : "div";
  const moldura = `rounded-cx border border-fuligem-20 bg-cal-puro ${className}`;

  return (
    <Caixa {...(titulo ? { "aria-label": titulo } : {})} className={moldura}>
      {titulo && (
        <div className="flex min-h-11 items-center justify-between gap-4 border-b border-fuligem-20 px-5 py-2">
          {/* O título é um CARIMBO, não uma manchete: 12px em caixa alta com
              entreletra aberta. Ele nomeia a gaveta; quem tem de saltar aos
              olhos é o conteúdo dentro dela. */}
          <Titulo className={`text-xs ${ETIQUETA} text-fuligem`}>{titulo}</Titulo>
          {acao && <div className="flex shrink-0 items-center gap-2">{acao}</div>}
        </div>
      )}
      <div className={semPreenchimento ? "" : "p-5"}>{children}</div>
    </Caixa>
  );
}
