# Glicemio

Frontend da PWA Glicemio (`glicemio-frontend`), anteriormente chamada Glicoponto.

## Identidade da PWA e compatibilidade

O manifest é gerado pelo `vite-plugin-pwa` em `/manifest.webmanifest`. `name` e `short_name` passam a `Glicemio`, assim como o título HTML e a marca na Home e no cadastro inicial.

O manifest continua **sem `id` explícito**, com `start_url: '/'`, `scope: '/'` e `display: 'standalone'`. Não foi criado um identificador com a nova marca. O caminho do manifest, os ícones (incluindo os arquivos `*-v2.png`), o registro em `/sw.js` e a política `registerType: 'prompt'` foram mantidos. Preservar as URLs e a mesma origem permite manter a identidade instalada, conforme a [documentação do Chrome sobre identidade da PWA](https://developer.chrome.com/docs/capabilities/pwa-manifest-id).

Referências técnicas ao nome anterior permanecem intencionalmente:

- Banco de produção `glicoponto`, configuração `VITE_DB_NAME`, classe `GlicopontoDB`, declarações históricas Dexie 1 e 2, tabelas, IDs e relacionamentos. A versão 3 acrescenta somente `foods` e `mealItems`.
- Bancos isolados de testes `glicoponto-tests` e `glicoponto-migration-test-*`.
- Chaves `glicoponto-basal-reminder` e `glicoponto-report-period` para preservar preferências existentes.
- Identificador JSON `glicoponto-backup`. A exportação atual é versão 2; importações legadas e versão 1 continuam aceitas. O nome sugerido para download é `glicemio-backup.json`.
- Arquivo de imagem `public/icone-glicoponto.png`, preservado junto dos demais ícones.

Esta alteração não limpa armazenamento nem modifica registros. Dados locais pertencem à origem: trocar o domínio não compartilha IndexedDB ou preferências com a origem anterior. Mudança de domínio e migração de dados ficam fora desta alteração.

## Referência temporal das refeições

Novas refeições usam `timeReference: "meal_start"`: o horário informado representa o início da alimentação. `"meal_end"` identifica o fim; `"unconfirmed"` ou a ausência do campo significam referência não confirmada. Registros antigos e backups sem esse metadado não são classificados automaticamente. A referência aparece no cadastro/edição, nos detalhes, no histórico, na Home e nas opções de associação. Não há conversão de fim em início nem cálculo de intervalo clínico desde um início desconhecido.

Em **Ajustes > Dados e backup > Referência dos horários das refeições antigas**, o procedimento explícito permite identificar como fim somente as refeições selecionadas pelo usuário:

1. Preparar a prévia e baixar o backup completo. A leitura é consistente e a integridade estrutural e das referências é verificada.
2. Conferir os registros da prévia e selecionar apenas refeições próprias com horário de fim. Nenhuma vem selecionada e referências de início/fim já confirmadas ficam fora do procedimento.
3. Abrir novamente o JSON salvo no campo de conferência. O conteúdo de todas as nove tabelas deve corresponder à prévia; apenas afirmar que salvou o arquivo não libera a atualização.
4. Confirmar explicitamente a propriedade dos registros e o significado de fim, e então confirmar a classificação. Cancelar a prévia não altera registros.

Antes da escrita, todas as tabelas são comparadas novamente com a prévia dentro de uma transação. Mudanças, backup incorreto ou referências ausentes bloqueiam a operação. Após a escrita, outra comparação exige que apenas `timeReference` das refeições escolhidas tenha mudado; qualquer falha reverte a transação. `at`, `createdAt`, `updatedAt`, UUIDs, demais campos e associações permanecem intactos na classificação. Referências ausentes devem ser revisadas separadamente; este procedimento não repara nem remove registros.

O campo opcional de referência temporal não exige novo índice nem reescrita dos registros. O backup `glicoponto-backup` versão 2 preserva e valida esse metadado e aceita os arquivos anteriores sem atribuir um significado presumido. Ao editar uma refeição sem mudar o horário exibido, a string `at` original é preservada, incluindo segundos, milissegundos e offset. A classificação inclui alimentos e itens na conferência de integridade, sem alterá-los.

## Base local de refeições estruturadas — Dexie v3 e backup v2

Referência: `docs/meals-domain.md` do backend, commit `362836a`. A versão 3 apenas cria duas tabelas vazias; não possui callback de transformação, não renomeia o banco nem interpreta descrições antigas. O formulário e as sete coleções anteriores conservam seus modelos e funcionamento.

| Coleção | Campos novos |
| --- | --- |
| `foods` | `id`, `name`, `createdAt`, `updatedAt`, `revision`, `deletedAt` opcional |
| `mealItems` | `id`, `mealId` obrigatório, `foodId` opcional, `foodName` histórico, `quantity`, `unit`, mesmos metadados |

Os UUIDs novos usam a representação canônica em minúsculas. IDs clínicos legados continuam opacos e são preservados. Nome obrigatório até 200 caracteres; revisões inteiras positivas e seguras; metadados com offset explícito, até seis casas fracionárias e ordem temporal validada. As revisões são locais: não significam confirmação nem revisão conhecida de um servidor. Não existe vínculo automático com usuário remoto.

`quantity` é **string decimal exata**, positiva, com até 12 dígitos inteiros e seis fracionários. Exemplo: `"999999999999.999999"`; não passar por `Number`, arredondar ou converter unidade. Códigos permitidos: `g`, `kg`, `mg`, `mL`, `L`, `unit`, `portion`, `tsp`, `tbsp`, `cup`. Unidades domésticas não têm equivalência presumida. O formato local não é um DTO REST: um adaptador futuro deverá serializar o decimal para o contrato numérico sem perda de precisão, mapear `unconfirmed`/ausência para `unknown` e separar revisões locais das remotas.

`saveFood` e `saveMealWithItems` em `src/database/structuredMeals.ts` validam dados, vínculos e revisões em transações Dexie; novos alimentos/itens começam em revisão 1, edições exigem a próxima revisão e `updatedAt` crescente. Editar uma refeição exige seu snapshot anterior. A operação de refeição grava atomicamente somente os itens fornecidos e não exclui implicitamente os omitidos. Renomear/excluir logicamente alimento não reescreve nomes consumidos. Alimento excluído só pode manter vínculo histórico existente; não aceita novas associações. O formulário usa essas operações através de `src/database/mealForm.ts`, sem chamadas de rede.

O backup v2 exige as nove coleções. Em legados/v1, `foods` e `mealItems` ausentes tornam-se arrays vazios somente na representação importada, sem limpar as coleções locais. Coleções novas presentes são validadas e nunca descartadas. Exportação e prévia usam snapshots transacionais; restauração revalida estrutura, referências e colisões dentro de uma única transação, com rollback inclusive do perfil. Duplicatas por UUID e conteúdo são ignoradas; conflitos em alimentos/itens ou na refeição referenciada bloqueiam a restauração sem sobrescrita. Conflitos das coleções clínicas antigas mantêm o comportamento anterior de preservar o registro local e informar a prévia. Backups guardam também exclusões lógicas e nomes históricos. Clientes antigos não devem restaurar backups v2; não há exportação com perda deliberada de alimentos/itens para v1.

Não há autenticação, sincronização, fila remota, API ou execução de migração em banco real nesta etapa. A atualização do esquema está preparada para a próxima abertura pela versão nova; as verificações deste marco usam exclusivamente bancos sintéticos isolados. A infraestrutura foi consolidada separadamente no commit `7604808`.

## Formulário de refeições estruturadas — revisão local

Cadastro e edição mantêm tipo, data, horário, significado temporal e descrição livre. A seção opcional **Alimentos consumidos** permite adicionar/remover linhas com nome, quantidade e unidade. Sem linhas, a refeição continua podendo ser registrada apenas com descrição; textos antigos não são convertidos. Horários antigos inalterados mantêm a string `at` original e sua referência, inclusive ausência do metadado.

As sugestões usam exclusivamente alimentos ativos do catálogo local, com busca sem distinção de caixa/acentos e até oito resultados por pesquisa. Setas e Enter selecionam, Escape fecha; opções têm alvos de toque de pelo menos 44 px. Não preenchem quantidades. Ao salvar, uma seleção explícita é preservada; nomes exatos e únicos (caixa/espaços normalizados, acentos preservados) são reutilizados; alimentos novos são cadastrados automaticamente na mesma transação. Nomes ambíguos exigem selecionar uma sugestão, e nomes semelhantes não são fundidos. Não existe mais uma ação obrigatória Cadastrar. Corrigir somente a quantidade de consumo histórico sem catálogo conserva a ausência do vínculo.

Quantidades aceitam vírgula ou ponto e são armazenadas como strings decimais exatas. O teclado próprio desse campo oferece dígitos, separador decimal, apagar, limpar e concluir; `inputMode="none"` evita solicitar o teclado Android, preservando entrada física e colagem válida. Nenhum outro campo numérico foi alterado. Valores não positivos, exponenciais ou acima dos limites são rejeitados; não existe arredondamento ou conversão de medidas caseiras. O nome histórico vem do item consumido, e corrigir quantidade preserva seu UUID, `foodId`, `foodName` e criação. Itens inalterados não são regravados. Unidades são ordenadas pelos rótulos em português, mantendo os códigos internos.

Alimentos novos, refeição, itens novos/editados e exclusões lógicas são gravados em uma só transação. Erro mantém o rascunho e reverte todas as escritas. Edição usa snapshots e revisões para detectar alterações concorrentes sem sobrescrevê-las. Remover uma linha nova apenas descarta o rascunho; remover item salvo mantém UUID, vínculos, nome histórico e quantidade no backup, acrescentando `deletedAt` e avançando a revisão. Os detalhes mostram somente itens ativos.

A exclusão é lógica e transacional para a refeição e seus itens ativos, preservando literalmente os itens já removidos e todos os alimentos do catálogo. Glicemias ou insulinas vinculadas por `mealId` continuam bloqueando a operação, com prévia antes do modal e validação final na mesma transação. O modal nativo fica separado dos botões Editar/Excluir, com fundo inerte e gerenciamento de foco. UUIDs e vínculos são mantidos, sem saneamento de órfãos anteriores. Refeições excluídas não aparecem nas consultas ativas, associações, relatórios ou lembretes.

`Meal.deletedAt` é opcional e não indexado: Dexie permanece v3 sem migração de registros, e o backup v2 preserva o histórico completo e valida seus metadados/referências. Clientes anteriores não interpretam esse filtro, portanto backups com exclusões devem ser restaurados no cliente atualizado. A proposta de **Ajustes → Meus alimentos**, os impactos no backend e os limites de compatibilidade estão em [docs/meals-refinement-review.md](docs/meals-refinement-review.md).

Registros legados sem itens continuam editáveis mesmo com IDs opacos ou horários incompletos aceitos pelo backup anterior, sem reinterpretação automática. A inclusão de itens respeita os UUIDs e horários completos exigidos pela base estruturada; não corrige dados legados silenciosamente. API, Supabase e sincronização continuam fora desta implementação.

Para revisar em um banco separado, no PowerShell use `$env:VITE_DB_NAME='glicemio-ui-qa-tests'` e `npm.cmd run dev -- --host 127.0.0.1 --port 4173`. A validação automatizada usa `fake-indexeddb` e jsdom; o checklist visual para regressões cobre cadastro, sugestões, teclado próprio/nativo, toque, edição, modal e ausência de overflow em **320, 360, 390 e 412 px**, além de Chrome Android. O usuário concluiu e aprovou os testes manuais no Android e autorizou o versionamento e a publicação. Não foi executada automação de controle do navegador nesta rodada.

## Lembrete opcional de glicemia após refeições

O aviso discreto na Home considera somente `timeReference: "meal_start"`, usando o instante de `Meal.at`. Aparece de 120 minutos (inclusive) a 180 minutos (exclusive); datas inválidas, sem hora/fuso, refeições futuras, de fim ou não confirmadas não são usadas. A passagem pelos limites é agendada dentro da aplicação e reavaliada ao voltar à janela. Não há push, notificações do sistema ou promessa de execução em segundo plano.

Uma medição já registrada entre 90 e 180 minutos após o início, e não posterior ao relógio atual, suprime o aviso pelo horário, independentemente de `mealId`, contexto ou valor. Isso somente evita avisos redundantes: não cria associações, não classifica resultados e não solicita uma segunda medição. As faixas de 120–180 e 90–180 minutos são decisões de UX deste recurso, não intervalos clínicos universais. Os horários individuais podem variar, conforme orienta a [ADA sobre monitoramento da glicemia](https://diabetes.org/living-with-diabetes/treatment-care/checking-your-blood-sugar).

Entre refeições elegíveis próximas, somente a de início mais recente é considerada. Dispensá-la não apresenta em seguida um aviso mais antigo. A dispensa fica em `localStorage`, por UUID da refeição, com o instante de `at` e a referência temporal do evento dispensado. Atravessa reaberturas e mudanças de dia enquanto esses dados forem equivalentes: alterações apenas de descrição, `updatedAt` ou representação do mesmo instante em outro fuso não a invalidam. Uma alteração efetiva de horário ou referência invalida a dispensa observada, inclusive quando torna a refeição inelegível. Valores antigos que guardavam somente `1`, sem identificar o evento, deixam de suprimir o aviso, pois não é possível comprovar sua equivalência. Nenhuma dessas operações muda a refeição ou os vínculos e as dispensas não integram o JSON clínico. Se o armazenamento de preferências falhar, a interface informa que a dispensa vale apenas nesta abertura.

O recurso começa habilitado quando a preferência está ausente e pode ser desativado em **Ajustes > Perfil > Lembretes na Home**, desmarcando **Lembrete de glicemia após refeições** e salvando o perfil. O campo opcional `postMealReminderEnabled` é preservado e validado no backup versão 2; arquivos anteriores sem a preferência continuam aceitos. O lembrete não exige alterações no nome ou no esquema do banco Dexie.

O lembrete aparece de forma compacta abaixo da última glicemia, sem cartão permanente. Orientação de hipoglicemia, glicemia classificada com atenção alta, consulta próxima e lembrete basal continuam visíveis acima dele, com seus destaques e regras preservados. Esses avisos podem coexistir: uma leitura antiga ou uma consulta nas próximas 24 horas não bloqueia o pós-refeição. A ação de registro abre `/glicemia`, sem associação automática. Medições em qualquer outro horário continuam disponíveis e o fim da janela não informa que deixaram de ser necessárias.

Nos detalhes e na edição de refeições com referência não confirmada, uma orientação explica por que o horário não gera lembretes pós-refeição. A referência não é alterada automaticamente; o procedimento de classificação de refeições antigas como fim permanece disponível sem mudanças.

## Verificação

```sh
npm.cmd ci
npm.cmd run build
npm.cmd test
```

Inspecionar `dist/manifest.webmanifest`, `dist/index.html` e `dist/sw.js`. Para validar em navegador, servir o build com `npm.cmd exec vite preview -- --host 127.0.0.1`, abrir a URL indicada e verificar o manifest, seus ícones e o Service Worker no painel Application do DevTools. Em localhost ou HTTPS, confirmar que o navegador oferece a instalação. Os testes automatizados usam IndexedDB simulado e não acessam dados de dispositivos reais.

## Atualização do nome no Android

Validar no **mesmo endereço usado pela instalação existente**, após o deploy:

1. Abrir a PWA instalada e confirmar Glicemio na Home e no título, além da presença do perfil e dos registros anteriores. Para conferir integridade, comparar os registros com uma exportação prévia, sem apagar ou restaurar dados.
2. Confirmar que o manifest servido tem `name` e `short_name` iguais a `Glicemio`, URLs e ícones preservados, e que `/sw.js` é servido e registrado.
3. Conectar o aparelho ao Wi-Fi e à energia, fechar a PWA e aguardar a atualização do WebAPK pelo Chrome. O nome do ícone pode levar mais tempo que o conteúdo da página para mudar.
4. Para inspecionar ou solicitar a atualização, abrir `about://webapks` no Chrome do Android. Quando disponível, usar o botão de atualização da instalação existente, abrir a PWA e fechá-la novamente; conferir o status e o nome no launcher.
5. Reabrir e confirmar que perfil, registros e vínculos continuam presentes. Não desinstalar a aplicação nem limpar os dados para forçar a renomeação.

O Chrome documenta uma checagem periódica do manifest e atualização após fechar a PWA, com Wi-Fi e energia; isso não garante mudança imediata no launcher. Consulte o [procedimento oficial de atualização do manifest no Android](https://web.dev/articles/manifest-updates#updates_on_chrome_for_android). A confirmação final do nome no launcher requer um aparelho Android com a instalação anterior.
