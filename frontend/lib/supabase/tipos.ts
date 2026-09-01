/**
 * O schema `canastra` em TypeScript.
 *
 * ESTE ARQUIVO É DERIVADO DE `backend/db/migrations/*.sql`. Ele não é gerado:
 * `supabase gen types typescript` precisa de um access token da conta Supabase,
 * que este projeto não tem. Foi escrito à mão a partir das migrações 0001–0008
 * e 0014 (`avaliacoes` + `pode_avaliar`).
 *
 * O QUE NÃO ESTÁ AQUI, E POR QUÊ: as tabelas de 0010 (`cupons`), 0011
 * (`newsletter_inscritos`) e 0015 (`assinaturas`) NÃO passam por este cliente —
 * o navegador fala com o Express nesses três casos, e o único consumidor
 * tipado do PostgREST é a vitrine. Tipar tabela que ninguém consulta daqui
 * seria manutenção sem leitor, e a ausência não esconde nada: `.from("cupons")`
 * é erro de compilação, não consulta silenciosa ao schema errado. O dia em que
 * a vitrine falar direto com uma delas, a tabela entra ANTES da primeira
 * consulta.
 *
 * QUANDO UMA MIGRAÇÃO MUDAR, ESTE ARQUIVO MUDA JUNTO, no mesmo commit. Nada
 * detecta a divergência sozinho — nem `tsc`, nem os testes, nem o build. Um tipo
 * desatualizado é PIOR que nenhum tipo: ele afirma com confiança uma coluna que
 * o banco não tem mais, e o erro só aparece como `null` inesperado em produção.
 * O procedimento é: alterou DDL, procure a tabela aqui.
 *
 * Se um dia houver token, `supabase gen types typescript --schema canastra`
 * substitui o arquivo inteiro — com duas diferenças conscientes descritas
 * abaixo (nulabilidade das views e o argumento de `fundir_sacola`), que devem
 * ser reaplicadas ou reavaliadas, não perdidas em silêncio.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [chave: string]: Json | undefined }
  | Json[];

/**
 * Um item no formato que `canastra.fundir_sacola` espera — e a razão principal
 * de este arquivo existir.
 *
 * AS CHAVES SÃO AS COLUNAS DE `carrinho_itens`, EM PORTUGUÊS. O `ItemDaSacola`
 * gravado em `localStorage["cart"]` está em INGLÊS (`product_id`, `quantity`,
 * `price`, `name`, `image`, `size`); só `moagem` coincide. Mandar a lista crua
 * faz `produto_id` chegar nulo em todo item, o filtro da RPC descarta todos, e
 * a sacola inteira some no login — sem erro, sem log, sem 400. A migração 0007
 * gasta um bloco inteiro avisando disso.
 *
 * Com este tipo no lugar de `Json`, a tradução esquecida deixa de ser um
 * prejuízo em produção e passa a ser um erro de compilação. É por isso que o
 * `Args` de `fundir_sacola` abaixo NÃO é `Json`, que é o que a CLI emitiria.
 *
 * `produto_id` e `quantidade` são obrigatórios porque são exatamente os dois
 * campos que a RPC filtra: item sem UUID válido ou sem inteiro de 1 a 999999 é
 * DESCARTADO em silêncio. O resto é cópia de exibição e a RPC tolera ausência.
 */
export type ItemParaFundir = {
  /** UUID. Qualquer outra coisa faz a RPC descartar o item sem avisar. */
  produto_id: string;
  /** Inteiro de 1 a 999999. Fracionado é descartado pelo regex da RPC. */
  quantidade: number;
  preco?: number | null;
  nome?: string | null;
  imagem?: string | null;
  tamanho?: string | null;
  /** Sem moagem, o ON CONFLICT da RPC não dispara e o item duplica (0004/0007). */
  moagem?: string | null;
};

