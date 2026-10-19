# Interface WZY

Identidade: cavalo WZY, carvão no tema escuro, superfícies claras no tema diurno, verde como destaque. Sidebar e cartões mantêm frosted glass com borda, transparência e contraste definidos por tokens em `app/design-tokens.css`. Os estilos anteriores ficam como base de compatibilidade; novos componentes usam os mesmos tokens.

Cada tela deve explicar o próximo passo, oferecer estado vazio útil, carregamento perceptível e erro com recuperação. O primeiro lançamento pode criar a conta financeira sem abandonar os campos preenchidos. A palavra “conta” precisa indicar se significa acesso ao WZY ou onde o dinheiro está.

A navegação respeita ordem e favoritos salvos por usuário, inclui busca e rótulos por tarefa. URLs guardam página, mês e seção quando disponíveis. Abas respondem a setas, Home e End. Diálogos têm foco contido, Escape, retorno do foco e restauração da rolagem.

Transições preservam continuidade e não atrasam gravações financeiras. Respeitar `prefers-reduced-motion` e `prefers-reduced-transparency`. Carregamentos usam skeleton/shimmer e ripple nas cores do sistema. Não preencher telas com dados fictícios quando a sessão real falhar.

Aceitação visual: 390 e 412 px, desktop de 1440 px, temas claro/escuro, zoom, teclado, conteúdo longo, tela administrativa e modal rolável. Automação verifica parte desses estados; testes em aparelhos físicos e leitores de tela continuam necessários.
