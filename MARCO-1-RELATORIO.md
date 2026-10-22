# Glicemio — Marco 1

Implementação e verificações automatizadas em 14/10/2026. A validação manual móvel permanece pendente; a entrega ainda não tem aceite completo de responsividade.

## Diagnóstico de salvamento

Os quatro formulários compartilhavam `stamp()`, que chamava `crypto.randomUUID()` incondicionalmente. A ausência dessa API reproduziu `TypeError: crypto.randomUUID is not a function`, antes de qualquer escrita no Dexie. O onboarding não passava por essa função, pois usa o ID fixo `local`. Isso explica um cenário em que o cadastro inicial funciona e os quatro registros falham juntos.

Os handlers não tinham tratamento de exceções, bloqueio de submissões concorrentes ou feedback de erro. A conversão de data também ficava fora de qualquer tratamento. Valores inválidos de glicemia/dose podiam simplesmente retornar sem mensagem.

Correções: UUID v4 com bytes de `getRandomValues()` quando `randomUUID()` não estiver disponível; validação de data local; tratamento de erros; dados preenchidos mantidos para nova tentativa; bloqueio síncrono por referência e campos desabilitados durante a gravação. A navegação e o sucesso ocorrem depois do `await` da escrita. Home e Histórico consultam o Dexie reativamente.

O teste de regressão da geração de IDs falhou antes da correção e passou depois. A causa reproduzida é compatível com o relato, mas não houve acesso ao console do celular original para confirmar qual exceção ocorreu naquele dispositivo.

## Persistência e integridade

- Dexie versão 2 acrescenta somente o índice `medicationKey` à tabela `insulin`.
- Os campos opcionais `medicationId`, `medicationName` e `medicationKey` identificam o medicamento; `workoutActivities` guarda modalidades opcionais no perfil.
- A versão 1 foi mantida na declaração do banco. A migração não limpa tabelas, recria o banco ou reescreve registros.
- Um teste criou um banco versão 1 isolado, aplicou a versão 2 e comparou integralmente todas as sete tabelas. Dose, horário, vínculos, notas, campos extras de treinos e insulinas sem identificação foram preservados.
- Os testes recuperam os quatro tipos de registros usando uma nova conexão. Isso verifica armazenamento persistido em IndexedDB simulado; recarga em navegador real continua pendente.
- Os testes usam `fake-indexeddb` e banco `glicoponto-tests`. O nome pode ser explicitamente configurado por `VITE_DB_NAME` para QA. O padrão de produção continua `glicoponto`.
- Nenhum banco real do usuário foi aberto, limpo ou alterado durante as verificações.

## Comportamento implementado

**Glicemia:** busca a refeição mais recente nas três horas anteriores ao horário efetivo, incluindo o limite de três horas. Usa inicialmente “Após refeição” ou “Não informado”. Jejum é exclusivamente manual. A sugestão é recalculada quando o horário muda; a confirmação da associação é revogada nessa mudança. O checkbox opcional permite salvar sem associação. Uma escolha manual de contexto permanece editável e não é sobrescrita pela sugestão.

**Refeição:** mantém tipo, data/hora e descrição, com o tratamento de persistência compartilhado.

**Insulina:** catálogo estático tipado com dez medicamentos e classes farmacológicas, filtrado por categoria, incluindo Outra com nome livre e identidade normalizada. Não inclui misturas. Registros antigos sem nome continuam aparecendo. A Home exibe separadamente os últimos registros basal e rápido pelo horário efetivo, com identificação quando disponível, dose e data/hora reais. A dose começa vazia. Selecionar um medicamento mostra seu histórico; “Reaproveitar dose histórica” preenche somente a dose e exige confirmação da quantidade aplicada. Trocar medicamento limpa dose e confirmação. A data/hora da nova aplicação continua atual e editável. A basal não oferece vínculo com refeição; trocar a categoria remove o vínculo pendente sem alterar aplicações antigas. Não há cálculos ou recomendações terapêuticas.

**Treino:** sugestões do histórico e do perfil, busca sem distinção de caixa ou acentos, deduplicação e limpeza de espaços. Nomes canônicos privilegiam apresentação legível, sem alterar registros antigos. Permite atividade nova, seleção por mouse e teclado. Datas começam em hoje e horas vazias. Início obrigatório, término opcional, validação da ordem cronológica, duração e travessia de meia-noite. “Iniciar agora” preenche explicitamente o horário atual.

