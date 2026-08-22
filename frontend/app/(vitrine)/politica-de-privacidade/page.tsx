import type { Metadata } from "next";
import Link from "next/link";
import { PaginaTexto, AvisoJuridico } from "@/components/layout/PaginaTexto";
import { BotaoReverCookies } from "@/components/layout/BotaoReverCookies";
import { FormDescadastroNewsletter } from "@/components/layout/FormDescadastroNewsletter";

export const metadata: Metadata = {
  title: "Política de privacidade — Café Canastra",
  description: "Quais dados coletamos, por que, e como você pede para apagá-los.",
};

export default function PoliticaDePrivacidade() {
  return (
    <PaginaTexto titulo="Política de privacidade" atualizacao="agosto de 2026">
      <AvisoJuridico />

      <h2>O que coletamos</h2>
      <ul>
        {/* O telefone deixou de ser só "dado de contato do pedido" quando o
            WhatsApp entrou: ele é agora o ENDEREÇO de um canal por onde a loja
            de fato escreve. Uma política que ainda dissesse "para acompanhar o
            pedido" descreveria o dado sem descrever o uso, que é justamente o
            que a finalidade determinada do Art. 6º I exige. */}
        <li>
          Nome, e-mail, CPF e WhatsApp, para emitir a nota e acompanhar o
          pedido.
        </li>
        <li>Endereço, para calcular o frete e entregar.</li>
        <li>
          Dados de navegação (páginas vistas, itens na sacola), para manter a
          sacola entre visitas e entender o que precisa melhorar.
        </li>
      </ul>
      <p>
        Não guardamos número de cartão. O pagamento é processado pelo Mercado
        Pago, que recebe esses dados diretamente.
      </p>

      <h2>Por que coletamos</h2>
      <p>
        Para executar a compra que você pediu, cumprir obrigações fiscais e, com
        seu consentimento, mandar novidades por e-mail. Você pode retirar o
        consentimento de e-mail a qualquer momento, sem afetar suas compras — é
        o formulário abaixo, e vale na hora.
      </p>
      {/* A promessa da frase acima, com implementação atrás. O formulário fica
          AO LADO dela (mesmo desenho do BotaoReverCookies na seção Cookies):
          quem lê que pode sair não precisa procurar onde. Ele chama
          POST /newsletter/descadastrar, que apaga a inscrição do rodapé. */}
      <FormDescadastroNewsletter />
      <p>
        Se você excluir sua conta, esse e-mail sai da lista junto — não é
        preciso pedir as duas coisas.
      </p>

      {/* As duas metades do WhatsApp, com as bases legais separadas — porque
          é a separação que decide o que a pessoa pode recusar sem perder o
          resto. O aviso de pedido é execução do contrato (Art. 7º V): não
          depende de consentimento, e por isso a página não finge pedir um.
          A promoção é consentimento (Art. 7º I), e a frase precisa dizer as
          três coisas que o Art. 8º §5º pede: que é separado, que é opcional e
          por onde se revoga. */}
      <h2>WhatsApp</h2>
      <p>
        Usamos seu WhatsApp para avisar o andamento do pedido — confirmação,
        envio e código de rastreio. Isso faz parte da compra que você fez, e não
        depende de autorização à parte.
      </p>
      <p>
        Novidades e ofertas são outra coisa: só vão se você marcar a caixa no
        cadastro, e ela nasce desmarcada. Você pode desmarcá-la quando quiser em{" "}
        <Link href="/account">sua conta</Link>, e isso vale na hora, sem afetar
        os avisos de pedido.
      </p>
      <p>
        Para parar de receber tudo, responda PARAR em qualquer mensagem nossa no
        WhatsApp. O status do pedido continua na sua conta e no e-mail. O PARAR
        vale para o <strong>número</strong>, e não para a conta: se mais de um
        cadastro usa aquele telefone, todos param — quem quiser voltar a receber
        faz isso em <Link href="/account">sua conta</Link>.
      </p>

      <h2>Com quem compartilhamos</h2>
      <ul>
        <li>Mercado Pago — processamento do pagamento.</li>
        <li>Melhor Envio e transportadoras — cálculo de frete e entrega.</li>
        <li>Serviço de e-mail transacional — avisos de status do pedido.</li>
        {/* O Bling entrou na Onda 3 (backend/src/services/blingPedidos.js): ao
            aprovar o pedido, nome, CPF, e-mail e endereço vão para lá, para o
            cadastro do contato e a emissão da nota. A lista não podia continuar
            sem ele — omitir um destinatário que já recebe dado pessoal é a
            mesma promessa falsa das outras. Sem condicional de env: a chave é
            segredo de SERVIDOR, e ninguém que lê esta página teria como
            verificar a condicional (mesma razão escrita nos Termos). */}
        <li>Bling — emissão da nota fiscal do pedido.</li>
        {/* A Meta recebe o TELEFONE e o conteúdo do template a cada aviso
            (`whatsappClient.js`). Pela mesma regra que trouxe o Bling para
            esta lista: omitir um destinatário que já recebe dado pessoal é a
            mesma promessa falsa das outras. Sem condicional de env — a chave é
            segredo de SERVIDOR, e quem lê esta página não teria como conferir
            se a integração está ligada. */}
        <li>Meta (WhatsApp) — envio das mensagens de aviso do pedido.</li>
      </ul>
      <p>Não vendemos seus dados para ninguém.</p>

      <h2>Cookies</h2>
      <p>
        Usamos cookies necessários para manter você conectado e guardar a sacola.
        Cookies de medição só são usados se você aceitar no aviso que aparece na
        primeira visita.
      </p>
      <p>
        Mudou de ideia? <BotaoReverCookies /> — o aviso volta a aparecer e a
        medição para na hora. Sessão e sacola continuam funcionando.
      </p>

      <h2>Seus direitos</h2>
      <p>
        Pela LGPD, você pode pedir acesso, correção, portabilidade ou exclusão
        dos seus dados, e saber com quem foram compartilhados. Pedidos podem ser
        feitos pelo canal de contato do rodapé e são respondidos em até 15 dias.
      </p>
      {/* A exclusão não depende de pedido nenhum desde que "Encerrar minha
          conta" existe em /account (components/conta/EncerrarConta.tsx). A
          rota que faz o trabalho já existia; enquanto a porta não existia, esta
          página mandava o cliente escrever um e-mail para exercer um direito
          que a loja sabia cumprir sozinha em segundos. */}
      <p>
        A exclusão você faz sozinho, na hora:{" "}
        <Link href="/account">entre na sua conta</Link> e use “Encerrar minha
        conta”, no fim da página. Não precisa pedir nem esperar.
      </p>
      <p>
        Alguns dados precisam ser mantidos mesmo após um pedido de exclusão,
        quando há obrigação fiscal — nota fiscal, por exemplo, tem prazo legal de
        guarda.
      </p>
    </PaginaTexto>
  );
}
