# Estrutura e decisões

O WZY usa um monólito modular em Next.js e PostgreSQL. O objetivo é manter uma implantação simples e limites claros entre jornadas, leitura financeira e operações que alteram dinheiro. Não há necessidade de microserviços para o volume atual.

| Camada | Responsabilidade |
|---|---|
| `app/features` | Jornadas por assunto: contas, faturas, investimentos, grupos, lançamentos e cofre |
| `app/ui`, estilos | Diálogos acessíveis, navegação e componentes de apresentação |
| `lib/domain` | Cálculos puros, centavos inteiros, parcelas, ciclos, quantidades fracionárias e restauração |
| `lib/modules` | Casos de uso com autorização, transações e validação |
| `lib/modules/records/read-model.ts` | Resumos completos no servidor e paginação por cursor |
| `lib/database-context.ts` | Identidade do proprietário ou rotina de sistema propagada por requisição |
| `db/vercel-schema.sql`, `db/migrations` | Esquema PostgreSQL canônico, migrações com versão e checksum |
| `scripts/verify-*` | Verificações fora do runtime; usuários fictícios em esquema temporário |

Os arquivos `components.tsx` e `views.tsx` preservam exports antigos durante a divisão em módulos. O modelo Drizzle é uma projeção tipada parcial; não deve gerar ou substituir automaticamente o esquema canônico. Migrações novas são SQL revisado, criadas por `npm run db:generate -- nome_da_mudanca` e aplicadas por `npm run db:migrate`.

Dinheiro usa centavos inteiros com limites explícitos. Quantidades de investimentos usam oito casas e cálculo intermediário com BigInt. Transferências não são receitas ou consumo; compra e venda de ativos separam principal, taxas e rendimentos. Correções preservam a operação original.

Faturas congelam o ciclo ao fechar e exigem ajustes ou estornos posteriores. Dívidas e recorrências têm pagamento único por vencimento. Solicitações repetíveis usam identificadores estáveis; edições usam versão e rejeitam alterações concorrentes. O banco também protege os movimentos gerenciados e preserva revisões.

O banco executa as consultas financeiras com um papel sem login e sem bypass de RLS. As tabelas de finanças verificam o proprietário no próprio PostgreSQL. Convites de grupos concedem acesso apenas ao grupo e ao participante aceito, sem expor contas bancárias do titular.

O painel recebe entidades, até 100 lançamentos recentes e agregações completas. A listagem possui páginas de 50 registros. Exportações buscam todas as páginas do período; os totais não dependem da página visível. Carteiras estrangeiras exibem conversão datada, com fallback identificado quando a cotação falha.

O cofre offline é explícito: senha local separada, IndexedDB criptografado, fila persistida após cada envio e conflitos preservados para revisão. A troca de usuário bloqueia sincronização. Ele não promete atualizações bancárias offline nem desbloqueio sem a senha local.

O assistente consulta regras e agregações locais. O preço de ativos é informado pelo usuário; a tela identifica a fonte e a data. Open Finance segue adiado.

Próximos limites de escala devem ser decididos por medições: retenção e tamanho das revisões, tamanho das exportações e limites de armazenamento. Não particionar o sistema ou contratar serviços antes de identificar uma necessidade medida.
