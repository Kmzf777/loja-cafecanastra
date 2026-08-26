import type { Metadata } from "next";

import { Cabecalho } from "@/components/painel/casca/Cabecalho";
import { Tarja } from "@/components/painel/ui/Tarja";
import { API_BASE } from "@/lib/api-base";
import { ehSinalDoNext, lerAcessoDoPainel } from "@/lib/conta/painel-servidor";
import {
  formularioDaResposta,
  type RespostaDaVitrine,
} from "@/lib/painel/vitrine/vitrine.logica";

import { FormularioDaVitrine } from "./FormularioDaVitrine";

/**
 * `/dashboard/vitrine` — o herói da home e a barra de aviso, editáveis.
 *
 * A ENTRADA "VITRINE" DO MENU EXISTIA DESDE A ONDA 1 E DAVA 404. É esta pasta
 * que a faz existir; o menu não muda.
 *
 * O QUE ESTA TELA CONSERTA. `canastra.config_loja` já tinha `banner_desktop`,
 * `banner_mobile` e `barra_de_aviso`; o painel legado já os editava; e a vitrine
 * nova NUNCA LEU nenhum dos três (spec §1). Eram campos *write-only*: o gestor
 * subia uma imagem, via "salvo com sucesso", e nada acontecia em lugar nenhum.
 * Agora as duas pontas existem — esta tela escreve, `lib/vitrine/heroi.ts` lê.
 *
 * SERVER COMPONENT QUE BUSCA, ILHA DE CLIENTE QUE EDITA — spec §2.3. O estado
 * inicial chega renderizado; o JavaScript do editor só precisa existir por causa
 * da prévia ao vivo e da barra de salvar.
 */
export const metadata: Metadata = {
  title: "Vitrine",
  // Ferramenta de trabalho atrás de senha, como toda rota deste grupo.
  robots: { index: false, follow: false },
};

/**
 * O estado atual das duas tabelas.
 *
 * `GET /vitrine` É PÚBLICO (é a home quem mais o chama), então não há token a
 * repassar aqui — a escrita é que leva os dois guardas, e ela mora em
 * `acoes.ts`.
 *
 * `cache: "no-store"` porque quem abre esta tela precisa ver o que ESTÁ
 * gravado, não o que estava há uma hora. A home lê a mesma rota com
 * `revalidate: 3600`; são leituras com propósitos opostos e por isso com
 * políticas opostas.
 *
 * Falha devolve `null`, e a tela diz isso em vez de desenhar um formulário
 * vazio: um formulário em branco por causa de rede caída é um convite a salvar
 * o branco por cima do que estava lá.
 */
async function lerVitrine(): Promise<RespostaDaVitrine | null> {
  try {
    const res = await fetch(`${API_BASE}/vitrine`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const corpo = await res.json();
    return corpo && typeof corpo === "object" ? (corpo as RespostaDaVitrine) : null;
  } catch (erro) {
    /**
     * O NEXT SINALIZA CONTROLE DE FLUXO LANÇANDO, e este `catch` é largo o
     * bastante para engolir o sinal.
     *
     * `cache: "no-store"` durante o `next build` faz o framework lançar
     * `DYNAMIC_SERVER_USAGE` para dizer "esta rota não pode ser estática".
     * Engolido, ele viraria "a API não respondeu": a tela sairia PRERENDERIZADA
     * mostrando a tarja de erro, e servida assim do cache a todo administrador
     * que abrisse a página. Medido no build desta onda, com o stack trace
     * inteiro no log — o sintoma foi barulho; a consequência, se a rota fosse
     * elegível a estático, seria uma página errada em cache.
     *
     * A mesma trava que `lerAcessoDoPainel` já tinha, pela mesma razão. O
     * rethrow é o comportamento CERTO: propagado, o sinal faz o Next marcar a
     * rota como dinâmica, que é o que ela é.
     */
    if (ehSinalDoNext(erro)) throw erro;

    console.warn("[painel] Não foi possível ler GET /vitrine.", erro);
    return null;
  }
}

export default async function PaginaDaVitrine() {
  /**
   * A segunda leitura da sessão nesta requisição — a mesma dívida que
   * `(protegido)/page.tsx` já registrou: o layout chamou `exigirAdminNoPainel`,
   * e aqui se pergunta de novo só para saber o E-MAIL do cabeçalho. O conserto
   * é embrulhar `lerAcessoDoPainel` com o `cache()` do React, em
   * `lib/conta/painel-servidor.ts` — arquivo de segurança, fora do escopo desta
   * tarefa.
   */
  const [acesso, vitrine] = await Promise.all([lerAcessoDoPainel(), lerVitrine()]);

  return (
    <>
      <Cabecalho
        titulo="Vitrine"
        descricao="O herói da home e a barra de aviso, nos três idiomas. O que ficar em branco continua como está hoje."
        email={acesso.email}
      />

      <div className="mx-auto max-w-[1400px] px-5 py-6">
        {vitrine ? (
          <FormularioDaVitrine inicial={formularioDaResposta(vitrine)} />
        ) : (
          /*
            SEM FORMULÁRIO QUANDO A LEITURA FALHOU, e essa é a mesma regra do
            <EstadoDaTela>: "zero é um número plausível; mostrar o estado
            inicial depois de um fetch que falhou é informação errada
            apresentada com toda a confiança". Aqui é pior que informação
            errada — seriam trinta e oito campos vazios prontos para serem
            salvos por cima do conteúdo de verdade.
          */
          <Tarja tom="erro">
            Não foi possível ler o conteúdo da vitrine. Recarregue a página; se
            continuar, é a API que não está respondendo — nada aqui foi
            perdido.
          </Tarja>
        )}
      </div>
    </>
  );
}
