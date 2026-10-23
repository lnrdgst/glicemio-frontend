# Glicemio

Frontend da PWA Glicemio (`glicemio-frontend`), anteriormente chamada Glicoponto.

## Identidade da PWA e compatibilidade

O manifest é gerado pelo `vite-plugin-pwa` em `/manifest.webmanifest`. `name` e `short_name` passam a `Glicemio`, assim como o título HTML e a marca na Home e no cadastro inicial.

O manifest continua **sem `id` explícito**, com `start_url: '/'`, `scope: '/'` e `display: 'standalone'`. Não foi criado um identificador com a nova marca. O caminho do manifest, os ícones (incluindo os arquivos `*-v2.png`), o registro em `/sw.js` e a política `registerType: 'prompt'` foram mantidos. Preservar as URLs e a mesma origem permite manter a identidade instalada, conforme a [documentação do Chrome sobre identidade da PWA](https://developer.chrome.com/docs/capabilities/pwa-manifest-id).

Referências técnicas ao nome anterior permanecem intencionalmente:

- Banco de produção `glicoponto`, configuração `VITE_DB_NAME`, classe `GlicopontoDB`, versões Dexie 1 e 2, tabelas, IDs e relacionamentos.
- Bancos isolados de testes `glicoponto-tests` e `glicoponto-migration-test-*`.
- Chaves `glicoponto-basal-reminder` e `glicoponto-report-period` para preservar preferências existentes.
- Formato JSON `glicoponto-backup`, versão 1, e sua estrutura de exportação/importação. Somente o nome sugerido para download passa a `glicemio-backup.json`.
- Arquivo de imagem `public/icone-glicoponto.png`, preservado junto dos demais ícones.

Esta alteração não limpa armazenamento nem modifica registros. Dados locais pertencem à origem: trocar o domínio não compartilha IndexedDB ou preferências com a origem anterior. Mudança de domínio e migração de dados ficam fora desta alteração.

## Referência temporal das refeições

Novas refeições usam `timeReference: "meal_start"`: o horário informado representa o início da alimentação. `"meal_end"` identifica o fim; `"unconfirmed"` ou a ausência do campo significam referência não confirmada. Registros antigos e backups sem esse metadado não são classificados automaticamente. A referência aparece no cadastro/edição, nos detalhes, no histórico, na Home e nas opções de associação. Não há conversão de fim em início nem cálculo de intervalo clínico desde um início desconhecido.

Em **Ajustes > Dados e backup > Referência dos horários das refeições antigas**, o procedimento explícito permite identificar como fim somente as refeições selecionadas pelo usuário:

1. Preparar a prévia e baixar o backup completo. A leitura é consistente e a integridade estrutural e das referências é verificada.
2. Conferir os registros da prévia e selecionar apenas refeições próprias com horário de fim. Nenhuma vem selecionada e referências de início/fim já confirmadas ficam fora do procedimento.
3. Abrir novamente o JSON salvo no campo de conferência. O conteúdo de todas as sete tabelas deve corresponder à prévia; apenas afirmar que salvou o arquivo não libera a atualização.
4. Confirmar explicitamente a propriedade dos registros e o significado de fim, e então confirmar a classificação. Cancelar a prévia não altera registros.

Antes da escrita, todas as tabelas são comparadas novamente com a prévia dentro de uma transação. Mudanças, backup incorreto ou referências ausentes bloqueiam a operação. Após a escrita, outra comparação exige que apenas `timeReference` das refeições escolhidas tenha mudado; qualquer falha reverte a transação. `at`, `createdAt`, `updatedAt`, UUIDs, demais campos e associações permanecem intactos na classificação. Referências ausentes devem ser revisadas separadamente; este procedimento não repara nem remove registros.

O banco `glicoponto` e o esquema Dexie versão 2 permanecem iguais: o campo opcional não exige novo índice ou migração de esquema. O backup continua no formato `glicoponto-backup`, versão 1, preservando e validando o metadado opcional e aceitando os arquivos anteriores sem atribuir um significado presumido. Ao editar uma refeição sem mudar o horário exibido, a string `at` original é preservada, incluindo segundos, milissegundos e offset.

## Lembrete opcional de glicemia após refeições

O aviso discreto na Home considera somente `timeReference: "meal_start"`, usando o instante de `Meal.at`. Aparece de 120 minutos (inclusive) a 180 minutos (exclusive); datas inválidas, sem hora/fuso, refeições futuras, de fim ou não confirmadas não são usadas. A passagem pelos limites é agendada dentro da aplicação e reavaliada ao voltar à janela. Não há push, notificações do sistema ou promessa de execução em segundo plano.

Uma medição já registrada entre 90 e 180 minutos após o início, e não posterior ao relógio atual, suprime o aviso pelo horário, independentemente de `mealId`, contexto ou valor. Isso somente evita avisos redundantes: não cria associações, não classifica resultados e não solicita uma segunda medição. As faixas de 120–180 e 90–180 minutos são decisões de UX deste recurso, não intervalos clínicos universais. Os horários individuais podem variar, conforme orienta a [ADA sobre monitoramento da glicemia](https://diabetes.org/living-with-diabetes/treatment-care/checking-your-blood-sugar).

Entre refeições elegíveis próximas, somente a de início mais recente é considerada. Dispensá-la não apresenta em seguida um aviso mais antigo. A dispensa fica em `localStorage`, por UUID da refeição, com o instante de `at` e a referência temporal do evento dispensado. Atravessa reaberturas e mudanças de dia enquanto esses dados forem equivalentes: alterações apenas de descrição, `updatedAt` ou representação do mesmo instante em outro fuso não a invalidam. Uma alteração efetiva de horário ou referência invalida a dispensa observada, inclusive quando torna a refeição inelegível. Valores antigos que guardavam somente `1`, sem identificar o evento, deixam de suprimir o aviso, pois não é possível comprovar sua equivalência. Nenhuma dessas operações muda a refeição ou os vínculos e as dispensas não integram o JSON clínico. Se o armazenamento de preferências falhar, a interface informa que a dispensa vale apenas nesta abertura.

O recurso começa habilitado quando a preferência está ausente e pode ser desativado em **Ajustes > Perfil > Lembretes na Home**, desmarcando **Lembrete de glicemia após refeições** e salvando o perfil. O campo opcional `postMealReminderEnabled` é preservado e validado no backup versão 1; arquivos anteriores sem a preferência continuam aceitos. Não há mudança no nome ou na versão do banco Dexie.

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
