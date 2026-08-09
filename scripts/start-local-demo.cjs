const { spawn } = require("node:child_process");

const expoCli = require.resolve("expo/bin/cli");
const forwardedArgs = process.argv.slice(2);
const hasPort = forwardedArgs.includes("--port") || forwardedArgs.some((arg) => arg.startsWith("--port="));
const expoArgs = [
  expoCli,
  "start",
  "--web",
  "--offline",
  ...(hasPort ? [] : ["--port", "8081"]),
  ...forwardedArgs,
];

const child = spawn(process.execPath, expoArgs, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    EXPO_NO_TELEMETRY: "1",
    EXPO_OFFLINE: "1",
    // O servidor deve poder subir em terminal, CI e ambiente restrito sem
    // tentar criar um processo de navegador. O endereço é aberto pelo usuário.
    BROWSER: "none",
    EXPO_PUBLIC_FINFLOW_LOCAL_DEMO: "true",
    // Mesmo que uma regressão tente criar o cliente real, estes valores nunca
    // apontam para o projeto remoto do FinFlow.
    EXPO_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9",
    EXPO_PUBLIC_SUPABASE_ANON_KEY: "finflow-local-demo-key-not-used",
  },
  stdio: "inherit",
});

const forwardSignal = (signal) => {
  if (!child.killed) child.kill(signal);
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});
