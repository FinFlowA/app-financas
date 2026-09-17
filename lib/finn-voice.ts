const FINN_VOICE_REWRITES: ReadonlyArray<readonly [RegExp, string]> = [
  [/A IA respondeu em um formato inesperado/gi, "Não consegui organizar minha resposta no formato esperado"],
  [/A IA retornou uma resposta inválida/gi, "Não consegui validar minha resposta"],
  [/A resposta da IA não passou pela validação de segurança/gi, "Não consegui validar minha resposta com segurança"],
  [/A IA não conseguiu/gi, "Não consegui"],
  [/Não consegui consultar a IA agora/gi, "Não consegui processar sua solicitação agora"],
  [/A IA financeira está temporariamente indisponível/gi, "Estou temporariamente indisponível"],
  [/A IA financeira está indisponível agora/gi, "Estou indisponível agora"],
  [/O provedor da IA financeira/gi, "Meu serviço de processamento"],
  [/O provedor da IA/gi, "Meu serviço de processamento"],
  [/A IA foi pausada/gi, "Precisei pausar meu atendimento"],
];

export function inFinnVoice(message: string): string {
  return FINN_VOICE_REWRITES.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    message,
  );
}
