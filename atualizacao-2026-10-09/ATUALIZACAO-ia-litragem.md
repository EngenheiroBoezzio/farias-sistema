# Atualização: inteligência artificial (litragem e mensagens da Comunidade)

## O que estava acontecendo

Ao clicar em **Identificar litragem com IA** no catálogo de óleos, aparecia só
a mensagem "Erro interno." e a consulta não funcionava.

Na Comunidade, o botão **Gerar mensagem** também falhava, com a mensagem
"Confira os dados enviados.".

## O que foi corrigido

- **A IA voltou a responder.** O sistema estava usando uma versão da
  inteligência artificial do Google que o próprio Google desligou. Agora ele
  usa a versão atual e, se um dia a configuração ficar desatualizada de novo,
  o sistema se ajusta sozinho em vez de parar.
- **Mensagens de erro que explicam o problema.** No lugar de "Erro interno.",
  quando a IA não conseguir responder, a tela agora diz o motivo, por exemplo:
  "A IA atingiu o limite de consultas, tente de novo em alguns minutos" ou
  "A IA demorou demais para responder, tente de novo".
- **Gerar mensagem da Comunidade voltou a funcionar.** Um detalhe do
  servidor, que só servia para colocar o nome da loja no texto, travava a
  geração inteira. Agora, mesmo que esse detalhe falhe, a mensagem é criada.
- **Várias inteligências artificiais de reserva.** Antes o sistema dependia
  de uma IA só: se ela saísse do ar ou chegasse no limite do dia, os botões
  de IA paravam. Agora há uma fila de reservas. Se a primeira não responder,
  o sistema pergunta para a próxima na hora, sem você perceber nada além de,
  às vezes, uns segundos a mais de espera.
- **Respostas mais confiáveis.** A consulta foi ajustada para não voltar vazia
  em alguns modelos de carro.

## Precisa fazer alguma coisa?

Não. É só usar o botão normalmente.
