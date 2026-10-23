# Refinamento das refeições — validação e publicação

Os commits `7604808` e `451b17c` permanecem intactos. O usuário concluiu e aprovou os testes manuais no Android e autorizou o commit dos refinamentos e a publicação dos três commits em `origin/main`. Não há envio de registros ao backend. Os testes usam exclusivamente dados sintéticos em `fake-indexeddb`; não foi aberto nem saneado o armazenamento real da PWA.

## Resultado técnico — 23/10/2026

- `npm.cmd run build`: aprovado; permanece o aviso de chunk acima de 500 kB.
- `npm.cmd test`: **404 testes aprovados em 22 arquivos**.
- `git diff --check`: aprovado, sem erros de whitespace. Git informa apenas a normalização futura de LF para CRLF em alguns arquivos.
- Cobertura: teclado próprio/físico/colagem, decimais e unidades, catálogo automático e ambiguidade, repetição/concorrência, rollback de salvamento/exclusão, preservação do catálogo e histórico, bloqueios clínicos antes/depois da prévia, formulários desatualizados, filtros/paginação, relatório, lembretes, classificação temporal, backup v2 e compatibilidade legada.
- Os avisos de `scrollTo` não implementado são do jsdom e não causaram falhas. O polyfill do dialog permite testar foco/estrutura; não equivale a validar a top layer, teclado ou layout reais do Android.
- 33 arquivos nesta rodada (24 modificados e 9 novos), listados ao final, para consolidação no commit de refinamentos aprovado. Os dois commits anteriores não são reescritos.

## Persistência e compatibilidade

`Meal.deletedAt` é um metadado opcional, sem índice novo. O banco continua Dexie v3, com o mesmo nome e tabelas. Não existe upgrade que percorra ou reescreva refeições antigas. Ausência de `deletedAt` significa registro ativo. `at`, `timeReference`, UUIDs, criação e descrição continuam preservados.

O backup continua v2 e inclui tanto ativos quanto excluídos. A extensão é aditiva: o serializador anterior já preservava campos adicionais. A importação agora valida `deletedAt` entre criação e atualização, mantém as referências dos itens excluídos e rejeita consumos ativos ou registros clínicos associados a uma refeição excluída. Backups legados/v1 continuam suportados. A restauração é aditiva, mantém conflitos explícitos e não usa um backup antigo para ressuscitar um UUID já excluído localmente.

Não é necessária migração de esquema ou de formato nesta rodada. **Clientes anteriores a este refinamento não filtram `Meal.deletedAt` e podem reapresentar refeições excluídas.** A restauração de backups com esse metadado deve usar o cliente atualizado; não existe garantia de comportamento de versões antigas. Não há limpeza automática de órfãos preexistentes.

## Quantidade e unidades

Foi investigado o formulário e não havia teclado próprio reutilizável. `MealQuantityInput` é usado somente na quantidade de alimentos. Mantém uma string, dispõe de dígitos, vírgula, apagar, limpar e concluir. O teclado próprio impede exceder 12 dígitos inteiros, seis casas ou inserir outro separador. Entrada física e colagem preservam vírgula ou ponto; valores inválidos não são arredondados, e a persistência sempre os valida. `inputMode="none"` evita solicitar o teclado nativo do Android, sem `readOnly` que impediria teclado físico/colagem.

Enquanto o teclado está aberto, quantidade e unidade se empilham para dar largura às teclas. O fechamento recompõe a grade. As unidades são ordenadas por rótulo com `localeCompare(..., 'pt-BR')`; `Selecionar` continua primeiro e todos os códigos REST permanecem iguais.

## Catálogo automático

O autosuggest mantém pesquisa sem distinção de caixa ou acentos, seleção por teclado e toque e nenhuma sugestão de quantidade. Não exige mais a ação Cadastrar. Ao salvar, a resolução do catálogo e todas as escritas estão na mesma transação de refeição e itens.

- Uma escolha explícita conserva o UUID selecionado.
- A correspondência automática usa nome exato após normalizar espaços, caixa e Unicode NFC. **Acentos são preservados nessa resolução**, evitando fundir nomes distintos apenas por semelhança. A busca das sugestões continua mais flexível.
- Uma correspondência ativa única é reutilizada; nenhuma cria um alimento; mais de uma exige selecionar uma sugestão, sem adivinhar identidade.
- Linhas com o mesmo nome exato e salvamentos concorrentes reutilizam um só cadastro. Repetir o salvamento do mesmo UUID não cria duplicatas.
- Alimentos arquivados não são reativados automaticamente. Um novo consumo pode criar outro cadastro ativo com esse nome.
- Correção de quantidade em um item histórico mantém nome, UUID e `foodId`, inclusive a ausência de vínculo antigo. Não se convertem descrições nem registros antigos automaticamente.
- Falhas de validação ou persistência revertem inclusive alimentos recém-criados e mantêm o rascunho.

## Exclusão e consultas

A exclusão marca a refeição e seus itens ativos com `deletedAt`/`updatedAt` na mesma transação. Nos itens ativos a revisão avança uma vez; itens já excluídos são mantidos literalmente. Repetir a exclusão não altera os metadados novamente. Nenhum `Food` é alterado, e os UUIDs/referências permanecem no backup.

Glicemias e insulinas vinculadas continuam bloqueando a operação. O bloqueio é apresentado antes da confirmação quando possível e repetido dentro da transação final. A gravação de uma nova associação clínica também confere a disponibilidade da refeição em transação com a tabela clínica, para não associar um formulário desatualizado a uma refeição excluída.