**Perfil e regressões:** modalidades opcionais disponíveis no onboarding e em Mais > Perfil. Edição explícita salva nome, diagnóstico e modalidades preservando a criação do perfil. Falha de leitura do armazenamento não é confundida com ausência de perfil. Episódios têm feedback e proteção de salvamento; sintomas podem ser desmarcados. Consultas, relatórios, exportação JSON e exclusão confirmada foram cobertos por regressões automatizadas.

## Responsividade

Correções de código: documento HTML com idioma, charset e viewport; navegação flexível em vez de quatro itens com mínimo de 82 px; campos com largura limitada e `min-width: 0`; quebra de texto e linhas flexíveis; ações de sintomas e privacidade com quebra; datas/horas do treino em uma coluna até 420 px; onboarding com seção limitada ao contêiner. A identidade visual foi preservada, sem reorganizar a Home nem ocultar conteúdo relevante para conter overflow.

**320, 360 e 390 px não foram validados visualmente.** O navegador integrado e o conector Chrome não estavam disponíveis. A tentativa de usar Chrome nativo foi interrompida pela ferramenta de Computer Use: ela não conseguiu determinar a URL atual com confiança suficiente para aplicar sua política. Nenhuma ação adicional de navegador foi realizada após a interrupção. Não houve validação em Chrome Android físico.

Para finalizar o aceite, validar em cada largura: onboarding, Home, glicemia, refeição, insulina, treino, consultas, sintomas, Mais/Perfil, Histórico, Relatório e navegação inferior. Verificar ausência de scroll horizontal/cortes, controles nativos de data/hora, teclado e seleção de sugestões. Em banco de QA separado, salvar cada tipo, recarregar a página e confirmar valores e vínculos no Histórico.

## Testes e comandos

- `npm.cmd run build`: aprovado, TypeScript e build de produção.
- `npm.cmd test`: 59 testes aprovados em 6 arquivos, sem falhas na execução final.
- Não há script de lint configurado em `package.json`.
- Execuções intermediárias revelaram problemas nos testes novos (alvo incorreto de mock de tabela, espera da atualização reativa e tipagem de promises) e corrupção de acentos na edição por pipe do PowerShell. Os problemas foram corrigidos; nenhum teste foi removido para obter aprovação.

Cobertura: quatro salvamentos e falhas com nova tentativa, recuperação em nova conexão, bloqueio de submissão dupla e sucesso após escrita, IDs sem `randomUUID`, datas inválidas, janela de refeições e contexto manual, associação aceita/ignorada, catálogo e Outra, histórico de dose da mesma insulina e confirmação, troca de medicamento/categoria, vínculos opcionais, dados reais na Home, sugestões e equivalências de atividades, horários vazios, início obrigatório, término opcional/inválido, meia-noite, migração integral, perfil, episódios, consultas, relatório, exportação e exclusão confirmada.

## Arquivos

Modificados: `src/App.tsx`, `src/database/db.ts`, `src/database/db.test.ts`, `src/shared/format.ts`, `src/styles.css`, `index.html`.

Adicionados: `src/RecordForm.tsx`, `src/ProfileForm.tsx`, `src/shared/ui.tsx`, `src/shared/records.ts`, `src/vite-env.d.ts`, `src/database/id.test.ts`, `src/RecordForm.test.tsx`, `src/Regression.test.tsx`, `src/shared/records.test.ts` e este relatório. O build também gera `dist/` e atualiza `tsconfig.tsbuildinfo`.

## Limitações e riscos

O aceite móvel e a recarga real no navegador permanecem pendentes pelo bloqueio da automação. Dados reais não foram inspecionados, portanto a comparação de integridade comprova a migração das estruturas legadas representadas nos testes, não uma auditoria do banco do dispositivo do usuário. Não foi identificada operação destrutiva na migração implementada.

Nenhuma alteração foi feita no backend, integração de IA, autenticação ou sincronização. Não houve commit nem push. O workspace fornecido não contém repositório Git reconhecido; nenhuma operação de versionamento foi realizada.
