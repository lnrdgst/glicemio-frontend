# Unidade Fatia em refeições

Implementação local em 29/10/2026, sem commit, push, deploy ou alteração do backend.

## Comportamento e persistência

- `mealItemUnits` inclui o código exato `slice`; o formulário e `isMealItem` compartilham essa lista, assim como a validação de importação JSON. Não há restrição por alimento ou catálogo.
- O seletor mantém `Selecionar` primeiro e ordena os rótulos com `localeCompare(..., 'pt-BR')`: Fatia fica entre Colher de sopa e Grama (g).
- Os detalhes mostram `1 fatia`, `2 fatias` e `3 fatias`. A concordância também reconhece `1.000000` como singular, preservando todas as casas na apresentação. A comparação usa a string, sem `Number` ou arredondamento.
- Quantidades continuam strings decimais positivas com até 12 dígitos inteiros e seis fracionários. Não há equivalência presumida ou conversão para gramas, porções ou unidades.
- Edições mantêm UUID, `foodId`, nome consumido e `createdAt`; revisão e `updatedAt` avançam apenas nos itens alterados. Renomear o catálogo não reescreve o nome histórico. Itens omitidos de alterações permanecem intactos; exclusões lógicas continuam preservadas nos backups.
- Dexie permanece v3, com as mesmas tabelas e índices, sem callback de migração ou regravação de registros. O histórico continua listando tipo e horário da refeição e permite abrir seus alimentos pelos detalhes.

## Backup e exportação

O formato `glicoponto-backup` permanece v2 com nove coleções. `backup.ts` já valida itens por `isMealItem`, inclusive na revalidação transacional da restauração; ampliar a lista compartilhada atualiza esse caminho sem duplicar regras. Exportação integral e recorte desde a consulta com endocrinologista preservam `slice`, quantidade exata, metadados, vínculos, nomes históricos e itens excluídos logicamente.

O cliente atualizado continua lendo backups sem envelope, v1 e v2 anteriores. Nenhum registro é convertido ao abrir ou importar, e a restauração continua mesclando por UUID sem sobrescrever conflitos de alimentos/itens. A compatibilidade é de leitura dos arquivos antigos pelo cliente novo: clientes anteriores que não conhecem `slice` rejeitam itens com esse código, mesmo no envelope v2. Use o cliente atualizado para restaurar backups que contenham fatias.

## Impacto na futura integração REST

Verificação estática do checkout vizinho `../glicemio-backend`, sem executar a API ou alterar arquivos:

| Evidência local | Impacto |
| --- | --- |
| `src/main/java/br/com/glicemio/meals/Contracts.java`, enum `Unit` | Lista somente `g`, `kg`, `mg`, `mL`, `L`, `unit`, `portion`, `tsp`, `tbsp`, `cup`; `slice` não pertence ao contrato de criação/edição. |
| `src/main/resources/db/migration/V1__identity_and_meals.sql`, `ck_meal_item_unit` | A constraint aceita somente os códigos anteriores; incluir apenas o enum não basta para persistir fatias. |
| `src/main/java/br/com/glicemio/meals/DomainService.java` | Escrita usa `Unit.name()` e leitura usa `Unit.valueOf(...)`; todas as instâncias que leem/escrevem precisam reconhecer `slice`. |
| `Contracts.java`, quantidades `BigDecimal`, `@Digits(integer=12, fraction=6)` | Os limites coincidem com o modelo local; o futuro adaptador precisa serializar o decimal numérico sem passar por `Number` de JavaScript. |
| `docs/meals-domain.md`, tabela de unidades estáveis | A documentação ainda enumera somente as unidades anteriores. |

Portanto, inferindo desses contratos, enviar `unit: "slice"` ao backend atual não é compatível e deve resultar em rejeição de validação/desserialização; não foi feita chamada HTTP para confirmar o status em execução. Antes de habilitar sincronização, adicionar `slice` ao enum/contrato, aplicar uma **nova migration** que amplie `ck_meal_item_unit` preservando os códigos existentes e testar criação, edição, leitura e restrição SQL. Não editar apenas V1 em um banco já migrado. Atualizar a documentação e coordenar versões dos consumidores da API.