Home e histórico filtram excluídas **antes** de aplicar limites/paginação. Relatório, associações, contexto glicêmico, lembrete, detalhes, edição e prévia de classificação temporal respeitam o metadado. A classificação existente continua exigindo prévia, backup e confirmação e não muda seu procedimento.

O tipo, data/hora e referência temporal compartilham o componente `MealRecordInfo`. Separadores discretos organizam as listagens, com rosa preservado. O modal nativo abre na top layer, fora do grupo Editar/Excluir; o navegador torna o fundo inerte. Há foco inicial em Cancelar, contenção de Tab, Escape, retorno do foco e bloqueio de fechamento durante a gravação.

## Impacto futuro no backend

O contrato atual de `glicemio-backend/docs/meals-domain.md` bloqueia DELETE de refeição enquanto houver itens ativos ou glicemias ativas. A decisão local está compatível com sua integridade conceitual, mas **não corresponde a um único DELETE REST**: a futura integração precisará excluir logicamente os itens antes da refeição, usando as revisões remotas atuais e tratando falhas parciais/conflitos. Não se presume atomicidade entre chamadas REST nem um endpoint em lote inexistente.

`Meal.deletedAt` local não é um DTO de PUT; DELETE remoto gera seus próprios metadados e exige revisão. O frontend ainda não possui revisão remota de refeições, outbox, autenticação ou sincronização. A política de insulinas não está definida nesse domínio REST e requer revisão própria. Nada disso foi implementado nesta rodada e nenhum arquivo de backend foi modificado.

## Proposta: Ajustes → Meus alimentos (não implementada)

Em Ajustes, um acesso para uma tela própria, com título Meus alimentos, busca e lista ordenada em português. A visualização inicial mostra ativos; um filtro permite consultar arquivados em modo somente leitura. Cada alimento ativo mostra nome e ações Renomear/Arquivar, com menu acessível e confirmação de arquivamento. Nomes longos quebram sem deslocar botões; estados vazio, sem resultados e falha local são explícitos.

Renomear usa `saveFood` com snapshot/revisão atual, validação do nome e apresentação de possíveis homônimos. Arquivar usa exclusão lógica com revisão crescente. Ambas alteram somente o catálogo, nunca `MealItem.foodName`. Não há exclusão física nem conversão dos consumos. Alimentos arquivados deixam de aparecer nas sugestões e continuam preservados nos itens e backups.

Impacto estimado: pequeno a moderado — uma rota/tela, acesso em Ajustes, busca local, formulário de renomeação e confirmação de arquivamento, mais testes de conflitos e preservação histórica. Reutiliza Dexie v3, `saveFood`, modal e backup v2; não exige migração, API ou nova tabela. Reativação de arquivados e fusão de cadastros não entram nessa proposta inicial. A implementação fica para uma etapa separada.

## Aprovação manual e checklist de regressão

Não foi executada automação que controle o navegador ou a máquina. jsdom testa estrutura, foco e interações, mas não calcula layout real nem emula teclado Android/top layer.

O usuário informou a conclusão e aprovação da validação visual e funcional no Android. Para futuras regressões, manter o checklist em 320, 360, 390 e 412 px: cadastro e edição com vários alimentos e nomes de 200 caracteres; seleção e rolagem de sugestões com teclado virtual; quantidade com teclado próprio, físico e colagem; abrir/fechar teclado sem sobreposição nativa; opções longas de unidade; adicionar/remover; alcançar Salvar e Voltar; rolagem sem overflow; detalhes e separadores; modal com texto longo, fundo realmente inerte, Cancelar/Confirmar e foco após fechamento; funcionamento offline e reabertura da PWA. A publicação foi autorizada sem alterações funcionais adicionais.

## Inventário dos arquivos da rodada

Interface e apresentação:

- `src/App.tsx`
- `src/MealRecordForm.tsx`
- `src/MealItemsEditor.tsx`
- `src/MealItemsSummary.tsx`
- `src/RecordForm.tsx`
- `src/shared/FoodInput.tsx`
- `src/shared/MealQuantityInput.tsx` (novo)
- `src/shared/ConfirmDialog.tsx` (novo)
- `src/shared/MealRecordInfo.tsx` (novo)
- `src/styles.css`

Persistência e regras:

- `src/database/db.ts`
- `src/database/backup.ts`
- `src/database/mealForm.ts`
- `src/database/structuredMeals.ts`
- `src/database/mealTimeReference.ts`
- `src/shared/meals.ts`
- `src/shared/records.ts`
- `src/shared/postMealReminder.ts`

Testes e configuração:

- `src/HistoryReport.test.tsx`
- `src/RecordForm.test.tsx`
- `src/Regression.test.tsx`
- `src/StructuredMealForm.test.tsx`
- `src/database/mealDeletion.test.ts`
- `src/database/mealForm.test.ts` (novo)
- `src/MealRefinements.test.tsx` (novo)
- `src/shared/MealQuantityInput.test.tsx` (novo)
- `src/shared/ConfirmDialog.test.tsx` (novo)
- `src/shared/records.test.ts`
- `src/shared/postMealReminder.test.ts`
- `vitest.config.ts`
- `src/testSetup.ts` (novo; apenas polyfill do dialog no jsdom)

Documentação:

- `README.md`
- `docs/meals-refinement-review.md` (novo)
