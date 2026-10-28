# Comparecimento e exportação endocrinológica — revisão local

Implementação de comparecimento e exportação endocrinológica, com revisão funcional e visual aprovada pelo usuário e publicação autorizada em 28/10/2026. Sem mudanças de backend, autenticação ou sincronização. Dados reais não foram acessados ou alterados na validação.

## Persistência e confirmação

- `Appointment.attendanceConfirmed?: boolean`, sem alteração de schema, índice ou migration: Dexie v3.
- Somente `true` confirma comparecimento; campo ausente ou `false` não presume ausência.
- Confirmação em transação, com revalidação de conteúdo e bloqueio de consulta futura/inválida. Repetição é idempotente.
- UUID, `at`, `createdAt`, observações, campos legados e demais conteúdos são preservados; somente estado e `updatedAt` mudam.
- Edição da consulta usa snapshot para detectar concorrência, preserva a string original de `at` quando a data/hora não foi alterada e mantém observações importadas. Horário de consulta confirmada exige reversão prévia.

## Home, detalhes e Histórico

- Reutiliza `.home-notices`, depois dos avisos existentes; não cria cartão permanente nem suprime outros lembretes.
- Antes do horário, mantém antecedência e seleção do lembrete existente. No horário exato, a consulta passa a ser elegível à pergunta contextual.
- Uma pergunta por vez: consulta pendente mais recente com `0 <= agora - at < 48 horas`.
- **Compareci** confirma diretamente; **Agora não** adia por 24 horas. Nenhuma das ações inicia exportação.
- Após agir, não há encadeamento imediato de perguntas anteriores naquela abertura. Novas consultas que chegarem ao horário continuam elegíveis.
- Adiamento em `localStorage`, por ID e instante agendado, separado da informação clínica e do backup. Mudança de horário invalida o adiamento. Falha de armazenamento mantém o adiamento em memória e informa sua limitação.
- Relógio local reavalia em até 30 segundos, no horário da consulta, à meia-noite e na retomada da PWA. As regras de antecedência não mudam.
- Histórico mostra Agendada, Comparecimento não confirmado ou Comparecimento confirmado. Seus links abrem detalhes com confirmação retroativa e reversão por diálogo com confirmação explícita.

## Exportação manual

- Backup completo permanece sem filtro, com todas as nove coleções.
- Referências parciais exigem exatamente `attendanceType === 'endocrinologist'`, `attendanceConfirmed === true`, `at` finito e `at <= exportedAt`.
- Ordenação decrescente pelo instante de `at`, com desempate estável por ID. Nunca usa criação, atualização ou instante do clique.
- Não interpreta textos de apresentação ou de “Outro”. Outras especialidades continuam confirmáveis, mas nunca viram referência automática ou alternativa deste recorte.
- Painel mostra referência e período, permite outra endocrinológica elegível e não contém campos de datas. Revalida a referência no snapshot da geração; alterações não provocam fallback silencioso.
- Período inclusivo: meia-noite no calendário local do dispositivo até o instante da geração, que também é `exportedAt`. Não reconstrói um fuso histórico que o cadastro não armazena.
- Sem referência elegível, explica o motivo e mantém backup completo disponível. Sem registros clínicos, informa a condição sem contar perfil ou consultas como medições.
- Arquivo distinto: `glicemio-endocrinologista-desde-AAAA-MM-DD.json`. O painel distingue análise por período de backup integral.

## Relações e compatibilidade

- Glicemias, refeições, insulinas e consultas por `at`.
- Treinos/episódios por sobreposição: início até o limite superior e término a partir do inferior. Sem término, inclusão conservadora, sem inventar encerramento; intervalos inválidos bloqueiam a geração.
- Glicemias/insulinas trazem refeições referenciadas; glicemias trazem episódios referenciados, mesmo anteriores ao período.
- Refeições incluídas trazem todos os seus itens, inclusive removidos logicamente; itens trazem alimentos referenciados, inclusive arquivados. Perfil existente é incluído integralmente.
- Deduplique pela seleção de IDs em conjuntos, sem reconstruir os registros. Não arrasta outras glicemias/insulinas apenas por compartilharem um pai.
- Leitura consistente por `exportBackup()` transacional, seguida de recorte em memória. Validação estrutural pelo importador e referencial no próprio conjunto exportado, sem depender da base de destino.
- Formato `glicoponto-backup`, versão 2, nove arrays. Validação adicional somente para o booleano opcional. Legado/v1/v2 sem campo continuam válidos; não atribui confirmação.
- Estratégia de importação inalterada: UUIDs clínicos conflitantes preservam o registro local; alimentos/itens conflitantes bloqueiam; perfil continua com estratégia explícita; restauração revalida e faz rollback.
- Classificação temporal das refeições continua recebendo exclusivamente o backup completo.

## Arquivos

Produção:

- `src/database/db.ts`: tipo opcional.
- `src/database/backup.ts`: validação do booleano.
- `src/database/appointments.ts`: confirmação/reversão e edição transacional.
- `src/database/appointmentExport.ts`: recorte, dependências e validação autossuficiente.
- `src/shared/appointments.ts`: estado, especialidade estruturada, seleção e período.
- `src/AppointmentAttendance.tsx`: Home e detalhes.
- `src/EndocrinologyExport.tsx`: painel de exportação.
- `src/shared/downloadBackup.ts`: download JSON compartilhado.
- `src/App.tsx`: integração na Home, Histórico, detalhes e backup.
- `src/RecordForm.tsx`: preservação de horários e bloqueio de reagendamento confirmado.
- `src/shared/useLocalClock.ts`: fronteira temporal opcional.
- `src/shared/ConfirmDialog.tsx`: textos configuráveis, mantendo padrões de exclusão.
- `src/styles.css`: integração visual responsiva.

Testes: `src/database/appointments.test.ts`, `src/database/appointmentExport.test.ts`, `src/AppointmentAttendance.test.tsx`, `src/EndocrinologyExport.test.tsx`, `src/shared/useLocalClock.test.tsx` e `src/Regression.test.tsx`.

## Validação

- `npm.cmd run build`: passou. Aviso de bundle maior que 500 kB permanece.
- `npm.cmd test -- --maxWorkers=2`: 472 testes passaram em 30 arquivos. Avisos do jsdom sobre `scrollTo` não representam falhas.
- `git diff --check`: passou.
- Chrome 155 isolado, banco `glicemio-appointments-qa`, somente fixtures sintéticas: Home, exportação e diálogo de reversão em 320, 360, 390 e 412 px, sem overflow horizontal, com ações de pelo menos 44 px. Confirmou coexistência dos cinco avisos, preservação de `at`/observação e download v2 com a referência endocrinológica esperada, sem exceções não tratadas.
- Evidências locais ignoradas pelo Git: `.qa-meals.local/appointments-results.json`, `appointments-home-*.png`, `appointments-export-*.png`, `appointments-undo-*.png`, `appointments-build.log` e `appointments-tests.log`.
- Testes cobrem limites temporais, adiamento, retomada, concorrência, toque duplo, reversão, preservação literal, especialidade estruturada, escolha da referência, ausência de novas medições, dependências e restauração de recorte em base sintética vazia, backups anteriores e regressões existentes.

O usuário concluiu os testes manuais e aprovou a confirmação na Home, o adiamento, a confirmação retroativa e reversão nos detalhes, a exportação desde a última endocrinológica confirmada, a seleção de outra referência e a preservação do backup completo. Publicação autorizada em 28/10/2026, mediante nova execução de build, suíte completa e conferência do diff. O push normal em `origin/main` aciona o deploy automático existente no Vercel.
