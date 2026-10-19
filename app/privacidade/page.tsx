export const dynamic = "force-dynamic";
import Link from "next/link";
export default function Privacy() {
  return (
    <main
      style={{
        maxWidth: 850,
        margin: "40px auto",
        padding: 24,
        lineHeight: 1.8,
      }}
    >
      <h1>Privacidade no WZY</h1>
      <p>Atualizada em 15 de outubro de 2026.</p>
      <p>
        Responsável pelo tratamento: Operador desta instalação. Contato:{" "}
        <a href="mailto:privacidade@example.com">
          privacidade@example.com
        </a>
        .
      </p>
      <h2>Dados e finalidades</h2>
      <p>
        Tratamos nome, email, senha protegida por hash, preferências, registros
        financeiros e arquivos enviados para fornecer os recursos que você
        solicita. Registramos dispositivos, acessos, endereço IP e localização
        aproximada fornecida pela infraestrutura para proteger a conta. Essa
        localização pode ser imprecisa, especialmente com VPN ou rede móvel.
      </p>
      <p>
        O assistente consulta seus lançamentos no servidor do WZY, sem enviar
        perguntas ou registros a um serviço de IA. Para cotações, enviamos
        somente moeda e data ao Frankfurter. Não conectamos bancos
        automaticamente.
      </p>
      <h2>Infraestrutura e segurança</h2>
      <p>
        A aplicação é hospedada na Vercel; registros ficam no Neon/PostgreSQL e
        anexos no Vercel Blob privado. Esses fornecedores podem processar dados
        fora do Brasil conforme seus termos e a configuração do serviço. Usamos
        HTTPS, controle de acesso por usuário, sessões protegidas e criptografia
        de cópias diárias. Biometria é validada pelo dispositivo; recebemos
        apenas informações da chave pública.
      </p>
      <h2>Armazenamento e retenção</h2>
      <p>
        Registros e anexos permanecem enquanto necessários para sua conta.
        Eventos de segurança e cópias financeiras são preservados até revisão de
        retenção pelo responsável; não há exclusão automática por prazo neste
        sistema. O cofre offline é opcional, criptografado com a senha local
        escolhida por você e permanece no dispositivo até ser removido. A senha
        local não pode ser recuperada pelo WZY.
      </p>
      <h2>Seus direitos</h2>
      <p>
        Solicite confirmação de tratamento, acesso, correção, portabilidade,
        informações sobre compartilhamento, oposição ou exclusão pelo contato
        acima. A identidade será verificada antes de fornecer dados ou executar
        uma exclusão. Retenções legalmente exigidas, quando aplicáveis, serão
        explicadas no atendimento. Você pode exportar seus registros e desativar
        notificações nas configurações.
      </p>
      <h2>Métricas opcionais</h2>
      <p>
        Com sua escolha nas configurações de privacidade, registramos somente o
        identificador interno, o evento e o dia de uso e conclusão dos primeiros
        passos. Não incluímos descrições, valores financeiros ou conteúdo de
        perguntas. A opção começa desativada. Desativá-la interrompe a coleta
        futura; você pode solicitar a exclusão dos dados já registrados pelo
        canal de contato.
      </p>
      <h2>Preferências e notificações</h2>
      <p>
        Usamos um cookie necessário para a sessão e armazenamento local para
        tema e recursos opcionais. Não incluímos rastreadores publicitários.
        Notificações exigem sua autorização e exibem lembretes genéricos; o
        serviço push do navegador recebe a inscrição e a mensagem protegida.
      </p>
      <p>
        <Link href="/">Voltar ao WZY</Link>
      </p>
    </main>
  );
}