export type Database = {
  canastra: {
    Tables: {
      /** 0002. Ter linha aqui é o que significa "ser cliente desta loja". */
      clientes: {
        Row: {
          user_id: string;
          nome: string;
          cpf: string | null;
          telefone: string | null;
          criado_em: string;
        };
        Insert: {
          user_id: string;
          nome: string;
          cpf?: string | null;
          telefone?: string | null;
          criado_em?: string;
        };
        Update: {
          user_id?: string;
          nome?: string;
          cpf?: string | null;
          telefone?: string | null;
          criado_em?: string;
        };
        /**
         * A FK real é para `auth.users(id)`, que fica fora do schema exposto —
         * não há embed possível, então a lista vai vazia de propósito.
         */
        Relationships: [];
      };

      /** 0002. Admin é, antes disso, cliente: a FK aponta para `clientes`. */
      admins: {
        Row: { user_id: string; criado_em: string };
        Insert: { user_id: string; criado_em?: string };
        Update: { user_id?: string; criado_em?: string };
        Relationships: [
          {
            foreignKeyName: "admins_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "clientes";
            referencedColumns: ["user_id"];
          },
        ];
      };

      /**
       * 0003. `custo` está aqui e NÃO na view pública — é a coluna que a
       * `produtos_publicos` existe para esconder da chave anônima.
       */
      produtos: {
        Row: {
          produto_id: string;
          nome: string;
          tamanho: string | null;
          categoria: string | null;
          preco: number;
          custo: number;
          imagem: string | null;
          quantidade: number;
          descricao: string | null;
          peso: number;
          largura: number;
          altura: number;
          comprimento: number;
          destacado_em: string;
          criado_em: string;
          sku: string | null;
          /**
           * `tsvector`, coluna GERADA. Fica fora de Insert/Update porque o
           * Postgres recusa escrita nela (428C9). `unknown` porque não há tipo
           * JS que a represente — a busca é do painel e usa operador SQL.
           */
          tsv: unknown;
        };
        Insert: {
          produto_id?: string;
          nome: string;
          tamanho?: string | null;
          categoria?: string | null;
          preco?: number;
          custo?: number;
          imagem?: string | null;
          quantidade?: number;
          descricao?: string | null;
          peso?: number;
          largura?: number;
          altura?: number;
          comprimento?: number;
          destacado_em?: string;
          criado_em?: string;
          sku?: string | null;
        };
        Update: {
          produto_id?: string;
          nome?: string;
          tamanho?: string | null;
          categoria?: string | null;
          preco?: number;
          custo?: number;
          imagem?: string | null;
          quantidade?: number;
          descricao?: string | null;
          peso?: number;
          largura?: number;
          altura?: number;
          comprimento?: number;
          destacado_em?: string;
          criado_em?: string;
          sku?: string | null;
        };
        Relationships: [];
      };

      /** 0003. Valores de filtro da vitrine: tipo 'tamanho' ou 'categoria'. */
      produto_opcoes: {
        Row: { id: string; tipo: string; valor: string };
        Insert: { id?: string; tipo: string; valor: string };
        Update: { id?: string; tipo?: string; valor?: string };
        Relationships: [];
      };

      /** 0004. */
      enderecos: {
        Row: {
          endereco_id: string;
          user_id: string;
          cep: string | null;
          rua: string | null;
          numero: string | null;
          complemento: string | null;
          bairro: string | null;
          cidade: string | null;
          estado: string | null;
          criado_em: string;
          atualizado_em: string;
        };
        Insert: {
          endereco_id?: string;
          user_id: string;
          cep?: string | null;
          rua?: string | null;
          numero?: string | null;
          complemento?: string | null;
          bairro?: string | null;
          cidade?: string | null;
          estado?: string | null;
          criado_em?: string;
          /** 0004: não há trigger de moddatetime. TODO UPDATE manda `now()`. */
          atualizado_em?: string;
        };
        Update: {
          endereco_id?: string;
          user_id?: string;
          cep?: string | null;
          rua?: string | null;
          numero?: string | null;
          complemento?: string | null;
          bairro?: string | null;
          cidade?: string | null;
          estado?: string | null;
          criado_em?: string;
          atualizado_em?: string;
        };
        Relationships: [
          {
            foreignKeyName: "enderecos_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "clientes";
            referencedColumns: ["user_id"];
          },
        ];
      };

      /** 0004. Um por cliente — o UNIQUE em `user_id` sustenta o ON CONFLICT de 0007. */
      carrinhos: {
        Row: {
          carrinho_id: string;
          user_id: string;
          criado_em: string;
          atualizado_em: string;
        };
        Insert: {
          carrinho_id?: string;
          user_id: string;
          criado_em?: string;
          atualizado_em?: string;
        };
        Update: {
          carrinho_id?: string;
          user_id?: string;
          criado_em?: string;
          atualizado_em?: string;
        };
        Relationships: [
          {
            foreignKeyName: "carrinhos_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "clientes";
            referencedColumns: ["user_id"];
          },
        ];
      };

      /**
       * 0004. `nome`, `preco` e `imagem` são CÓPIAS do momento em que o item
       * entrou na sacola — por isso não há FK para `produtos`, e por isso não
       * existe embed `carrinho_itens -> produtos`. Um produto retirado do
       * catálogo não pode apagar a sacola de ninguém.
       */
      carrinho_itens: {
        Row: {
          id: string;
          carrinho_id: string;
          produto_id: string;
          quantidade: number;
          preco: number;
          nome: string | null;
          imagem: string | null;
          tamanho: string | null;
          moagem: string | null;
        };
        Insert: {
          id?: string;
          carrinho_id: string;
          produto_id: string;
          /** CHECK (quantidade > 0). Zero ou negativo é 23514. */
          quantidade?: number;
          preco?: number;
          nome?: string | null;
          imagem?: string | null;
          tamanho?: string | null;
          moagem?: string | null;
        };
        Update: {
          id?: string;
          carrinho_id?: string;
          produto_id?: string;
          quantidade?: number;
          preco?: number;
          nome?: string | null;
          imagem?: string | null;
          tamanho?: string | null;
          moagem?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "carrinho_itens_carrinho_id_fkey";
            columns: ["carrinho_id"];
            isOneToOne: false;
            referencedRelation: "carrinhos";
            referencedColumns: ["carrinho_id"];
          },
        ];
      };

      /**
       * 0005. `user_id` é NULÁVEL (ON DELETE SET NULL): o pedido sobrevive à
       * exclusão do cliente, e nesse estado fica invisível para toda política de
       * dono. `status` é texto livre de propósito — 0005 adiou a lista de
       * valores válidos para a tarefa das transições.
       */
      pedidos: {
        Row: {
          pedido_id: string;
          user_id: string | null;
          total: number;
          status: string;
          metodo_pagamento: string | null;
          pagamento_id_mp: string | null;
          chave_idempotencia: string | null;
          itens: Json | null;
          endereco_json: Json | null;
          frete: number;
          metodo_envio: string | null;
          codigo_rastreio: string | null;
          criado_em: string;
          atualizado_em: string;
        };
        Insert: {
          pedido_id?: string;
          user_id?: string | null;
          total?: number;
          status?: string;
          metodo_pagamento?: string | null;
          pagamento_id_mp?: string | null;
          chave_idempotencia?: string | null;
          itens?: Json | null;
          endereco_json?: Json | null;
          frete?: number;
          metodo_envio?: string | null;
          codigo_rastreio?: string | null;
          criado_em?: string;
          atualizado_em?: string;
        };
        Update: {
          pedido_id?: string;
          user_id?: string | null;
          total?: number;
          status?: string;
          metodo_pagamento?: string | null;
          pagamento_id_mp?: string | null;
          chave_idempotencia?: string | null;
          itens?: Json | null;
          endereco_json?: Json | null;
          frete?: number;
          metodo_envio?: string | null;
          codigo_rastreio?: string | null;
          criado_em?: string;
          atualizado_em?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pedidos_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "clientes";
            referencedColumns: ["user_id"];
          },
        ];
      };

      /**
       * `promocoes` SAIU DAQUI na 0032, e a ausência é a informação.
       *
       * A tabela que tinha este nome virou `promocoes_legado`, e o nome passou
       * para o motor de promoção novo — outra forma inteira. Manter o bloco
       * antigo seria exatamente o defeito que o cabeçalho deste arquivo nomeia:
       * um tipo que afirma com confiança colunas que o banco não tem mais.
       *
       * E o bloco NOVO não entra, pela regra que este arquivo já segue: nenhum
       * código do navegador consulta promoção — a vitrine recebe preço já
       * promocional do Express, e o painel fala com o Express também. Tipar
       * tabela sem leitor é manutenção sem leitor. Quando a primeira consulta
       * direta existir, a tabela entra ANTES dela.
       */

      /**
       * 0014. Avaliações de produto.
       *
       * `Insert` e `Update` são MAIS ESTREITOS que a tabela DE PROPÓSITO — o
       * mesmo espírito do `ItemParaFundir`: espelham os GRANTs de coluna da
       * migração, não o DDL. Mandar `status` ou `nome_exibicao` num INSERT
       * responde 42501 (o status nasce 'pendente' pelo DEFAULT e o nome é
       * congelado por trigger a partir de `clientes.nome`); o UPDATE só existe
       * para a moderação do admin (`status` + `moderado_em`, escritos juntos —
       * não há trigger de moddatetime neste schema). Com o tipo largo, esses
       * erros só apareceriam em produção, como recusa do PostgREST.
       */
      avaliacoes: {
        Row: {
          id: string;
          /**
           * FORA DO ALCANCE DO NAVEGADOR DESDE 0031, e o tipo não tem como
           * dizer isso: `authenticated` perdeu o SELECT desta coluna (ela
           * entregava o vínculo pessoa-compra a qualquer token da instância
           * compartilhada). Continua no `Row` porque o serviço, pelo
           * `service_role`, lê a tabela inteira — mas pedi-la daqui, na
           * projeção OU no filtro, responde 42501. Para "as minhas", use
           * `minhas_avaliacoes()`.
           */
          user_id: string | null;
          nome_exibicao: string;
          sku: string;
          nota: number;
          titulo: string | null;
          texto: string | null;
          status: "pendente" | "aprovada" | "oculta";
          criado_em: string;
          moderado_em: string | null;
        };
        Insert: {
          /** A política exige `user_id = auth.uid()` — sempre o uid da sessão. */
          user_id: string;
          sku: string;
          /** Inteiro de 1 a 5 (CHECK `avaliacoes_nota_valida`, 23514). */
          nota: number;
          /** Até 80 caracteres (23514 acima disso). */
          titulo?: string | null;
          /** Até 2000 caracteres (23514 acima disso). */
          texto?: string | null;
        };
        Update: {
          status?: "pendente" | "aprovada" | "oculta";
          moderado_em?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "avaliacoes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "clientes";
            referencedColumns: ["user_id"];
          },
        ];
      };

      /** 0005. Uma linha só: CHECK (id = 1) mais a chave primária. */
      config_loja: {
        Row: {
          id: number;
          banner_desktop: string | null;
          banner_mobile: string | null;
          titulo_site: string | null;
          whatsapp: string | null;
          barra_de_aviso: string | null;
          atualizado_em: string;
        };
        Insert: {
          id?: number;
          banner_desktop?: string | null;
          banner_mobile?: string | null;
          titulo_site?: string | null;
          whatsapp?: string | null;
          barra_de_aviso?: string | null;
          atualizado_em?: string;
        };
        Update: {
          id?: number;
          banner_desktop?: string | null;
          banner_mobile?: string | null;
          titulo_site?: string | null;
          whatsapp?: string | null;
          barra_de_aviso?: string | null;
          atualizado_em?: string;
        };
        Relationships: [];
      };
    };

    Views: {
      /**
       * 0003. O recorte que a chave anônima enxerga — projeção de `produtos`
       * SEM `custo`. Somente leitura: 0003 revoga INSERT/UPDATE/DELETE de
       * `authenticated`, então não há `Insert`/`Update` aqui.
       *
       * DIFERENÇA CONSCIENTE EM RELAÇÃO À CLI: `supabase gen types` marcaria
       * TODA coluna de view como nulável, porque `information_schema` reporta
       * `is_nullable = YES` para qualquer coluna de view. Aqui a nulabilidade
       * espelha a tabela base, que é o fato — `nome` NUNCA volta nulo desta
       * view. Se o arquivo for regerado um dia, a CLI vai afrouxar isto e
       * aparecer erro onde hoje não há; a decisão certa nesse dia é reapertar,
       * não espalhar `!` pelo código.
       */
      produtos_publicos: {
        Row: {
          produto_id: string;
          nome: string;
          tamanho: string | null;
          categoria: string | null;
          preco: number;
          imagem: string | null;
          quantidade: number;
          descricao: string | null;
          peso: number;
          largura: number;
          altura: number;
          comprimento: number;
          destacado_em: string;
          sku: string | null;
          /**
           * 0037. Entrou na projeção porque entrou no `WHERE` da view: com
           * `security_invoker = true`, o Postgres confere privilégio de COLUNA
           * sobre tudo que a consulta referencia, e sem `GRANT SELECT (estado)`
           * a vitrine inteira responderia 42501. A invariante que
           * `test/rls.test.js` afirma — "a lista pública de colunas de
           * `produtos` é EXATAMENTE a projeção da view" — é o que mantém as
           * duas listas juntas.
           *
           * A view já filtra `estado <> 'arquivado'`, então esta coluna nunca
           * volta 'arquivado' por aqui.
           */
          estado: "rascunho" | "ativo" | "arquivado";
        };
        Relationships: [];
      };

      /**
       * 0037. A janela estreita do SEGUNDO leitor da view pública.
       *
       * `produtos_publicos` passou a esconder o produto arquivado, e isso está
       * certo para a vitrine e ERRADO para `AvaliarPedido.tsx`, que usa a mesma
       * ponte `product_id -> sku` para montar o formulário de avaliação de quem
       * JÁ COMPROU. Arquivar um café não pode apagar em silêncio o formulário
       * de quem o recebeu — `canastra.pode_avaliar(sku)` não olha estado, e
       * quem recebeu avalia.
       *
       * Duas colunas e só elas, e `TO authenticated` apenas: `anon` não tem por
       * que enumerar SKU de produto arquivado. Somente leitura (0037 revoga
       * INSERT/UPDATE/DELETE).
       */
      produtos_sku: {
        Row: {
          produto_id: string;
          sku: string | null;
        };
        Relationships: [];
      };
    };

    Functions: {
      /**
       * 0007. Funde a sacola anônima na sacola da conta. Ver `ItemParaFundir`:
       * o tipo do argumento é o ponto inteiro deste arquivo.
       *
       * NÃO É IDEMPOTENTE e não tem como ser — a lista não carrega identidade.
       * Chamar duas vezes SOMA duas vezes. `onAuthStateChange` dispara mais de
       * uma vez por sessão (INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED), então
       * quem chamar precisa de trava própria e de apagar `localStorage["cart"]`
       * só depois da resposta. Tipo nenhum protege disso.
       */
      fundir_sacola: {
        Args: { itens: ItemParaFundir[] };
        Returns: undefined;
      };

      /** 0008. Cria a linha em `clientes` para o `auth.uid()` da sessão. */
      garantir_cliente: {
        Args: { nome: string; telefone?: string | null; cpf?: string | null };
        Returns: undefined;
      };

      /**
       * 0014. "O `auth.uid()` da sessão tem pedido `entregue` com este SKU?"
       * É a mesma pergunta que o WITH CHECK do INSERT em `avaliacoes` faz —
       * chamá-la antes só melhora a mensagem, nunca substitui a política.
       */
      pode_avaliar: {
        Args: { alvo_sku: string };
        Returns: boolean;
      };

      /** 0006. "Tem cadastro NESTA loja?" — não é o mesmo que estar logado. */
      eh_cliente: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };

      /** 0006. */
      eh_admin: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };

      /**
       * 0031. As avaliações do `auth.uid()` da sessão, em qualquer status.
       *
       * SUBSTITUI `.from("avaliacoes").eq("user_id", uid)`, que deixou de ser
       * possível quando 0031 tirou `user_id` do GRANT de `authenticated` —
       * filtro também é leitura, então aquela consulta responde 42501 hoje.
       *
       * SEM ARGUMENTO, e isso é a segurança e não um detalhe de assinatura:
       * uma versão que aceitasse um uid deixaria qualquer token da instância
       * compartilhada varrer uuids e ler as avaliações de quem quisesse. O
       * `Returns` também não traz `user_id` — quem chama já sabe o próprio.
       *
       * Já vem ordenada por `criado_em` decrescente (é `ORDER BY` de dentro da
       * função): `.order()` sobre o retorno de uma RPC não faz nada.
       */
      minhas_avaliacoes: {
        Args: Record<PropertyKey, never>;
        Returns: {
          id: string;
          sku: string;
          nota: number;
          titulo: string | null;
          texto: string | null;
          status: "pendente" | "aprovada" | "oculta";
          criado_em: string;
        }[];
      };
    };

    Enums: Record<PropertyKey, never>;
    CompositeTypes: Record<PropertyKey, never>;
  };
};

/** Atalhos para quem consome, no estilo do que a CLI gera. */
export type Tabelas<T extends keyof Database["canastra"]["Tables"]> =
  Database["canastra"]["Tables"][T]["Row"];
export type Visoes<T extends keyof Database["canastra"]["Views"]> =
  Database["canastra"]["Views"][T]["Row"];