Um adaptador futuro deve manter os itens em fatias pendentes localmente se o servidor não suportar o código, explicando o impedimento sem descartá-los ou convertê-los. A integração deverá também preservar nomes consumidos e UUIDs, tratar revisões remotas separadamente e respeitar as diferenças de formato já documentadas no README. Este frontend continua operando somente em Dexie, sem cliente REST, outbox ou sincronização implementados nesta entrega.

## Validação automatizada

- Seleção com Fatia na posição alfabética e preservação dos códigos anteriores.
- Cadastro pela interface de Ricota (`1`), Goiabada (`2`), Melancia (`3`) e outro alimento (`999999999999,999999`), todos com `slice`.
- Acesso pelo Histórico, exibição nos detalhes e reabertura após exportação/restauração v2 integral.
- Edição de unidade anterior para fatias sem alterar quantidade, e edição de quantidade em fatias para `1.234567`, preservando nome consumido distinto do catálogo, UUIDs, vínculos, horários e itens não alterados.
- Restauração de v2 anterior com todas as dez unidades antigas junto de fatias locais, sem regravação dos registros existentes; manutenção da cobertura legada/v1.
- Preservação de fatias excluídas logicamente, decimal mínimo e nome histórico em backup.
- Exportação desde a consulta e restauração do recorte com fatias e decimal máximo, sem escrita na base de origem.
- Concordância singular/plural, zeros fracionários e extremos sem perda de precisão; rejeição de aliases e capitalizações inválidas.

Resultados dos comandos:

- `npm.cmd run build`: aprovado, saída 0, incluindo geração da PWA/service worker. Mantém o aviso já conhecido de chunk acima de 500 kB; houve também aviso de duração dos callbacks do build.
- Conjunto direcionado inicial (seis arquivos): 124 testes aprovados. Depois foram acrescentados cinco casos de rejeição de aliases, cobertos na execução completa.
- `npm.cmd test -- --maxWorkers=2`: 488 aprovados e quatro falhas em testes de outras telas, incluindo timeouts. A execução sem limite de processos foi interrompida após apresentar vários timeouts.
- `npm.cmd test -- --maxWorkers=1`: 491 aprovados e uma falha entre 492 testes, em 31 arquivos. Todos os casos de fatias e compatibilidade passaram. O único erro foi o timeout de `findByRole` ao aguardar o link “Resumo glicêmico de hoje” no primeiro caso de `HomeTodayReport.test.tsx`.
- `npm.cmd test -- src/HomeTodayReport.test.tsx --maxWorkers=1`: os dez testes passaram, incluindo o caso acima, sem alteração de código ou aumento de timeout. A oscilação indica sensibilidade de tempo no ambiente; não houve uma execução completa sem falhas e não se afirma que a causa tenha sido comprovada.
- `git diff --check`: aprovado, saída 0; avisos de normalização futura LF/CRLF não são erros de whitespace.

Os testes de interface usam Testing Library/jsdom e IndexedDB sintético; avisos de `scrollTo` não implementado vêm desse ambiente. Não foi realizada validação manual em navegador ou Android, nem acesso aos dados reais da PWA.

## Arquivos alterados

- `src/database/db.ts`: código e tipo compartilhado de unidade, usados nas validações locais e do backup.
- `src/shared/meals.ts`: rótulo, ordenação existente e apresentação de quantidade com concordância.
- `src/MealItemsSummary.tsx`: apresentação dos consumos nos detalhes.
- `src/shared/meals.test.ts` (novo), `src/MealRefinements.test.tsx`, `src/StructuredMealForm.test.tsx`, `src/database/structuredMeals.test.ts`, `src/database/structuredBackup.test.ts`, `src/database/appointmentExport.test.ts`: cobertura funcional e de compatibilidade.
- `README.md` e `docs/meal-slice-review.md` (novo): comportamento, compatibilidade e impacto REST.
