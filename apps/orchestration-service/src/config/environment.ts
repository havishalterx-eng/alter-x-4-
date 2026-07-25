// Config for the Conversation Manager (INGR-4) only. Session Gateway's own
// config stays inline in app.module.ts (INGR-2, untouched) -- this file
// intentionally doesn't merge with it, so this ticket can't accidentally
// perturb INGR-2's guard wiring.

const ALTER_ENVIRONMENTS = ["local", "dev", "staging", "prod"] as const;

export interface ConversationManagerEnvironment {
  readonly alterEnvironment: (typeof ALTER_ENVIRONMENTS)[number];
  readonly modelGatewayAddress: string;
  readonly grpcBindAddress: string;
}

export class ConversationManagerConfigurationError extends Error {
  constructor(field: string, reason: string) {
    super(`Invalid Conversation Manager environment field ${field}: ${reason}`);
    this.name = "ConversationManagerConfigurationError";
  }
}

function requireValue(environment: NodeJS.ProcessEnv, field: string): string {
  const value = environment[field]?.trim();
  if (value === undefined || value.length === 0) {
    throw new ConversationManagerConfigurationError(
      field,
      "a non-empty value is required",
    );
  }
  return value;
}

function parseGrpcAddress(value: string | undefined): string {
  const address = value?.trim() ?? "0.0.0.0:50052";
  if (!/^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(address)) {
    throw new ConversationManagerConfigurationError(
      "CONVERSATION_GRPC_BIND_ADDRESS",
      "must be an IPv4 address and port",
    );
  }
  const port = Number(address.slice(address.lastIndexOf(":") + 1));
  if (port < 1 || port > 65_535) {
    throw new ConversationManagerConfigurationError(
      "CONVERSATION_GRPC_BIND_ADDRESS",
      "port must be from 1 to 65535",
    );
  }
  return address;
}

export function loadConversationManagerEnvironment(
  environment: NodeJS.ProcessEnv,
): ConversationManagerEnvironment {
  const alterEnvironment = requireValue(environment, "ALTER_ENV");
  if (
    !ALTER_ENVIRONMENTS.includes(
      alterEnvironment as ConversationManagerEnvironment["alterEnvironment"],
    )
  ) {
    throw new ConversationManagerConfigurationError(
      "ALTER_ENV",
      `must be one of ${ALTER_ENVIRONMENTS.join(", ")}`,
    );
  }

  return {
    alterEnvironment:
      alterEnvironment as ConversationManagerEnvironment["alterEnvironment"],
    modelGatewayAddress: requireValue(environment, "MODEL_GATEWAY_ADDRESS"),
    grpcBindAddress: parseGrpcAddress(
      environment.CONVERSATION_GRPC_BIND_ADDRESS,
    ),
  };
}
