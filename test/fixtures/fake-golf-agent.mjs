import process from "node:process";

console.log("Agente de prueba trabajando.");
await new Promise((resolve) => setTimeout(resolve, Number(process.env.FAKE_AGENT_DELAY_MS || 300)));
console.log("Agente de prueba terminado.");
process.exitCode = Number(process.env.FAKE_AGENT_EXIT_CODE || 0);
